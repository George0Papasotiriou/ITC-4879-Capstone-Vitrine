# Vitrine — AI-native e-shop (ITC 4949 Capstone)
# Copyright (c) 2026 George Papasotiriou. All rights reserved.
# Author: George Papasotiriou <g.papasotiriou@acg.edu>
# Project started: 2026-09-12
#
# NDCG@10 and MRR exactly as E1 computes them (src/lib/search/metrics.ts), and paired bootstrap intervals.

"""E1's measures, in numpy.

gain(g) = 2^g − 1, discount(position) = log2(position + 2) for a 0-based
position; NDCG@10 divides by the DCG of the query's ideal ranking over
everything judged for it (retrieved or not), and a query whose ideal is 0
is left out. MRR is the reciprocal rank of the first product graded 2 or
more within the top ten, 0 when there is none. Ties in a score keep the row
order, the shop's fused order (the learned stage does the same).
"""

from __future__ import annotations

import numpy as np

from .data import Dataset


def dcg(grades: np.ndarray, k: int = 10) -> float:
    top = np.asarray(grades[:k], dtype=np.float64)
    return float(np.sum((2.0**top - 1.0) / np.log2(np.arange(len(top)) + 2.0)))


def order(scores: np.ndarray) -> np.ndarray:
    """Positions sorted by score, highest first; ties keep their original order (a stable sort)."""
    return np.argsort(-scores, kind="stable")


def per_query(data: Dataset, scores: np.ndarray, k: int = 10) -> tuple[np.ndarray, np.ndarray, list[int]]:
    """Each query's NDCG@k and MRR@k under these scores, and the ids of the queries scored."""
    ndcgs: list[float] = []
    rrs: list[float] = []
    kept: list[int] = []
    for start, end in data.bounds:
        query = int(data.qid[start])
        grades = data.y[start:end]
        ideal_grades = np.asarray(data.ideal[query], dtype=np.float64) if data.ideal is not None and query in data.ideal else np.sort(grades)[::-1]
        ideal = dcg(ideal_grades, k)
        if ideal == 0:
            continue
        ranked = grades[order(scores[start:end])]
        ndcgs.append(dcg(ranked, k) / ideal)
        relevant = np.nonzero(ranked[:k] >= 2)[0]
        rrs.append(0.0 if len(relevant) == 0 else 1.0 / (relevant[0] + 1))
        kept.append(query)
    return np.asarray(ndcgs), np.asarray(rrs), kept


def mean_ndcg(data: Dataset, scores: np.ndarray, k: int = 10) -> float:
    values, _, _ = per_query(data, scores, k)
    return float(values.mean()) if len(values) > 0 else 0.0


def paired_bootstrap(a: np.ndarray, b: np.ndarray, repeats: int = 1000, seed: int = 57) -> tuple[float, float, float]:
    """The mean of a − b over queries, and its 95% interval from resampling the queries (both systems together)."""
    rng = np.random.default_rng(seed)
    difference = a - b
    n = len(difference)
    means = np.array([difference[rng.integers(0, n, n)].mean() for _ in range(repeats)])
    return float(difference.mean()), float(np.percentile(means, 2.5)), float(np.percentile(means, 97.5))
