# Vitrine — AI-native e-shop (ITC 4949 Capstone)
# Copyright (c) 2026 George Papasotiriou. All rights reserved.
# Author: George Papasotiriou <g.papasotiriou@acg.edu>
# Project started: 2026-09-12
#
# E12's data: RentTheRunway's and ModCloth's fit records (Misra, Wan and McAuley, RecSys 2018), read as one transaction per line.

"""E12's datasets (docs/adr/064).

Each line of the McAuley lab's files is one rental (RentTheRunway) or one
purchase (ModCloth) with the customer's own verdict on fit: "small", "fit"
or "large", the size taken, the customer and the item. RentTheRunway dates
each review; ModCloth does not, so it is split at random.
"""

from __future__ import annotations

import gzip
import json
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

LABELS = {"small": 0, "fit": 1, "large": 2}


@dataclass(frozen=True)
class Transaction:
    customer: str
    item: str
    size: float
    label: int  # 0 small, 1 fit, 2 large
    when: float | None  # a timestamp, or None (ModCloth)


def load(path: Path) -> list[Transaction]:
    """Every usable line: a known fit verdict and a numeric size, with the customer and the item."""
    rows: list[Transaction] = []
    with gzip.open(path, "rt", encoding="utf-8") as handle:
        for line in handle:
            if not line.strip():
                continue
            raw = json.loads(line)
            fit = raw.get("fit")
            if fit not in LABELS or raw.get("size") is None or raw.get("user_id") is None or raw.get("item_id") is None:
                continue
            when = None
            if raw.get("review_date"):
                try:
                    when = datetime.strptime(raw["review_date"], "%B %d, %Y").timestamp()
                except ValueError:
                    when = None
            rows.append(Transaction(str(raw["user_id"]), str(raw["item_id"]), float(raw["size"]), LABELS[fit], when))
    return rows


def split(rows: list[Transaction], seed: int = 7) -> tuple[list[Transaction], list[Transaction], list[Transaction]]:
    """80 / 10 / 10. By date where every row has one (the future is predicted from the past), otherwise at random with a fixed seed."""
    import random

    if all(row.when is not None for row in rows):
        ordered = sorted(rows, key=lambda row: (row.when, row.customer, row.item))
    else:
        ordered = list(rows)
        random.Random(seed).shuffle(ordered)
    n = len(ordered)
    a, b = int(n * 0.8), int(n * 0.9)
    return ordered[:a], ordered[a:b], ordered[b:]
