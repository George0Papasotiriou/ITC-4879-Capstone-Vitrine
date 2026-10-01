# Vitrine — AI-native e-shop (ITC 4949 Capstone)
# Copyright (c) 2026 George Papasotiriou. All rights reserved.
# Author: George Papasotiriou <g.papasotiriou@acg.edu>
# Project started: 2026-09-12
#
# The Taste Graph, ported from the shop (src/lib/reco/graph.ts and walk.ts): edges, the blend, and the random walk with restart.

"""The Taste Graph (A2), as the shop computes it, in Python.

Every formula is the shop's (src/lib/reco/graph.ts, walk.ts); the tests check
the two give the same numbers on a shared fixture (tests/test_parity.py).

EDGES. Two items in one session, within 30 minutes, are related by

    w_ij = Σ √(weight(e_i) · weight(e_j)) · exp(−|t_i − t_j| / τ) · 0.5^(age / 30 days)

with OTTO's events mapped onto the shop's: a click is a view (1), a cart a
cart (3), an order a purchase (6); τ = 10 minutes; the age is the later
event's, measured from the end of the training data. Then normalised by the
geometric mean of the two items' weighted degrees, ŵ_ij = w_ij / √(deg_i · deg_j),
so bestsellers are not everyone's neighbour.

BLEND. OTTO has no product descriptions, so there are no content edges: the
blend keeps the behaviour edges, the top 50 per item, normalised so each row
sums to 1 — the walk's transition matrix P.

WALK. For a session's history, the seed vector s gives each item the weight of
its events, halved every three days back from the session's last event, summed
to 1; then four steps of

    r ← (1 − c) · Pᵀ r + c · s,    c = 0.3

with a dangling item's mass returned to the seeds. The items with the most mass
are recommended.

TWO WAYS TO USE IT. As the shop does, the seeds themselves are not recommended
(the shopper has just seen them). OTTO's sessions click the same items again
and again, so a second variant puts the history first — most recent and
strongest first — and fills the rest of the 20 from the walk, as the
co-visitation baseline does; that is the fair comparison for OTTO, and the
evaluation reports both.

ABLATIONS. Without time decay (τ and the half-life infinite), and without the
degree normalisation (raw w_ij): what each of the two ideas adds.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import polars as pl

EVENT_WEIGHT = {0: 1.0, 1: 3.0, 2: 6.0}
MINUTE_S = 60
DAY_S = 24 * 3600
RESTART = 0.3
ITERATIONS = 4
TOP_K = 50

Neighbours = dict[int, dict[int, float]]


@dataclass(frozen=True)
class Options:
    window_s: int = 30 * MINUTE_S
    tau_s: float = 10 * MINUTE_S
    half_life_s: float = 30 * DAY_S
    decay: bool = True
    normalise: bool = True
    top_k: int = TOP_K


def behaviour_edges_pure(events: list[tuple[int, int, int, int]], now_s: int, options: Options = Options()) -> tuple[Neighbours, Neighbours, dict[int, int]]:
    """The shop's behaviourEdges, line for line: (session, aid, ts seconds, type) → raw edges, normalised edges, counts."""
    counts: dict[int, int] = {}
    sessions: dict[int, list[tuple[int, int, int]]] = {}
    for session, aid, ts, kind in events:
        counts[aid] = counts.get(aid, 0) + 1
        sessions.setdefault(session, []).append((ts, aid, kind))
    raw: Neighbours = {}

    def add(a: int, b: int, weight: float) -> None:
        row = raw.setdefault(a, {})
        row[b] = row.get(b, 0.0) + weight

    for items in sessions.values():
        # A stable sort by time, as the shop's Array.prototype.sort (stable since ES2019).
        items.sort(key=lambda event: event[0])
        for i, (first_ts, first_aid, first_kind) in enumerate(items):
            first_weight = EVENT_WEIGHT[first_kind]
            for second_ts, second_aid, second_kind in items[i + 1 :]:
                gap = second_ts - first_ts
                if gap > options.window_s:
                    break
                if second_aid == first_aid:
                    continue
                age = max(0, now_s - second_ts)
                weight = math.sqrt(first_weight * EVENT_WEIGHT[second_kind])
                if options.decay:
                    weight *= math.exp(-gap / options.tau_s) * 0.5 ** (age / options.half_life_s)
                add(first_aid, second_aid, weight)
                add(second_aid, first_aid, weight)
    degree = {aid: sum(row.values()) for aid, row in raw.items()}
    if not options.normalise:
        return raw, {aid: dict(row) for aid, row in raw.items()}, counts
    normalised = {aid: {other: weight / math.sqrt(degree[aid] * degree[other]) for other, weight in row.items()} for aid, row in raw.items()}
    return raw, normalised, counts


