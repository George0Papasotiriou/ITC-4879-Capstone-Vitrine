# Vitrine — AI-native e-shop (ITC 4949 Capstone)
# Copyright (c) 2026 George Papasotiriou. All rights reserved.
# Author: George Papasotiriou <g.papasotiriou@acg.edu>
# Project started: 2026-09-12
#
# E12's baselines: the commonest verdict, each item's own record, and the one-latent-variable model of Sembium et al. (2017).

"""E12's baselines (docs/adr/064).

1. Majority: always the training set's class shares — what a shop that knows
   nothing about sizes would say.
2. Item record: each item's own share of small / fit / large in training,
   smoothed towards the overall shares (add-k). "This runs small" is what
   most shops show, from reviews. Also kept up to date transaction by
   transaction (`item_record_online`), to match the Fit Engine as the shop
   runs it.
3. One latent variable (Sembium et al., RecSys 2017, the "1-LV" that Misra
   et al. 2018 compare against): a true size per customer and per item,
   f = w * (t_c - t_i) + b, and an ordinal logistic loss with two thresholds,
   learned by stochastic gradient descent on the training set.
"""

from __future__ import annotations

from collections import defaultdict

import numpy as np

from .data import Transaction


def majority(train: list[Transaction], rows: list[Transaction]) -> np.ndarray:
    shares = np.bincount([row.label for row in train], minlength=3) / len(train)
    return np.tile(shares, (len(rows), 1))


def item_record(train: list[Transaction], rows: list[Transaction], k: float = 5.0) -> np.ndarray:
    overall = np.bincount([row.label for row in train], minlength=3) / len(train)
    counts: dict[str, np.ndarray] = defaultdict(lambda: np.zeros(3))
    for row in train:
        counts[row.item][row.label] += 1
    out = np.empty((len(rows), 3))
    for i, row in enumerate(rows):
        c = counts.get(row.item)
        out[i] = overall if c is None else (c + k * overall) / (c.sum() + k)
    return out


def item_record_online(stream: list[Transaction], score_from: int, k: float = 5.0) -> np.ndarray:
    """The item record kept up to date: each transaction predicted from every one before it, then counted — the fair match for the Fit Engine learning as it goes."""
    totals = np.zeros(3)
    counts: dict[str, np.ndarray] = defaultdict(lambda: np.zeros(3))
    out = np.empty((len(stream) - score_from, 3))
    for index, row in enumerate(stream):
        if index >= score_from:
            overall = totals / totals.sum()
            c = counts.get(row.item)
            out[index - score_from] = overall if c is None else (c + k * overall) / (c.sum() + k)
        totals[row.label] += 1
        counts[row.item][row.label] += 1
    return out


def _sigmoid(x: np.ndarray | float) -> np.ndarray | float:
    return 1.0 / (1.0 + np.exp(-x))


def one_latent_variable(train: list[Transaction], rows: list[Transaction], epochs: int = 8, rate: float = 0.05, l2: float = 1e-3, seed: int = 3) -> np.ndarray:
    """1-LV: P(y <= k) = sigmoid(theta_k - f), f = s + o_i - t_c (the size taken, the item's offset, the customer's true size)."""
    rng = np.random.default_rng(seed)
    customers = {c: i for i, c in enumerate(sorted({row.customer for row in train}))}
    items = {c: i for i, c in enumerate(sorted({row.item for row in train}))}
    t = np.zeros(len(customers))
    o = np.zeros(len(items))
    # First guess of each customer's size: the mean size they took.
    sums = np.zeros(len(customers))
    ns = np.zeros(len(customers))
    for row in train:
        sums[customers[row.customer]] += row.size
        ns[customers[row.customer]] += 1
    t = sums / np.maximum(ns, 1)
    theta = np.array([-1.0, 1.0])
    scale = 1.0
    order = np.arange(len(train))
    for _ in range(epochs):
        rng.shuffle(order)
        for index in order:
            row = train[index]
            ci, ii = customers[row.customer], items[row.item]
            f = scale * (row.size + o[ii] - t[ci])
            # Ordinal logistic: P(small) = s0, P(<= fit) = s1.
            s0 = _sigmoid(theta[0] - f)
            s1 = _sigmoid(theta[1] - f)
            # d(-log p)/df for each class, from p = s0 / s1 - s0 / 1 - s1.
            if row.label == 0:
                grad_f = 1.0 - s0
                grad_t0, grad_t1 = -(1.0 - s0), 0.0
            elif row.label == 2:
                grad_f = -s1
                grad_t0, grad_t1 = 0.0, s1
            else:
                p = max(s1 - s0, 1e-9)
                d0 = s0 * (1 - s0)
                d1 = s1 * (1 - s1)
                grad_f = (d1 - d0) / p
                grad_t0, grad_t1 = d0 / p, -d1 / p
            o[ii] -= rate * (grad_f * scale + l2 * o[ii])
            t[ci] -= rate * (-grad_f * scale + l2 * 0.0)
            theta[0] -= rate * grad_t0
            theta[1] -= rate * grad_t1
            if theta[0] > theta[1] - 1e-3:
                theta[0] = theta[1] - 1e-3
    out = np.empty((len(rows), 3))
    for i, row in enumerate(rows):
        # A customer the training set never saw is taken to have chosen their own size.
        ti = t[customers[row.customer]] if row.customer in customers else row.size
        oi = o[items[row.item]] if row.item in items else 0.0
        f = scale * (row.size + oi - ti)
        s0 = _sigmoid(theta[0] - f)
        s1 = _sigmoid(theta[1] - f)
        out[i] = (s0, max(s1 - s0, 1e-9), 1.0 - s1)
    return out / out.sum(axis=1, keepdims=True)
