# Vitrine — AI-native e-shop (ITC 4949 Capstone)
# Copyright (c) 2026 George Papasotiriou. All rights reserved.
# Author: George Papasotiriou <g.papasotiriou@acg.edu>
# Project started: 2026-09-12
#
# E12: the Fit Engine against its baselines on RentTheRunway and ModCloth, and the parameters the shop uses.

"""E12 (docs/adr/064).

    python -m fit.evaluate --data ../.local/fit \\
        --report ../docs/report/evaluations/e12-fit \\
        --model ../src/lib/fit/size/model.json \\
        --parity ../src/lib/fit/size/parity.json

For each dataset: 80/10/10 (by date for RentTheRunway, at random for
ModCloth). Sizes become steps on each item's own ladder (--sizes). The Fit
Engine's six parameters are chosen on validation log-loss by pattern search.
On test:

- the Fit Engine as the shop runs it, learning as it goes (each transaction
  predicted, then learned from: "prequential");
- the same, frozen at the end of validation (no learning on test), the
  comparison with the batch-trained baselines;
- the same with one offset per item and no tolerance (tuned on its own), to
  measure what the tolerance adds;
- majority, each item's own record (frozen, and kept up to date as the
  engine is), and 1-LV (Sembium et al., 2017).

Measures: mean one-against-rest AUC (as Misra et al., 2018), each class's
AUC, log-loss, and macro-F1 with thresholds chosen on validation; AUC
differences with 95% paired bootstrap intervals.
"""

from __future__ import annotations

import argparse
import json
import math
import statistics
import time
from collections import defaultdict
from dataclasses import replace
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from . import baselines
from .data import Transaction, load, split
from .metrics import best_thresholds, class_aucs, decide, log_loss, macro_f1, mean_auc, paired_bootstrap
from .model import OUTCOMES, FitParams, item_from_counts, predict, unknown_item, update

DATASETS = {"renttherunway": "renttherunway_final_data.json.gz", "modcloth": "modcloth_final_data.json.gz"}


def on_ladders(rows: list[Transaction], train: list[Transaction]) -> list[Transaction]:
    """Each size as a step on its item's own ladder (the sizes the item comes in, in order), centred on the median step its training buyers took.

    The datasets mix size systems — ModCloth's tops run 4, 8, 12 and its
    jeans 26, 32, 38 — so a customer's "size 8" and "size 26" are the same
    person in two systems. On each item's ladder, centred on its typical
    buyer, "one step above the usual buyer" means the same everywhere, which
    is also what a step means in the shop (XS, S, M, L, XL). An item no
    training buyer took is centred on its ladder's middle. Only the sizes
    are used, never a verdict.
    """
    ladder: dict[str, list[float]] = defaultdict(list)
    for row in rows:
        ladder[row.item].append(row.size)
    index = {item: {size: k for k, size in enumerate(sorted(set(sizes)))} for item, sizes in ladder.items()}
    taken: dict[str, list[int]] = defaultdict(list)
    for row in train:
        taken[row.item].append(index[row.item][row.size])
    centre = {item: statistics.median(steps) for item, steps in taken.items()}
    return [replace(row, size=index[row.item][row.size] - centre.get(row.item, (len(index[row.item]) - 1) / 2)) for row in rows]


def encode(rows: list[Transaction], sizes: str) -> tuple[list[Transaction], list[Transaction], list[Transaction]]:
    train, valid, test = split(rows)
    if sizes == "raw":
        return train, valid, test
    ordered = train + valid + test
    encoded = on_ladders(ordered, train)
    a, b = len(train), len(train) + len(valid)
    return encoded[:a], encoded[a:b], encoded[b:]


def run_engine(params: FitParams, stream: list[Transaction], score_from: int, learn_while_scoring: bool = True) -> np.ndarray:
    """Probabilities for stream[score_from:], learning from every transaction before it (and, if asked, from each scored one after scoring it)."""
    items: dict = {}
    customers: dict[str, tuple[float, float]] = {}
    fresh = unknown_item(params)
    customer_prior = params.customer_prior * params.customer_prior
    out = np.empty((len(stream) - score_from, 3))
    for index, row in enumerate(stream):
        item = items.get(row.item, fresh)
        # A customer first seen is taken to have chosen their own size.
        customer = customers.get(row.customer, (row.size, customer_prior))
        if index >= score_from:
            out[index - score_from] = predict(params, row.size, item, customer)
            if not learn_while_scoring:
                continue
        items[row.item], customers[row.customer] = update(params, row.size, item, customer, OUTCOMES[row.label])
    return out