def behaviour_edges(events: pl.DataFrame, now_s: int, options: Options = Options()) -> pl.DataFrame:
    """The same edges for millions of events, with polars: columns aid_x, aid_y, w (normalised unless switched off)."""
    weighted = events.select(
        "session",
        "aid",
        "ts",
        pl.col("type").replace_strict(EVENT_WEIGHT, return_dtype=pl.Float64).alias("ew"),
    ).with_columns(pl.int_range(pl.len()).over("session", order_by="ts").alias("order"))
    left = weighted.rename({"aid": "aid_x", "ts": "ts_x", "ew": "ew_x", "order": "o_x"})
    right = weighted.rename({"aid": "aid_y", "ts": "ts_y", "ew": "ew_y", "order": "o_y"})
    # Each ordered pair (an event and a later one in the same session, within the window), as the shop's two loops.
    pairs = left.join(right, on="session").filter((pl.col("o_y") > pl.col("o_x")) & (pl.col("ts_y") - pl.col("ts_x") <= options.window_s) & (pl.col("aid_x") != pl.col("aid_y")))
    weight = (pl.col("ew_x") * pl.col("ew_y")).sqrt()
    if options.decay:
        gap = (pl.col("ts_y") - pl.col("ts_x")).cast(pl.Float64)
        age = (pl.lit(now_s) - pl.col("ts_y")).clip(lower_bound=0).cast(pl.Float64)
        weight = weight * (-gap / options.tau_s).exp() * pl.lit(0.5).pow(age / options.half_life_s)
    one_way = pairs.select("aid_x", "aid_y", weight.alias("w"))
    both = pl.concat([one_way, one_way.select(pl.col("aid_y").alias("aid_x"), pl.col("aid_x").alias("aid_y"), "w")])
    raw = both.group_by(["aid_x", "aid_y"]).agg(pl.col("w").sum())
    if not options.normalise:
        return raw
    degree = raw.group_by("aid_x").agg(pl.col("w").sum().alias("deg"))
    return (
        raw.join(degree, on="aid_x")
        .join(degree.rename({"aid_x": "aid_y", "deg": "deg_y"}), on="aid_y")
        .select("aid_x", "aid_y", (pl.col("w") / (pl.col("deg") * pl.col("deg_y")).sqrt()).alias("w"))
    )


def transitions_pure(normalised: Neighbours, top_k: int = TOP_K) -> Neighbours:
    """The shop's blend with no content edges: top K per item, rows summing to 1."""
    result: Neighbours = {}
    for aid, row in normalised.items():
        top = sorted(((other, weight) for other, weight in row.items() if weight > 0), key=lambda pair: (-pair[1], str(pair[0])))[:top_k]
        total = sum(weight for _, weight in top)
        if total > 0:
            result[aid] = {other: weight / total for other, weight in top}
    return result


