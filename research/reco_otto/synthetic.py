# Vitrine — AI-native e-shop (ITC 4949 Capstone)
# Copyright (c) 2026 George Papasotiriou. All rights reserved.
# Author: George Papasotiriou <g.papasotiriou@acg.edu>
# Project started: 2026-09-12
#
# Made-up sessions in OTTO's format, for testing the evaluation end to end. Never reported as results.

"""Synthetic OTTO-format sessions, so the whole evaluation can run and be tested
before the real data is downloaded. They are labelled synthetic wherever they
are used, and no number from them is ever reported as E2's result.

How they are made: items belong to hidden "aisles" (groups of related items).
A shopper starts in an aisle, clicks around it, sometimes wanders to another,
re-clicks earlier items, carts some of what they clicked and orders some of
what they carted — the patterns OTTO's real sessions are known to have, so a
recommender that learns co-occurrence should beat popularity here too.
Everything is drawn from a seeded generator: the same seed gives the same data.
"""

from __future__ import annotations

import numpy as np

DAY_S = 24 * 3600


def sessions(*, count: int = 4000, items: int = 600, aisles: int = 40, days: int = 28, seed: int = 7) -> list[dict]:
    """`count` sessions over `days` days, in OTTO's JSON shape."""
    random = np.random.default_rng(seed)
    aisle_of = random.integers(0, aisles, size=items)
    members = [np.flatnonzero(aisle_of == aisle) for aisle in range(aisles)]
    # A few items in every aisle are far more popular than the rest, as in any shop.
    popularity = random.pareto(1.6, size=items) + 1
    start = 1_659_304_800
    result: list[dict] = []
    for session in range(count):
        t = start + int(random.integers(0, days * DAY_S - 3600))
        aisle = int(random.integers(0, aisles))
        seen: list[int] = []
        events: list[dict] = []
        for _ in range(int(random.integers(2, 30))):
            if seen and random.random() < 0.25:
                aid = int(random.choice(seen))
            else:
                if random.random() < 0.12:
                    aisle = int(random.integers(0, aisles))
                pool = members[aisle] if members[aisle].size > 0 else np.arange(items)
                weights = popularity[pool] / popularity[pool].sum()
                aid = int(random.choice(pool, p=weights))
            seen.append(aid)
            t += int(random.integers(5, 240))
            events.append({"aid": aid, "ts": t, "type": "clicks"})
            if random.random() < 0.12:
                t += int(random.integers(5, 60))
                events.append({"aid": aid, "ts": t, "type": "carts"})
                if random.random() < 0.45:
                    t += int(random.integers(30, 600))
                    events.append({"aid": aid, "ts": t, "type": "orders"})
        result.append({"session": session, "events": events})
    return result