def labels_of(rows: list[Transaction]) -> np.ndarray:
    return np.array([row.label for row in rows], dtype=int)


START = {"margin": 1.0, "noise": 1.0, "item_prior": 0.5, "tolerance_prior": 0.5, "customer_prior": 1.0, "drift": 0.0}


def tune(train: list[Transaction], valid: list[Transaction], log, start: dict[str, float] = START) -> tuple[FitParams, float]:
    """Pattern search on validation log-loss, on a log scale: each parameter
    tried at ×step and ÷step with the others held, sweeps repeated until none
    helps, then a finer step (2, then √2, then 2^¼). The search walks to the
    data's own scale rather than assume one. Drift starts at zero and is
    tried at a hundredth and a twentieth of the margin before it is scaled
    like the rest; a parameter that starts at zero and is not drift stays
    there (the one-offset ablation)."""
    stream = train + valid
    truth = labels_of(valid)
    cache: dict[tuple, float] = {}

    def loss(values: dict[str, float]) -> float:
        key = tuple(round(values[name], 9) for name in START)
        if key not in cache:
            cache[key] = log_loss(run_engine(FitParams(**values), stream, len(train)), truth)
        return cache[key]

    current = dict(start)
    best = loss(current)
    for step in (2.0, math.sqrt(2.0), 2.0 ** 0.25):
        for sweep in range(12):
            improved = False
            for name in START:
                if name == "drift" and current["drift"] == 0.0:
                    options = [current["margin"] * 0.01, current["margin"] * 0.05]
                else:
                    options = [current[name] * step, current[name] / step] + ([0.0] if name == "drift" else [])
                for option in options:
                    candidate = {**current, name: option}
                    value = loss(candidate)
                    if value < best - 1e-6:
                        best, current, improved = value, candidate, True
            log(f"    step x{step:.3f}, sweep {sweep + 1}: " + ", ".join(f"{k} {v:.4g}" for k, v in current.items()) + f" (validation log-loss {best:.4f})")
            if not improved:
                break
    return FitParams(**current), best


def evaluate(name: str, rows: list[Transaction], sizes: str, log) -> tuple[dict, FitParams, list[Transaction]]:
    train, valid, test = encode(rows, sizes)
    log(f"  {name}: {len(rows)} transactions, train {len(train)}, validation {len(valid)}, test {len(test)}; "
        f"test shares small/fit/large {np.round(np.bincount(labels_of(test), minlength=3) / len(test), 4).tolist()}")
    started = time.time()
    params, valid_loss = tune(train, valid, log)
    log(f"  tuned in {time.time() - started:.0f} s: {params}")
    started = time.time()
    one_offset, one_offset_loss = tune(train, valid, log, {**START, "tolerance_prior": 0.0})
    log(f"  one-offset ablation tuned in {time.time() - started:.0f} s: {one_offset}")

    truth = labels_of(test)
    valid_truth = labels_of(valid)
    everything = train + valid + test
    scored_from = len(train) + len(valid)
    methods: dict[str, tuple[np.ndarray, np.ndarray]] = {}
    # Each method's validation predictions (for its macro-F1 thresholds) and its test predictions.
    engine_valid = run_engine(params, train + valid, len(train))
    methods["fit_engine"] = (engine_valid, run_engine(params, everything, scored_from))
    methods["fit_engine_frozen"] = (engine_valid, run_engine(params, everything, scored_from, learn_while_scoring=False))
    methods["fit_engine_one_offset"] = (run_engine(one_offset, train + valid, len(train)), run_engine(one_offset, everything, scored_from))
    methods["majority"] = (baselines.majority(train, valid), baselines.majority(train + valid, test))
    methods["item_record"] = (baselines.item_record(train, valid), baselines.item_record(train + valid, test))
    methods["item_record_online"] = (baselines.item_record_online(train + valid, len(train)), baselines.item_record_online(everything, scored_from))
    started = time.time()
    methods["one_latent_variable"] = (baselines.one_latent_variable(train, valid), baselines.one_latent_variable(train + valid, test))
    log(f"  1-LV trained twice in {time.time() - started:.0f} s")

    results: dict[str, dict] = {}
    for method, (valid_p, test_p) in methods.items():
        thresholds = best_thresholds(valid_p, valid_truth)
        results[method] = {
            "meanAuc": mean_auc(test_p, truth),
            "classAuc": dict(zip(OUTCOMES, class_aucs(test_p, truth))),
            "logLoss": log_loss(test_p, truth),
            "macroF1": macro_f1(decide(test_p, thresholds), truth),
        }
        log(f"    {method:22s} mean AUC {results[method]['meanAuc']:.4f}  log-loss {results[method]['logLoss']:.4f}  macro-F1 {results[method]['macroF1']:.4f}")

    comparisons = {}
    for ours, theirs in (("fit_engine", "item_record_online"), ("fit_engine_frozen", "item_record"), ("fit_engine", "one_latent_variable"), ("fit_engine", "fit_engine_one_offset")):
        diff, low, high = paired_bootstrap(methods[ours][1], methods[theirs][1], truth, mean_auc)
        comparisons[f"{ours}_vs_{theirs}"] = {"difference": diff, "low": low, "high": high}
        log(f"    {ours} - {theirs}: {diff:+.4f} [{low:+.4f}, {high:+.4f}]")
    report = {
        "transactions": len(rows),
        "sizes": sizes,
        "split": {"train": len(train), "validation": len(valid), "test": len(test), "byDate": all(row.when is not None for row in rows)},
        "testShares": dict(zip(OUTCOMES, (np.bincount(truth, minlength=3) / len(truth)).tolist())),
        "params": params.as_json(),
        "validationLogLoss": valid_loss,
        "oneOffsetParams": one_offset.as_json(),
        "oneOffsetValidationLogLoss": one_offset_loss,
        "results": results,
        "comparisons": comparisons,
    }
    return report, params, test


