# Vitrine — AI-native e-shop (ITC 4949 Capstone)
# Copyright (c) 2026 George Papasotiriou. All rights reserved.
# Author: George Papasotiriou <g.papasotiriou@acg.edu>
# Project started: 2026-09-12
#
# E2: every recommender on the same test, scored with OTTO's metric, written up with a chart.

"""Runs E2 and writes the report.

    python -m reco_otto.evaluate --data <otto train .jsonl or .parquet> [--sample-every 20] [--seed 4949]
    python -m reco_otto.evaluate --synthetic        (the made-up sessions: a check that it all runs)

Splits off the last week, cuts each test session at a random point, asks each
recommender for 20 items per session, and scores them (metrics.py). Methods:

    popularity              the 20 most clicked / ordered items, for everyone
    co-visitation           the baseline (covisit.py)
    taste graph             the shop's recommender as the shop uses it: new items only
    taste graph + history   the same, the session's own items first (OTTO's fair comparison)
    without time decay            ablation of the "+ history" variant: no τ, no half-life
    without normalisation         ablation: raw co-occurrence weights, not degree-normalised

Writes docs/report/evaluations/e2-otto.json, .md and .png (from the repository
root; the report folder is not part of the source). Synthetic runs write to
e2-synthetic.* and say so in every line.
"""

from __future__ import annotations

import argparse
import gc
import json
import time
from datetime import datetime, timezone
from pathlib import Path

import polars as pl

from reco_otto import data, metrics, synthetic
from reco_otto.covisit import CoVisitation, Popularity
from reco_otto.taste_graph import Options, TasteGraph

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "docs" / "report" / "evaluations"


#: The walk's pruning on OTTO (taste_graph.random_walk_with_restart). At one
#: session in 20, ε = 1e-5 left the top 20 the same items as the exact walk in
#: 150 of 150 sessions, at a ninth of the time; every report measures it again.
PRUNE = 1e-5
PRUNE_CHECK_SESSIONS = 150

Predicted = dict[str, dict[int, list[int]]]


def _sessions(truncated: data.Truncated):
    for (session,), events in truncated.history.group_by(["session"], maintain_order=True):
        yield int(session), events["aid"].to_list(), events["type"].to_list(), events["ts"].to_list()


def predict(recommender: Popularity | CoVisitation, truncated: data.Truncated) -> Predicted:
    """Each test session's 20 for clicks and its 20 for carts and orders."""
    clicks: dict[int, list[int]] = {}
    buys: dict[int, list[int]] = {}
    for session, aids, types, _ in _sessions(truncated):
        clicks[session] = recommender.clicks_for(aids, types)
        buys[session] = recommender.buys_for(aids, types)
    return {"clicks": clicks, "carts": buys, "orders": buys}


def predict_graph(graph: TasteGraph, truncated: data.Truncated) -> dict[bool, Predicted]:
    """The shop's way (False) and OTTO's way with the history first (True), from one walk per session."""
    shelves: dict[bool, Predicted] = {}
    for with_history in (False, True):
        buys: dict[int, list[int]] = {}
        shelves[with_history] = {"clicks": {}, "carts": buys, "orders": buys}
    for session, aids, types, tss in _sessions(truncated):
        history, found = graph.ranked(aids, tss, types)
        for with_history, predicted in shelves.items():
            predicted["clicks"][session] = graph.shelf(history, found, graph.top_clicks, with_history)
            predicted["carts"][session] = graph.shelf(history, found, graph.top_orders, with_history)
    return shelves


def prune_check(graph: TasteGraph, truncated: data.Truncated, sessions: int = PRUNE_CHECK_SESSIONS) -> dict:
    """The pruned walk against the exact one on the first test sessions: are the 20 it finds the same?"""
    epsilon = graph.prune
    identical = overlap = total = checked = 0
    for _, aids, types, tss in _sessions(truncated):
        if checked == sessions:
            break
        graph.prune = 0.0
        exact = graph.ranked(aids, tss, types)[1][:20]
        graph.prune = epsilon
        pruned = graph.ranked(aids, tss, types)[1][:20]
        identical += pruned == exact
        overlap += len(set(pruned) & set(exact))
        total += len(exact)
        checked += 1
    return {"epsilon": epsilon, "sessions": checked, "identical_order": identical, "same_items": round(overlap / total, 4) if total else 1.0}


