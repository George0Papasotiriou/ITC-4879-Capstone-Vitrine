# Vitrine — AI-native e-shop (ITC 4949 Capstone)
# Copyright (c) 2026 George Papasotiriou. All rights reserved.
# Author: George Papasotiriou <g.papasotiriou@acg.edu>
# Project started: 2026-09-12
#
# LambdaMART from scratch: lambda gradients of NDCG, histogram regression trees with Newton leaves, boosting with early stopping.

"""LambdaMART (Burges, 2010), written for this project in numpy.

THE OBJECTIVE. For one query, a pair (i, j) with grade_i > grade_j is
ordered right when score_i > score_j. RankNet's pair cost is
log(1 + exp(−σ(s_i − s_j))); LambdaRank weights it by |ΔNDCG_ij|, how much
NDCG would change if i and j swapped places in the current ranking. Its
derivatives give each document a gradient and a Hessian:

    ρ_ij = 1 / (1 + exp(σ(s_i − s_j)))
    g_i −= σ ρ_ij |ΔNDCG_ij|      g_j += σ ρ_ij |ΔNDCG_ij|
    h_i += σ² ρ_ij (1 − ρ_ij) |ΔNDCG_ij|   (and the same for h_j)

with |ΔNDCG_ij| = |gain_i − gain_j| · |1/log2(1 + r_i) − 1/log2(1 + r_j)| / IDCG,
gain = 2^grade − 1 and r the 1-based rank under the current scores. Pairs
where both documents are below the first `truncation` ranks are skipped, as
LightGBM does: they cannot change the top of the list.

THE TREES. Each round fits a regression tree to the gradients: features are
cut into at most 64 quantile bins once, a node's best split is found from
per-bin sums of g and h (histograms), scored by the second-order gain
½[G_L²/(H_L + λ) + G_R²/(H_R + λ) − G²/(H + λ)], and a leaf's value is the
Newton step −G / (H + λ). The new tree's values, times the learning rate,
are added to every document's score.

EARLY STOPPING. After each round, NDCG@10 on the validation queries (with
E1's ideal) decides; training stops 50 rounds after the best, and the model
keeps the trees up to the best.

Exported in the shop's format (src/lib/search/ranker.ts): flat node arrays,
threshold tests `x <= t` going left, the learning rate folded into the leaves.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from .data import Dataset
from .metrics import mean_ndcg, order

BINS = 64


@dataclass
class Tree:
    feature: list[int] = field(default_factory=list)
    threshold: list[float] = field(default_factory=list)
    left: list[int] = field(default_factory=list)
    right: list[int] = field(default_factory=list)
    value: list[float] = field(default_factory=list)
    # Each split's second-order gain (0 at a leaf), for feature importance.
    gain: list[float] = field(default_factory=list)

    def add(self, feature: int = -1, threshold: float = 0.0, value: float = 0.0) -> int:
        self.feature.append(feature)
        self.threshold.append(threshold)
        self.left.append(-1)
        self.right.append(-1)
        self.value.append(value)
        self.gain.append(0.0)
        return len(self.feature) - 1

    def predict(self, X: np.ndarray) -> np.ndarray:
        """Every row walks the tree at once, one level per step (the same test as the shop: x ≤ t goes left)."""
        feature = np.asarray(self.feature)
        threshold = np.asarray(self.threshold)
        left = np.asarray(self.left)
        right = np.asarray(self.right)
        node = np.zeros(len(X), dtype=np.int64)
        while True:
            active = np.nonzero(feature[node] >= 0)[0]
            if len(active) == 0:
                break
            here = node[active]
            goes_left = X[active, feature[here]] <= threshold[here]
            node[active] = np.where(goes_left, left[here], right[here])
        return np.asarray(self.value)[node]


@dataclass
class Model:
    features: list[str]
    trees: list[Tree]
    base: float = 0.0

    def predict(self, X: np.ndarray) -> np.ndarray:
        scores = np.full(len(X), self.base)
        for tree in self.trees:
            scores += tree.predict(X)
        return scores

    def importance(self) -> dict[str, float]:
        """Each feature's share of the total split gain across all trees."""
        totals = np.zeros(len(self.features))
        for tree in self.trees:
            for feature, gain in zip(tree.feature, tree.gain):
                if feature >= 0:
                    totals[feature] += gain
        whole = totals.sum() or 1.0
        return {name: float(value / whole) for name, value in zip(self.features, totals)}

    def export(self, version: str, meta: dict) -> dict:
        return {
            "version": version,
            "features": self.features,
            "base": self.base,
            "trees": [{"feature": t.feature, "threshold": t.threshold, "left": t.left, "right": t.right, "value": t.value} for t in self.trees],
            "trained": meta,
        }


