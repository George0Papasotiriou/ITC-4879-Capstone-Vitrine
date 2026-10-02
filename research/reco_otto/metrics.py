# Vitrine — AI-native e-shop (ITC 4949 Capstone)
# Copyright (c) 2026 George Papasotiriou. All rights reserved.
# Author: George Papasotiriou <g.papasotiriou@acg.edu>
# Project started: 2026-09-12
#
# OTTO's metric: Recall@20 for clicks, carts and orders, and their weighted sum.

"""Recall@20 as OTTO's competition and evaluation code define it.

For each event type t, over the test sessions s that have labels of that type:

    Recall@20_t = Σ_s |P_s ∩ L_s,t|  /  Σ_s min(20, |L_s,t|)

P_s is the recommender's list for the session, cut to its first 20; L_s,t the
items of type t that came after the cut. For clicks L holds the one next
click, so the click recall is the share of sessions whose next click was in
the 20. Dividing by min(20, |L|) means a session that ordered 30 items is not
expected to have had all 30 predicted.

    score = 0.10 · Recall@20_clicks + 0.30 · Recall@20_carts + 0.60 · Recall@20_orders

Orders weigh most, because an order is the event the shop is for.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence

WEIGHTS = {"clicks": 0.10, "carts": 0.30, "orders": 0.60}
K = 20


def recall_at_20(predictions: Mapping[int, Sequence[int]], labels: Mapping[int, int | set[int]]) -> float:
    """Recall@20 of one event type; `labels` maps a session to its one next click or its set of items."""
    hits = 0
    possible = 0
    for session, truth in labels.items():
        expected = {truth} if isinstance(truth, int) else truth
        if not expected:
            continue
        predicted = set(list(predictions.get(session, []))[:K])
        hits += len(predicted & expected)
        possible += min(K, len(expected))
    return hits / possible if possible > 0 else 0.0


def score(recalls: Mapping[str, float]) -> float:
    """OTTO's weighted score from the three recalls."""
    return sum(WEIGHTS[kind] * recalls[kind] for kind in WEIGHTS)


Counts = dict[int, tuple[int, int]]


def counts_per_session(predictions: Mapping[int, Sequence[int]], labels: Mapping[int, int | set[int]]) -> Counts:
    """Each labelled session's hits and possible hits, the two sums recall_at_20 divides."""
    counts: Counts = {}
    for session, truth in labels.items():
        expected = {truth} if isinstance(truth, int) else truth
        if not expected:
            continue
        predicted = set(list(predictions.get(session, []))[:K])
        counts[session] = (len(predicted & expected), min(K, len(expected)))
    return counts


def bootstrap(
    methods: Mapping[str, Mapping[str, Counts]],
    references: Sequence[str],
    *,
    repeats: int = 1000,
    seed: int = 4949,
) -> dict[str, dict]:
    """95% intervals for each method's score, and for its difference from each reference, by a paired bootstrap.

    Returns {method: {"score": (low, high), "difference": {reference: (low, high)}}}.

    The test sessions are drawn again with replacement `repeats` times; every
    method is scored on the same draw, so the difference between two methods
    keeps the pairing (both answered the same sessions) and its interval is
    much narrower than the two scores' intervals would suggest. The interval
    is the 2.5th to the 97.5th percentile of the redrawn values.
    """
    import numpy as np

    sessions = sorted({session for kinds in methods.values() for counts in kinds.values() for session in counts})
    index = {session: position for position, session in enumerate(sessions)}
    n = len(sessions)
    arrays: dict[str, dict[str, tuple[np.ndarray, np.ndarray]]] = {}
    for name, kinds in methods.items():
        arrays[name] = {}
        for kind in WEIGHTS:
            hits = np.zeros(n)
            possible = np.zeros(n)
            for session, (hit, total) in kinds[kind].items():
                hits[index[session]] = hit
                possible[index[session]] = total
            arrays[name][kind] = (hits, possible)
    random = np.random.default_rng(seed)
    scores = {name: np.zeros(repeats) for name in methods}
    done = 0
    while done < repeats:
        batch = min(100, repeats - done)
        draws = random.integers(0, n, size=(batch, n))
        for name in methods:
            total = np.zeros(batch)
            for kind, weight in WEIGHTS.items():
                hits, possible = arrays[name][kind]
                denominator = possible[draws].sum(axis=1)
                total += weight * np.divide(hits[draws].sum(axis=1), denominator, out=np.zeros(batch), where=denominator > 0)
            scores[name][done : done + batch] = total
        done += batch

    def interval(values: np.ndarray) -> tuple[float, float]:
        low, high = np.percentile(values, [2.5, 97.5])
        return float(low), float(high)

    return {
        name: {"score": interval(scores[name]), "difference": {reference: interval(scores[name] - scores[reference]) for reference in references}}
        for name in methods
    }