def run(events: pl.DataFrame, *, seed: int, label: str, test_sessions: int | None = None, prune: float = PRUNE) -> dict:
    """Every method on the same test. Each is fitted, scored and released in turn, so one graph is in memory at a time."""
    train, test = data.split_last_week(events)
    truncated = data.truncate(test, seed=seed)
    all_test = truncated.history["session"].n_unique()
    if test_sessions is not None:
        truncated = data.sample_sessions(truncated, test_sessions, seed=seed)
    results = []
    counts: dict[str, dict[str, metrics.Counts]] = {}

    def score(name: str, predicted: Predicted, fit_s: float, predict_s: float) -> None:
        recalls = {kind: metrics.recall_at_20(predicted[kind], getattr(truncated, kind)) for kind in ("clicks", "carts", "orders")}
        counts[name] = {kind: metrics.counts_per_session(predicted[kind], getattr(truncated, kind)) for kind in ("clicks", "carts", "orders")}
        results.append({"method": name, **recalls, "score": metrics.score(recalls), "fit_s": round(fit_s, 2), "predict_s": round(predict_s, 2)})

    for name, build in [("popularity", lambda: Popularity(train)), ("co-visitation", lambda: CoVisitation(train))]:
        started = time.perf_counter()
        recommender = build()
        fitted = time.perf_counter()
        predicted = predict(recommender, truncated)
        score(name, predicted, fitted - started, time.perf_counter() - fitted)
        del recommender, predicted
        gc.collect()

    check: dict | None = None
    # One graph and one walk give both the shop's way and "+ history"; the ablations change the graph.
    for names, options in [
        ({False: "taste graph", True: "taste graph + history"}, Options()),
        ({True: "without time decay"}, Options(decay=False)),
        ({True: "without normalisation"}, Options(normalise=False)),
    ]:
        started = time.perf_counter()
        graph = TasteGraph(train, options, prune=prune)
        fitted = time.perf_counter()
        if check is None and prune > 0:
            check = prune_check(graph, truncated)
        walked = time.perf_counter()
        shelves = predict_graph(graph, truncated)
        for with_history, name in names.items():
            score(name, shelves[with_history], fitted - started, time.perf_counter() - walked)
        # A graph of 850,000 items is a few GB of Python objects: freed before the next is built.
        del graph, shelves
        gc.collect()

    # Every method against the baseline, and the ablations against the variant they take one idea from.
    intervals = metrics.bootstrap(counts, ["co-visitation", "taste graph + history"], seed=seed)
    for row in results:
        row["score_95"] = [round(value, 4) for value in intervals[row["method"]]["score"]]
        row["vs_covisitation_95"] = [round(value, 4) for value in intervals[row["method"]]["difference"]["co-visitation"]]
        row["vs_taste_graph_95"] = [round(value, 4) for value in intervals[row["method"]]["difference"]["taste graph + history"]]

    return {
        "label": label,
        "at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "seed": seed,
        "train_events": train.height,
        "train_sessions": train["session"].n_unique(),
        "test_sessions": truncated.history["session"].n_unique(),
        "test_sessions_all": all_test,
        "labelled": {"clicks": len(truncated.clicks), "carts": len(truncated.carts), "orders": len(truncated.orders)},
        "prune": check,
        "results": results,
    }