def bin_edges(X: np.ndarray, bins: int = BINS) -> list[np.ndarray]:
    """Per feature, the distinct inner quantiles of its training values: a value goes to bin b when e_(b−1) < x ≤ e_b."""
    quantiles = np.linspace(0, 1, bins + 1)[1:-1]
    edges = []
    for column in range(X.shape[1]):
        cuts = np.unique(np.quantile(X[:, column], quantiles))
        # The largest value is no cut: nothing would go right of it.
        edges.append(cuts[cuts < X[:, column].max()])
    return edges


def to_bins(X: np.ndarray, edges: list[np.ndarray]) -> np.ndarray:
    return np.stack([np.searchsorted(edges[column], X[:, column], side="left") for column in range(X.shape[1])], axis=1).astype(np.int32)


def lambdas(data: Dataset, scores: np.ndarray, sigma: float = 1.0, truncation: int = 30) -> tuple[np.ndarray, np.ndarray]:
    """Each document's gradient and Hessian of the LambdaRank cost under the current scores (see the module's notes)."""
    g = np.zeros(len(scores))
    h = np.zeros(len(scores))
    for start, end in data.bounds:
        grades = data.y[start:end]
        if grades.max() == grades.min():
            continue
        s = scores[start:end]
        ranking = order(s)
        rank = np.empty(len(s), dtype=np.int64)
        rank[ranking] = np.arange(1, len(s) + 1)
        gain = 2.0 ** grades - 1.0
        ideal = np.sum(np.sort(gain)[::-1] / np.log2(np.arange(len(s)) + 2.0))
        discount = 1.0 / np.log2(1.0 + rank)
        better = grades[:, None] > grades[None, :]
        near_top = (rank[:, None] <= truncation) | (rank[None, :] <= truncation)
        pairs = better & near_top
        if not pairs.any():
            continue
        delta = np.abs(gain[:, None] - gain[None, :]) * np.abs(discount[:, None] - discount[None, :]) / ideal
        rho = 1.0 / (1.0 + np.exp(np.clip(sigma * (s[:, None] - s[None, :]), -50, 50)))
        weight = np.where(pairs, sigma * rho * delta, 0.0)
        hess = np.where(pairs, sigma * sigma * rho * (1.0 - rho) * delta, 0.0)
        g[start:end] += -weight.sum(axis=1) + weight.sum(axis=0)
        h[start:end] += hess.sum(axis=1) + hess.sum(axis=0)
    return g, h


