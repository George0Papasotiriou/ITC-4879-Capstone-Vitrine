# Vitrine — AI-native e-shop (ITC 4949 Capstone)
# Copyright (c) 2026 George Papasotiriou. All rights reserved.
# Author: George Papasotiriou <g.papasotiriou@acg.edu>
# Project started: 2026-09-12
#
# The baseline: co-visitation matrices and a hand-tuned reranker, as in the best-known public OTTO solution.

"""The co-visitation baseline (docs/PLAN.md reference [9]: C. Deotte, "Candidate
ReRank Model – LB 0.575", Kaggle, 2022), the strong and widely reproduced
starting point of the OTTO competition.

THREE MATRICES, each "items that occur together in sessions", built from each
session's last 30 events (pairs of different items, each pair counted once per
session):

    clicks        within 24 hours, weighted by time: later pairs count more,
                  1 + 3 · (t − t_first) / (t_last − t_first); top 20 per item
    carts-orders  within 24 hours, weighted by what the second item was:
                  click 1, cart 6, order 3; top 15 per item
    buy2buy       carted or ordered items only, within 14 days, weight 1;
                  top 15 per item

THE RERANKER, for a session's history (most recent first, each item once):
    clicks  with 20 or more items: the history itself, weighted by recency and
            event type. With fewer: the history, then the items the clicks
            matrix links to it most, then the most clicked items overall.
    buys    (one list for carts and orders) the same with the carts-orders and
            buy2buy matrices, filled with the most ordered items.
"""

from __future__ import annotations

from collections import Counter

import numpy as np
import polars as pl

TYPE_WEIGHT = {0: 1, 1: 6, 2: 3}
DAY_S = 24 * 3600


def _pairs(events: pl.DataFrame, window_s: int) -> pl.DataFrame:
    """Pairs of different items in the same session within the window, from each session's last 30 events."""
    recent = events.sort(["session", "ts"], descending=[False, True]).with_columns(pl.int_range(pl.len()).over("session").alias("n")).filter(pl.col("n") < 30).drop("n")
    left = recent.rename({"aid": "aid_x", "ts": "ts_x", "type": "type_x"})
    right = recent.rename({"aid": "aid_y", "ts": "ts_y", "type": "type_y"})
    pairs = left.join(right, on="session")
    return pairs.filter((pl.col("aid_x") != pl.col("aid_y")) & ((pl.col("ts_x") - pl.col("ts_y")).abs() < window_s))


def _top(pairs: pl.DataFrame, weight: pl.Expr, top_k: int) -> dict[int, list[int]]:
    """Each pair counted once per session, weights summed over sessions, top K neighbours per item."""
    scored = (
        # Sorted first, so the pair kept for a session (and its time and type) is the same on every run.
        pairs.sort(["session", "aid_x", "aid_y", "ts_x", "ts_y"], descending=[False, False, False, True, True])
        .unique(subset=["session", "aid_x", "aid_y"], keep="first", maintain_order=True)
        .with_columns(weight.alias("w"))
        .group_by(["aid_x", "aid_y"])
        .agg(pl.col("w").sum())
        .sort(["aid_x", "w", "aid_y"], descending=[False, True, False])
        .group_by("aid_x", maintain_order=True)
        .head(top_k)
    )
    neighbours: dict[int, list[int]] = {}
    for aid_x, aid_y in zip(scored["aid_x"].to_list(), scored["aid_y"].to_list(), strict=True):
        neighbours.setdefault(aid_x, []).append(aid_y)
    return neighbours


class CoVisitation:
    """The baseline, fitted on the training events."""

    def __init__(self, train: pl.DataFrame) -> None:
        ts_min, ts_max = int(train["ts"].min()), int(train["ts"].max())
        span = max(1, ts_max - ts_min)
        day_pairs = _pairs(train, DAY_S)
        self.clicks = _top(day_pairs, 1 + 3 * (pl.col("ts_x") - ts_min) / span, 20)
        self.carts_orders = _top(day_pairs, pl.col("type_y").replace_strict(TYPE_WEIGHT, return_dtype=pl.Float64), 15)
        buys = train.filter(pl.col("type") > 0)
        self.buy2buy = _top(_pairs(buys, 14 * DAY_S), pl.lit(1.0), 15)
        self.top_clicks = train.filter(pl.col("type") == 0)["aid"].value_counts(sort=True).head(20)["aid"].to_list()
        self.top_orders = train.filter(pl.col("type") == 2)["aid"].value_counts(sort=True).head(20)["aid"].to_list()

    @staticmethod
    def _recent_unique(aids: list[int]) -> list[int]:
        return list(dict.fromkeys(reversed(aids)))

    @staticmethod
    def _weighted_history(aids: list[int], types: list[int]) -> Counter[int]:
        # Recency weights from 0.07 (oldest) to 1 (newest), on a log scale, times the event type's weight.
        weights = np.logspace(0.1, 1, len(aids), base=2, endpoint=True) - 1
        counter: Counter[int] = Counter()
        for aid, weight, kind in zip(aids, weights, types, strict=True):
            counter[aid] += float(weight) * TYPE_WEIGHT[kind]
        return counter

    def clicks_for(self, aids: list[int], types: list[int]) -> list[int]:
        unique = self._recent_unique(aids)
        if len(unique) >= 20:
            return [aid for aid, _ in self._weighted_history(aids, types).most_common(20)]
        linked = Counter(aid for item in unique for aid in self.clicks.get(item, []))
        extra = [aid for aid, _ in linked.most_common(40) if aid not in unique]
        result = (unique + extra)[:20]
        return result + [aid for aid in self.top_clicks if aid not in result][: 20 - len(result)]

    def buys_for(self, aids: list[int], types: list[int]) -> list[int]:
        unique = self._recent_unique(aids)
        unique_buys = list(dict.fromkeys(reversed([aid for aid, kind in zip(aids, types, strict=True) if kind > 0])))
        if len(unique) >= 20:
            counter = self._weighted_history(aids, types)
            for aid in (aid for item in unique_buys for aid in self.buy2buy.get(item, [])):
                counter[aid] += 0.1
            return [aid for aid, _ in counter.most_common(20)]
        linked = Counter(aid for item in unique for aid in self.carts_orders.get(item, []))
        linked.update(aid for item in unique_buys for aid in self.buy2buy.get(item, []))
        extra = [aid for aid, _ in linked.most_common(40) if aid not in unique]
        result = (unique + extra)[:20]
        return result + [aid for aid in self.top_orders if aid not in result][: 20 - len(result)]


class Popularity:
    """The plainest baseline: the 20 most clicked items for clicks, the 20 most ordered for carts and orders."""

    def __init__(self, train: pl.DataFrame) -> None:
        self.top_clicks = train.filter(pl.col("type") == 0)["aid"].value_counts(sort=True).head(20)["aid"].to_list()
        self.top_orders = train.filter(pl.col("type") == 2)["aid"].value_counts(sort=True).head(20)["aid"].to_list()

    def clicks_for(self, aids: list[int], types: list[int]) -> list[int]:
        return list(self.top_clicks)

    def buys_for(self, aids: list[int], types: list[int]) -> list[int]:
        return list(self.top_orders)