def write(report: dict, stem: str) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / f"{stem}.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    synthetic_note = report["label"].startswith("synthetic")
    lines = [
        "# E2: the Taste Graph against co-visitation" + (" (SYNTHETIC DATA: a check that the code runs, not a result)" if synthetic_note else " on OTTO"),
        "",
        f"Written by `python -m reco_otto.evaluate` on {report['at'][:10]}. Data: {report['label']}. "
        f"Training: {report['train_sessions']:,} sessions, {report['train_events']:,} events. "
        f"Test: {report['test_sessions']:,} sessions"
        + (f" (a seeded random sample of the {report['test_sessions_all']:,} of the last week, the same for every method)" if report.get("test_sessions_all", report["test_sessions"]) > report["test_sessions"] else "")
        + f", cut at a random point (seed {report['seed']}). Labelled: {report['labelled']['clicks']:,} clicks, "
        f"{report['labelled']['carts']:,} carts, {report['labelled']['orders']:,} orders.",
        "",
        "| Method | Recall@20 clicks | carts | orders | Score (0.1/0.3/0.6) | 95% interval | Against co-visitation, 95% | Against taste graph + history, 95% |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for row in report["results"]:
        low, high = row.get("score_95", (row["score"], row["score"]))
        cells = [f"{a:+.4f} to {b:+.4f}" for a, b in (row.get("vs_covisitation_95", (0.0, 0.0)), row.get("vs_taste_graph_95", (0.0, 0.0)))]
        lines.append(
            f"| {row['method']} | {row['clicks']:.4f} | {row['carts']:.4f} | {row['orders']:.4f} | **{row['score']:.4f}** "
            f"| {low:.4f} to {high:.4f} | {cells[0]} | {cells[1]} |"
        )
    lines += [
        "",
        "Recall@20 as OTTO defines it (reco_otto/metrics.py). \"+ history\" puts the session's own items first, as the "
        "co-visitation baseline does; the shop itself recommends only new items. The two ablations remove one idea each "
        "from the \"+ history\" variant. The intervals come from a paired bootstrap over the test sessions (1,000 redraws, "
        "metrics.bootstrap): a difference whose interval excludes zero is one the test can see; one that spans zero is not.",
    ]
    check = report.get("prune")
    if check:
        lines += [
            "",
            f"The Taste Graph's walk is pruned at ε = {check['epsilon']:g} (an item holding less mass does not pass it on). "
            f"Checked against the exact walk on {check['sessions']} test sessions: the same 20 items found "
            f"{check['same_items']:.2%} of the time, in the same order in {check['identical_order']} of {check['sessions']}.",
        ]
    (OUT / f"{stem}.md").write_text("\n".join(lines) + "\n", encoding="utf-8")

    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    names = [row["method"] for row in report["results"]]
    kinds = ["clicks", "carts", "orders"]
    figure, axis = plt.subplots(figsize=(9, 4.2), dpi=150)
    width = 0.26
    for index, kind in enumerate(kinds):
        positions = [x + (index - 1) * width for x in range(len(names))]
        axis.bar(positions, [row[kind] for row in report["results"]], width, label=kind)
    axis.set_xticks(range(len(names)), names, rotation=18, ha="right")
    axis.set_ylabel("Recall@20")
    axis.set_ylim(0, 1)
    axis.legend(frameon=False)
    axis.set_title("E2 on OTTO" if not synthetic_note else "E2 — synthetic data (code check only)")
    axis.spines[["top", "right"]].set_visible(False)
    figure.tight_layout()
    figure.savefig(OUT / f"{stem}.png")
    plt.close(figure)


def main() -> None:
    parser = argparse.ArgumentParser(description="E2: the Taste Graph against co-visitation, on OTTO.")
    parser.add_argument("--data", type=Path, help="OTTO's train.jsonl (or a .parquet of its events)")
    parser.add_argument("--sample-every", type=int, default=1, help="keep one session in every N (by id), for a smaller run")
    parser.add_argument("--seed", type=int, default=4949)
    parser.add_argument("--label", help="what the data is, for the report (e.g. a .parquet sample written from the release)")
    parser.add_argument("--test-sessions", type=int, default=None, help="score a seeded random sample of this many test sessions (all by default)")
    parser.add_argument("--synthetic", action="store_true", help="run on made-up sessions instead (a check that the code runs)")
    args = parser.parse_args()
    if args.synthetic:
        events = data.from_records(synthetic.sessions())
        report = run(events, seed=args.seed, label="synthetic sessions (reco_otto/synthetic.py)")
        write(report, "e2-synthetic")
    else:
        if args.data is None:
            parser.error("--data is required (or --synthetic)")
        events = data.load(args.data, sample_every=args.sample_every)
        label = args.label or f"OTTO {args.data.name}" + (f", one session in {args.sample_every}" if args.sample_every > 1 else "")
        report = run(events, seed=args.seed, label=label, test_sessions=args.test_sessions)
        write(report, "e2-otto")
    for row in report["results"]:
        print(f"{row['method']:<24} clicks {row['clicks']:.4f}  carts {row['carts']:.4f}  orders {row['orders']:.4f}  score {row['score']:.4f}")


if __name__ == "__main__":
    main()
