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


def predict(recommender: object, truncated: data.Truncated) -> dict[str, dict[int, list[int]]]:
    """Each test session's 20 for clicks and its 20 for carts and orders."""
    clicks: dict[int, list[int]] = {}
    buys: dict[int, list[int]] = {}
    for (session,), events in truncated.history.group_by(["session"], maintain_order=True):
        aids = events["aid"].to_list()
        types = events["type"].to_list()
        if isinstance(recommender, TasteGraph):
            tss = events["ts"].to_list()
            clicks[int(session)] = recommender.clicks_for(aids, types, tss)
            buys[int(session)] = recommender.buys_for(aids, types, tss)
        else:
            clicks[int(session)] = recommender.clicks_for(aids, types)  # type: ignore[attr-defined]
            buys[int(session)] = recommender.buys_for(aids, types)  # type: ignore[attr-defined]
    return {"clicks": clicks, "carts": buys, "orders": buys}


def run(events: pl.DataFrame, *, seed: int, label: str) -> dict:
    train, test = data.split_last_week(events)
    truncated = data.truncate(test, seed=seed)
    methods: dict[str, object] = {}
    timings: dict[str, float] = {}
    for name, build in [
        ("popularity", lambda: Popularity(train)),
        ("co-visitation", lambda: CoVisitation(train)),
        ("taste graph", lambda: TasteGraph(train, with_history=False)),
        ("taste graph + history", lambda: TasteGraph(train)),
        ("without time decay", lambda: TasteGraph(train, Options(decay=False))),
        ("without normalisation", lambda: TasteGraph(train, Options(normalise=False))),
    ]:
        started = time.perf_counter()
        methods[name] = build()
        timings[name] = time.perf_counter() - started
    results = []
    for name, recommender in methods.items():
        started = time.perf_counter()
        predicted = predict(recommender, truncated)
        recalls = {
            "clicks": metrics.recall_at_20(predicted["clicks"], truncated.clicks),
            "carts": metrics.recall_at_20(predicted["carts"], truncated.carts),
            "orders": metrics.recall_at_20(predicted["orders"], truncated.orders),
        }
        results.append({"method": name, **recalls, "score": metrics.score(recalls), "fit_s": round(timings[name], 2), "predict_s": round(time.perf_counter() - started, 2)})
    return {
        "label": label,
        "at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "seed": seed,
        "train_events": train.height,
        "train_sessions": train["session"].n_unique(),
        "test_sessions": truncated.history["session"].n_unique(),
        "labelled": {"clicks": len(truncated.clicks), "carts": len(truncated.carts), "orders": len(truncated.orders)},
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
        f"Test: {report['test_sessions']:,} sessions, cut at a random point (seed {report['seed']}).",
        "",
        "| Method | Recall@20 clicks | carts | orders | Score (0.1/0.3/0.6) |",
        "|---|---|---|---|---|",
    ]
    for row in report["results"]:
        lines.append(f"| {row['method']} | {row['clicks']:.4f} | {row['carts']:.4f} | {row['orders']:.4f} | **{row['score']:.4f}** |")
    lines += [
        "",
        "Recall@20 as OTTO defines it (reco_otto/metrics.py). \"+ history\" puts the session's own items first, as the "
        "co-visitation baseline does; the shop itself recommends only new items. The two ablations remove one idea each "
        "from the \"+ history\" variant.",
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
        label = f"OTTO {args.data.name}" + (f", one session in {args.sample_every}" if args.sample_every > 1 else "")
        report = run(events, seed=args.seed, label=label)
        write(report, "e2-otto")
    for row in report["results"]:
        print(f"{row['method']:<24} clicks {row['clicks']:.4f}  carts {row['carts']:.4f}  orders {row['orders']:.4f}  score {row['score']:.4f}")


if __name__ == "__main__":
    main()
