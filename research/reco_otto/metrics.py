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
