# Vitrine — AI-native e-shop (ITC 4949 Capstone)
# Copyright (c) 2026 George Papasotiriou. All rights reserved.
# Author: George Papasotiriou <g.papasotiriou@acg.edu>
# Project started: 2026-09-12
#
# The ranker's data: the rows scripts/esci-ranker-data.ts writes, grouped by query.

"""Loading the ranker's data.

Each CSV row is one (query, candidate): the query's id, the human grade
(3 exact, 2 substitute, 1 complement, 0 irrelevant or unlabelled), the
product's ESCI id and the features of src/lib/search/ranker.ts, in its order.
Rows of one query are contiguous and in the shop's fused order, so the row
order itself is the "fusion" baseline. Beside each CSV, ideal-<name>.json
holds every query's ten best grades over all its judged products: the ideal
E1's NDCG divides by.
"""

from __future__ import annotations

import csv
import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np


@dataclass
class Dataset:
    features: list[str]
    X: np.ndarray  # (rows, features), float64
    y: np.ndarray  # (rows,), int64 grades 0..3
    qid: np.ndarray  # (rows,), int64
    product: list[str]
    # Each query's rows, in order: [start, end) into X.
    bounds: list[tuple[int, int]]
    # Each query's ten best grades over everything judged for it (E1's ideal), or None.
    ideal: dict[int, list[int]] | None

    def queries(self) -> list[int]:
        return [int(self.qid[start]) for start, _ in self.bounds]

    def subset(self, keep: list[int]) -> "Dataset":
        """The same rows with only the features at these column indices (for ablations)."""
        return Dataset([self.features[i] for i in keep], self.X[:, keep], self.y, self.qid, self.product, self.bounds, self.ideal)


def load(csv_path: Path, ideal_path: Path | None = None) -> Dataset:
    with csv_path.open(newline="", encoding="utf-8") as handle:
        reader = csv.reader(handle)
        header = next(reader)
        features = header[3:]
        qid: list[int] = []
        grade: list[int] = []
        product: list[str] = []
        values: list[list[float]] = []
        for row in reader:
            if not row:
                continue
            qid.append(int(row[0]))
            grade.append(int(row[1]))
            product.append(row[2])
            values.append([float(value) for value in row[3:]])
    q = np.asarray(qid, dtype=np.int64)
    bounds: list[tuple[int, int]] = []
    start = 0
    for index in range(1, len(q) + 1):
        if index == len(q) or q[index] != q[start]:
            bounds.append((start, index))
            start = index
    ideal = None
    if ideal_path is not None and ideal_path.exists():
        ideal = {int(key): list(value) for key, value in json.loads(ideal_path.read_text(encoding="utf-8")).items()}
    return Dataset(features, np.asarray(values, dtype=np.float64).reshape(len(q), len(features)), np.asarray(grade, dtype=np.int64), q, product, bounds, ideal)