def fit_tree(binned: np.ndarray, edges: list[np.ndarray], g: np.ndarray, h: np.ndarray, depth: int, min_leaf: int, l2: float, rate: float) -> Tree:
    """One regression tree on (g, h) by histogram splits, grown depth-first to `depth`, leaves −rate·G/(H + λ)."""
    tree = Tree()
    features = binned.shape[1]

    def grow(rows: np.ndarray, level: int) -> int:
        G = g[rows].sum()
        H = h[rows].sum()
        node = tree.add(value=float(-rate * G / (H + l2)))
        if level == depth or len(rows) < 2 * min_leaf:
            return node
        parent = G * G / (H + l2)
        best = (0.0, -1, -1)
        for column in range(features):
            if len(edges[column]) == 0:
                continue
            bins = binned[rows, column]
            size = len(edges[column]) + 1
            gs = np.bincount(bins, weights=g[rows], minlength=size)
            hs = np.bincount(bins, weights=h[rows], minlength=size)
            ns = np.bincount(bins, minlength=size)
            gl = np.cumsum(gs)[:-1]
            hl = np.cumsum(hs)[:-1]
            nl = np.cumsum(ns)[:-1]
            allowed = (nl >= min_leaf) & (len(rows) - nl >= min_leaf)
            if not allowed.any():
                continue
            gain = gl * gl / (hl + l2) + (G - gl) ** 2 / (H - hl + l2) - parent
            gain = np.where(allowed, gain, -np.inf)
            cut = int(np.argmax(gain))
            if gain[cut] > best[0]:
                best = (float(gain[cut]), column, cut)
        if best[1] < 0:
            return node
        split_gain, column, cut = best
        tree.gain[node] = 0.5 * split_gain
        tree.feature[node] = column
        tree.threshold[node] = float(edges[column][cut])
        goes_left = binned[rows, column] <= cut
        tree.left[node] = grow(rows[goes_left], level + 1)
        tree.right[node] = grow(rows[~goes_left], level + 1)
        tree.value[node] = 0.0
        return node

    grow(np.arange(len(g)), 0)
    return tree


def train(
    train_set: Dataset,
    valid_set: Dataset,
    rounds: int = 600,
    rate: float = 0.05,
    depth: int = 6,
    min_leaf: int = 50,
    l2: float = 1.0,
    patience: int = 50,
    log=None,
) -> tuple[Model, list[float]]:
    """Boosted trees by LambdaMART, stopped early on validation NDCG@10; returns the model and the validation curve."""
    edges = bin_edges(train_set.X)
    binned = to_bins(train_set.X, edges)
    scores = np.zeros(len(train_set.y))
    valid_scores = np.zeros(len(valid_set.y))
    trees: list[Tree] = []
    curve: list[float] = []
    best = (-1.0, 0)
    for round_ in range(rounds):
        g, h = lambdas(train_set, scores)
        tree = fit_tree(binned, edges, g, h, depth, min_leaf, l2, rate)
        trees.append(tree)
        scores += tree.predict(train_set.X)
        valid_scores += tree.predict(valid_set.X)
        valid = mean_ndcg(valid_set, valid_scores)
        curve.append(valid)
        if valid > best[0]:
            best = (valid, round_ + 1)
        if log is not None and (round_ + 1) % 25 == 0:
            log(f"    round {round_ + 1}: validation NDCG@10 {valid:.4f} (best {best[0]:.4f} at {best[1]})")
        if round_ + 1 - best[1] >= patience:
            break
    return Model(train_set.features, trees[: best[1]]), curve


@dataclass
class Linear:
    """The baseline: one weight per standardised feature, trained on the same lambdas (linear LambdaRank)."""

    features: list[str]
    mean: np.ndarray
    scale: np.ndarray
    weights: np.ndarray

    def predict(self, X: np.ndarray) -> np.ndarray:
        return ((X - self.mean) / self.scale) @ self.weights


def train_linear(train_set: Dataset, valid_set: Dataset, epochs: int = 300, rate: float = 0.5, patience: int = 30) -> Linear:
    mean = train_set.X.mean(axis=0)
    scale = train_set.X.std(axis=0)
    scale[scale == 0] = 1.0
    Z = (train_set.X - mean) / scale
    model = Linear(train_set.features, mean, scale, np.zeros(train_set.X.shape[1]))
    best = (-1.0, model.weights.copy(), 0)
    for epoch in range(epochs):
        g, _ = lambdas(train_set, Z @ model.weights)
        # Gradient of the cost with respect to the weights: Σ_i g_i · x_i, averaged per query.
        model.weights -= rate * (Z.T @ g) / len(train_set.bounds)
        valid = mean_ndcg(valid_set, model.predict(valid_set.X))
        if valid > best[0]:
            best = (valid, model.weights.copy(), epoch)
        if epoch - best[2] >= patience:
            break
    model.weights = best[1]
    return model