COUNT_CASES = [(0, 0, 0), (600, 300, 50), (50, 300, 600), (40, 400, 40), (6, 3, 0.5), (120, 120, 120), (3, 90, 2)]


def parity_fixture(params: FitParams, rows: list[Transaction], count: int = 200) -> dict:
    """A run of the engine the shop's TypeScript must reproduce: each step's prediction and the beliefs after it, and items read from fit counts."""
    items: dict = {}
    customers: dict[str, tuple[float, float]] = {}
    steps = []

    def as_item(item) -> dict:
        return {"offset": list(item[0]), "tolerance": list(item[1])}

    for row in rows[:count]:
        item = items.get(row.item, unknown_item(params))
        customer = customers.get(row.customer, (row.size, params.customer_prior ** 2))
        p = predict(params, row.size, item, customer)
        new_item, new_customer = update(params, row.size, item, customer, OUTCOMES[row.label])
        items[row.item], customers[row.customer] = new_item, new_customer
        steps.append({"size": row.size, "item": as_item(item), "customer": list(customer), "outcome": OUTCOMES[row.label], "predicted": list(p), "itemAfter": as_item(new_item), "customerAfter": list(new_customer)})
    counts = [{"counts": list(case), "toleranceMean": tol, "item": as_item(item_from_counts(params, *case, tolerance_mean=tol))} for case in COUNT_CASES for tol in (0.0, 0.1 * params.margin)]
    return {"params": params.as_json(), "steps": steps, "counts": counts}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--data", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--model", type=Path)
    parser.add_argument("--parity", type=Path)
    parser.add_argument("--only", choices=sorted(DATASETS))
    parser.add_argument("--sizes", choices=("ladder", "raw"), default="ladder")
    args = parser.parse_args()

    lines: list[str] = []

    def log(text: str) -> None:
        print(text, flush=True)
        lines.append(text)

    report = {"ranAt": datetime.now(timezone.utc).isoformat(), "datasets": {}}
    for name, file in DATASETS.items():
        if args.only is not None and name != args.only:
            continue
        rows = load(args.data / file)
        report["datasets"][name], params, test = evaluate(name, rows, args.sizes, log)
        if name == "renttherunway":
            if args.model is not None:
                args.model.write_text(json.dumps({
                    "source": f"E12 on RentTheRunway (research/fit, {report['ranAt'][:10]}): parameters chosen on validation log-loss, in steps of each item's size ladder; the shop keeps their ratios and sets the margin to half a size, as its charts define it.",
                    "params": params.as_json(),
                    "scale": 0.5 / params.margin,
                }, indent=2) + "\n", encoding="utf-8")
            if args.parity is not None:
                args.parity.write_text(json.dumps(parity_fixture(params, test)) + "\n", encoding="utf-8")

    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.with_suffix(".json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    args.report.with_suffix(".log").write_text("\n".join(lines) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
