# Vitrine — AI-native e-shop (ITC 4949 Capstone)
# Copyright (c) 2026 George Papasotiriou. All rights reserved.
# Author: George Papasotiriou <g.papasotiriou@acg.edu>
# Project started: 2026-09-12
#
# E1-ML: train the learned ranker, compare it with fusion and a linear baseline on E1's test queries, export it for the shop.

"""E1-ML.

    python -m ranker.evaluate --data ../.local/esci/ranker \\
        --model ../src/lib/search/models/ranker-v1.json \\
        --report ../docs/report/evaluations/e1-ml

1. LambdaMART on train.csv, stopped early on valid.csv (both from ESCI's
   train split); a linear LambdaRank on the same data, as the baseline.
2. On test.csv — E1's own 500 test queries and candidates, never seen in
   training or in choosing anything — NDCG@10 and MRR for: the shop's fused
   order (the row order), the linear model, and LambdaMART; each difference
   with a paired bootstrap 95% interval over queries (1,000 resamples).
3. An ablation: LambdaMART retrained without each group of features.
4. The model in the shop's format, and a parity fixture: 200 test rows and
   their scores, which src/lib/search/ranker.test.ts must reproduce.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from .data import Dataset, load
from .lambdamart import Model, train, train_linear
from .metrics import paired_bootstrap, per_query

# Groups of features for the ablation, by name (src/lib/search/ranker.ts FEATURE_NAMES).
GROUPS = {
    "retriever evidence": ["lexical_score", "lexical_rr", "fuzzy_score", "fuzzy_rr", "rrf_score", "rrf_rr", "both_retrievers"],
    "word overlap": ["coverage", "idf_coverage", "max_idf_matched", "bigram_order", "trigram_similarity"],
    "colour, number, brand": ["color_match", "color_conflict", "number_match", "number_conflict", "brand_in_query", "first_word_in_query"],
    "lengths": ["query_words", "title_words_log"],
}
PARAMS = {"rounds": 600, "rate": 0.05, "depth": 6, "min_leaf": 50, "l2": 1.0, "patience": 50}


def log(line: str = "") -> None:
    print(line, flush=True)


def fusion_scores(data: Dataset) -> np.ndarray:
    """The shop's fused order is the row order: a decreasing score keeps it under a stable sort."""
    return -np.arange(len(data.y), dtype=np.float64)


def main() -> None:
    # The report prints "−" and "Δ"; a Windows console's default code page has neither.
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, required=True)
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--no-ablation", action="store_true")
    args = parser.parse_args()

    train_set = load(args.data / "train.csv", args.data / "ideal-train.json")
    valid_set = load(args.data / "valid.csv", args.data / "ideal-valid.json")
    test_set = load(args.data / "test.csv", args.data / "ideal-test.json")
    log(f"E1-ML: {len(train_set.bounds)} train, {len(valid_set.bounds)} validation and {len(test_set.bounds)} test queries; {len(train_set.features)} features")

    started = time.time()
    model, curve = train(train_set, valid_set, log=log, **PARAMS)
    log(f"  LambdaMART: {len(model.trees)} trees (best validation NDCG@10 {max(curve):.4f}) in {time.time() - started:.0f} s")
    linear = train_linear(train_set, valid_set)
    log("  linear LambdaRank trained")

    systems = {
        "fusion": fusion_scores(test_set),
        "linear": linear.predict(test_set.X),
        "lambdamart": model.predict(test_set.X),
    }
    scored = {name: per_query(test_set, scores) for name, scores in systems.items()}
    results = {name: {"ndcg10": float(values[0].mean()), "mrr": float(values[1].mean()), "queries": len(values[2])} for name, values in scored.items()}
    for name, result in results.items():
        log(f"  {name:<11} NDCG@10 {result['ndcg10']:.4f}  MRR {result['mrr']:.4f}  ({result['queries']} queries)")

    comparisons = {}
    for a, b in [("lambdamart", "fusion"), ("lambdamart", "linear"), ("linear", "fusion")]:
        for measure, index in [("ndcg10", 0), ("mrr", 1)]:
            mean, low, high = paired_bootstrap(scored[a][index], scored[b][index])
            comparisons[f"{a} − {b} {measure}"] = {"mean": mean, "low": low, "high": high}
            log(f"  {a} − {b} {measure}: {mean:+.4f} [{low:+.4f}, {high:+.4f}]")

    ablation = {}
    if not args.no_ablation:
        full = scored["lambdamart"][0]
        for group, names in GROUPS.items():
            keep = [i for i, name in enumerate(train_set.features) if name not in names]
            reduced, _ = train(train_set.subset(keep), valid_set.subset(keep), **PARAMS)
            values = per_query(test_set.subset(keep), reduced.predict(test_set.X[:, keep]))[0]
            mean, low, high = paired_bootstrap(values, full)
            ablation[group] = {"ndcg10": float(values.mean()), "difference": mean, "low": low, "high": high, "trees": len(reduced.trees)}
            log(f"  without {group}: NDCG@10 {values.mean():.4f} ({mean:+.4f} [{low:+.4f}, {high:+.4f}])")

    importance = model.importance()
    meta = {
        "at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "data": "ESCI small version, US, train split (seed 11), validation on a held-out corpus of it",
        "params": PARAMS,
        "trees": len(model.trees),
        "validation_ndcg10": max(curve),
        "test": results,
    }
    args.model.parent.mkdir(parents=True, exist_ok=True)
    args.model.write_text(json.dumps(model.export("ranker-v1", meta)) + "\n", encoding="utf-8")
    # Parity: 200 test rows spread over the file, and the scores this Python gives them.
    rows = np.linspace(0, len(test_set.y) - 1, 200).astype(int)
    parity = {"rows": test_set.X[rows].tolist(), "scores": model.predict(test_set.X[rows]).tolist()}
    args.model.with_suffix(".parity.json").write_text(json.dumps(parity) + "\n", encoding="utf-8")
    log(f"  wrote {args.model} and its parity fixture")

    report = {
        "at": meta["at"],
        "queries": {"train": len(train_set.bounds), "valid": len(valid_set.bounds), "test": len(test_set.bounds)},
        "rows": {"train": len(train_set.y), "valid": len(valid_set.y), "test": len(test_set.y)},
        "params": PARAMS,
        "trees": len(model.trees),
        "validation_curve": curve,
        "results": results,
        "comparisons": comparisons,
        "ablation": ablation,
        "importance": importance,
    }
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.with_suffix(".json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    log(f"  wrote {args.report.with_suffix('.json')}")


if __name__ == "__main__":
    main()
