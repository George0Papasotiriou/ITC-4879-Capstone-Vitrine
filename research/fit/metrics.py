# Vitrine — AI-native e-shop (ITC 4949 Capstone)
# Copyright (c) 2026 George Papasotiriou. All rights reserved.
# Author: George Papasotiriou <g.papasotiriou@acg.edu>
# Project started: 2026-09-12
#
# E12's measures: each class's AUC and their mean, log-loss, macro-F1 with thresholds chosen on validation, and paired bootstrap intervals.

"""E12's measures (docs/adr/064).

AUC is the measure Misra et al. (2018) report for fit prediction: for each of
small, fit and large, the probability that a transaction of that class is
scored above one that is not (Mann-Whitney), averaged over the three.
"""

from __future__ import annotations

import numpy as np


def auc(scores: np.ndarray, positive: np.ndarray) -> float:
    """Area under the ROC curve by ranks, ties sharing their mean rank."""
    n_pos = int(positive.sum())
    n_neg = len(positive) - n_pos
    if n_pos == 0 or n_neg == 0:
        return float("nan")
    # Ranks 1..n with ties sharing the mean of the ranks they span.
    _, inverse, counts = np.unique(scores, return_inverse=True, return_counts=True)
    ends = np.cumsum(counts)
    mean_rank = ends - (counts - 1) / 2.0
    ranks = mean_rank[inverse]
    return float((ranks[positive].sum() - n_pos * (n_pos + 1) / 2.0) / (n_pos * n_neg))


def mean_auc(probabilities: np.ndarray, labels: np.ndarray) -> float:
    """The three one-against-the-rest AUCs, averaged. probabilities: (n, 3)."""
    return float(np.mean([auc(probabilities[:, k], labels == k) for k in range(3)]))


def class_aucs(probabilities: np.ndarray, labels: np.ndarray) -> list[float]:
    return [auc(probabilities[:, k], labels == k) for k in range(3)]


def log_loss(probabilities: np.ndarray, labels: np.ndarray) -> float:
    picked = probabilities[np.arange(len(labels)), labels]
    return float(-np.mean(np.log(np.clip(picked, 1e-12, 1.0))))


def decide(probabilities: np.ndarray, thresholds: tuple[float, float]) -> np.ndarray:
    """Small when P(small) passes its threshold, large when P(large) does (the larger wins), fit otherwise."""
    small_t, large_t = thresholds
    out = np.ones(len(probabilities), dtype=int)
    small = probabilities[:, 0] >= small_t
    large = probabilities[:, 2] >= large_t
    out[small & ~large] = 0
    out[large & ~small] = 2
    both = small & large
    out[both] = np.where(probabilities[both, 0] - small_t >= probabilities[both, 2] - large_t, 0, 2)
    return out


def macro_f1(predicted: np.ndarray, labels: np.ndarray) -> float:
    scores = []
    for k in range(3):
        tp = int(np.sum((predicted == k) & (labels == k)))
        fp = int(np.sum((predicted == k) & (labels != k)))
        fn = int(np.sum((predicted != k) & (labels == k)))
        scores.append(0.0 if tp == 0 else 2 * tp / (2 * tp + fp + fn))
    return float(np.mean(scores))


def best_thresholds(probabilities: np.ndarray, labels: np.ndarray) -> tuple[float, float]:
    """The pair of thresholds with the best macro-F1 on this (validation) data, from a grid of quantiles."""
    grid_small = np.unique(np.quantile(probabilities[:, 0], np.linspace(0.5, 0.99, 40)))
    grid_large = np.unique(np.quantile(probabilities[:, 2], np.linspace(0.5, 0.99, 40)))
    best = (1.0, 1.0)
    best_score = -1.0
    for s in grid_small:
        for l in grid_large:
            score = macro_f1(decide(probabilities, (float(s), float(l))), labels)
            if score > best_score:
                best_score, best = score, (float(s), float(l))
    return best


def paired_bootstrap(a: np.ndarray, b: np.ndarray, labels: np.ndarray, measure, resamples: int = 1000, seed: int = 11) -> tuple[float, float, float]:
    """measure(a) - measure(b) on the same resampled transactions: the difference and its 95% interval."""
    rng = np.random.default_rng(seed)
    n = len(labels)
    diffs = np.empty(resamples)
    for r in range(resamples):
        idx = rng.integers(0, n, n)
        diffs[r] = measure(a[idx], labels[idx]) - measure(b[idx], labels[idx])
    return float(measure(a, labels) - measure(b, labels)), float(np.quantile(diffs, 0.025)), float(np.quantile(diffs, 0.975))