def transitions(edges: pl.DataFrame, top_k: int = TOP_K) -> Neighbours:
    """The same from the polars edges. Ties are broken by the neighbour's id written as text, as the shop's localeCompare on ids."""
    top = (
        edges.filter(pl.col("w") > 0)
        .with_columns(pl.col("aid_y").cast(pl.String).alias("key"))
        .sort(["aid_x", "w", "key"], descending=[False, True, False])
        .group_by("aid_x", maintain_order=True)
        .head(top_k)
        .with_columns((pl.col("w") / pl.col("w").sum().over("aid_x")).alias("p"))
    )
    result: Neighbours = {}
    for aid_x, aid_y, probability in zip(top["aid_x"].to_list(), top["aid_y"].to_list(), top["p"].to_list(), strict=True):
        result.setdefault(aid_x, {})[aid_y] = probability
    return result


def seed_vector(history: list[tuple[int, int, int]], *, half_life_s: float = 3 * DAY_S) -> dict[int, float]:
    """The shop's seedVector: (aid, ts, type) events → weights halved every three days back from the last event, summing to 1."""
    if not history:
        return {}
    now = max(ts for _, ts, _ in history)
    seeds: dict[int, float] = {}
    for aid, ts, kind in history:
        seeds[aid] = seeds.get(aid, 0.0) + EVENT_WEIGHT[kind] * 0.5 ** (max(0, now - ts) / half_life_s)
    total = sum(seeds.values())
    return {aid: weight / total for aid, weight in seeds.items()} if total > 0 else seeds


def random_walk_with_restart(graph: Neighbours, seeds: dict[int, float], *, restart: float = RESTART, iterations: int = ITERATIONS) -> dict[int, float]:
    """The shop's randomWalkWithRestart: four steps of r ← (1 − c)·Pᵀr + c·s, dangling mass back to the seeds."""
    if not 0 < restart <= 1:
        raise ValueError("restart must be in (0, 1]")
    scores = dict(seeds)
    for _ in range(iterations):
        following: dict[int, float] = {}
        dangling = 0.0
        for node, mass in scores.items():
            row = graph.get(node)
            if not row:
                dangling += mass
                continue
            if restart == 1:
                continue
            for neighbour, probability in row.items():
                following[neighbour] = following.get(neighbour, 0.0) + (1 - restart) * mass * probability
        to_seeds = restart + (1 - restart) * dangling
        for seed, weight in seeds.items():
            following[seed] = following.get(seed, 0.0) + to_seeds * weight
        scores = following
    return scores


class TasteGraph:
    """The recommender for the evaluation: fitted on training events, asked one session's history at a time."""

    def __init__(self, train: pl.DataFrame, options: Options = Options(), *, with_history: bool = True) -> None:
        now = int(train["ts"].max())
        self.graph = transitions(behaviour_edges(train, now, options), options.top_k)
        self.with_history = with_history
        self.top_clicks = train.filter(pl.col("type") == 0)["aid"].value_counts(sort=True).head(20)["aid"].to_list()
        self.top_orders = train.filter(pl.col("type") == 2)["aid"].value_counts(sort=True).head(20)["aid"].to_list()

    def _ranked(self, aids: list[int], tss: list[int], types: list[int]) -> tuple[list[int], list[int]]:
        seeds = seed_vector(list(zip(aids, tss, types, strict=True)))
        walked = random_walk_with_restart(self.graph, seeds)
        # The history, strongest seed first (the same weights the walk starts from); then what the walk reaches.
        history = sorted(seeds, key=lambda aid: (-seeds[aid], aid))
        found = [aid for aid, _ in sorted(walked.items(), key=lambda pair: (-pair[1], pair[0])) if aid not in seeds]
        return history, found

    def _list(self, aids: list[int], tss: list[int], types: list[int], fill: list[int]) -> list[int]:
        history, found = self._ranked(aids, tss, types)
        result = (history + found)[:20] if self.with_history else found[:20]
        return result + [aid for aid in fill if aid not in result and (self.with_history or aid not in history)][: 20 - len(result)]

    def clicks_for(self, aids: list[int], types: list[int], tss: list[int]) -> list[int]:
        return self._list(aids, tss, types, self.top_clicks)

    def buys_for(self, aids: list[int], types: list[int], tss: list[int]) -> list[int]:
        return self._list(aids, tss, types, self.top_orders)
