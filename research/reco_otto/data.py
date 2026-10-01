# Vitrine — AI-native e-shop (ITC 4949 Capstone)
# Copyright (c) 2026 George Papasotiriou. All rights reserved.
# Author: George Papasotiriou <g.papasotiriou@acg.edu>
# Project started: 2026-09-12
#
# OTTO's sessions as a table, the last-week split, and the random truncation that makes the test.

"""Loading OTTO and building the test the way OTTO's own evaluation does.

THE DATA. One JSON object per session: {"session": 12, "events": [{"aid": 3,
"ts": 1659304800, "type": "clicks"}, ...]}. Types are clicks, carts and
orders. Timestamps are seconds in the Kaggle release and milliseconds in the
original release; both are read, and kept in seconds.

THE SPLIT (as otto-de/recsys-dataset's own evaluation): the last week's
sessions are the test; everything before it trains. A session that began
before the cut-off is training, and only its events before the cut-off count.

THE TRUNCATION. Each test session is cut at a random point: what came before
is the history a recommender sees; what came after is what it must predict.
The labels, as OTTO defines them:
    clicks   the first click after the cut (one item)
    carts    every item carted after the cut
    orders   every item ordered after the cut
The cut is drawn with a seeded generator, so a run can be repeated exactly.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np
import polars as pl

TYPES = {"clicks": 0, "carts": 1, "orders": 2}
WEEK_S = 7 * 24 * 3600


def _events_frame(sessions: pl.DataFrame) -> pl.DataFrame:
    """Sessions with nested events → one row per event: session, aid, ts (seconds), type (0, 1, 2)."""
    # A session with no events contributes no rows.
    events = sessions.filter(pl.col("events").list.len() > 0).explode("events", empty_as_null=False).unnest("events")
    events = events.with_columns(pl.col("type").replace_strict(TYPES, return_dtype=pl.Int8))
    # Milliseconds in the original release, seconds in Kaggle's: anything after the year 5138 in seconds is milliseconds.
    if events.height > 0 and events["ts"].max() > 10**11:
        events = events.with_columns((pl.col("ts") // 1000).alias("ts"))
    return events.select(
        pl.col("session").cast(pl.Int64),
        pl.col("aid").cast(pl.Int64),
        pl.col("ts").cast(pl.Int64),
        pl.col("type").cast(pl.Int8),
    ).sort(["session", "ts"])


def load(path: str | Path, *, sample_every: int = 1) -> pl.DataFrame:
    """OTTO sessions from a .jsonl file (the released format) or a .parquet of events.

    `sample_every` keeps one session in every N (by session id), so a laptop can
    run the evaluation on a fraction of the 12.9 million sessions; the same N
    always keeps the same sessions.
    """
    file = Path(path)
    if file.suffix == ".parquet":
        events = pl.scan_parquet(file)
        if sample_every > 1:
            events = events.filter(pl.col("session") % sample_every == 0)
        frame = events.collect()
        if frame["type"].dtype == pl.String:
            frame = frame.with_columns(pl.col("type").replace_strict(TYPES, return_dtype=pl.Int8))
        if frame.height > 0 and frame["ts"].max() > 10**11:
            frame = frame.with_columns((pl.col("ts") // 1000).alias("ts"))
        return frame.select(pl.col("session").cast(pl.Int64), pl.col("aid").cast(pl.Int64), pl.col("ts").cast(pl.Int64), pl.col("type").cast(pl.Int8)).sort(["session", "ts"])
    sessions = pl.scan_ndjson(file)
    if sample_every > 1:
        sessions = sessions.filter(pl.col("session") % sample_every == 0)
    return _events_frame(sessions.collect())


def from_records(records: list[dict]) -> pl.DataFrame:
    """The same table from sessions already in memory (tests, synthetic data)."""
    if not records:
        return pl.DataFrame(schema={"session": pl.Int64, "aid": pl.Int64, "ts": pl.Int64, "type": pl.Int8})
    return _events_frame(pl.DataFrame(records))


def split_last_week(events: pl.DataFrame) -> tuple[pl.DataFrame, pl.DataFrame]:
    """Training events (before the cut-off) and the test sessions (those that began after it)."""
    cutoff = int(events["ts"].max()) - WEEK_S
    starts = events.group_by("session").agg(pl.col("ts").min().alias("start"))
    test_sessions = starts.filter(pl.col("start") >= cutoff).select("session")
    train = events.filter(pl.col("ts") < cutoff)
    test = events.join(test_sessions, on="session", how="inner")
    return train, test


@dataclass(frozen=True)
class Truncated:
    """The test: what each session saw before its cut, and what came after."""

    history: pl.DataFrame
    clicks: dict[int, int]
    carts: dict[int, set[int]]
    orders: dict[int, set[int]]


def truncate(test: pl.DataFrame, *, seed: int = 4949) -> Truncated:
    """Cuts every test session of two or more events at a random point (OTTO's protocol)."""
    random = np.random.default_rng(seed)
    histories: list[pl.DataFrame] = []
    clicks: dict[int, int] = {}
    carts: dict[int, set[int]] = {}
    orders: dict[int, set[int]] = {}
    for (session,), events in test.sort(["session", "ts"]).group_by(["session"], maintain_order=True):
        if events.height < 2:
            continue
        cut = int(random.integers(1, events.height))
        histories.append(events.head(cut))
        future = events.slice(cut)
        future_clicks = future.filter(pl.col("type") == 0)["aid"]
        if future_clicks.len() > 0:
            clicks[int(session)] = int(future_clicks[0])
        future_carts = set(int(aid) for aid in future.filter(pl.col("type") == 1)["aid"])
        future_orders = set(int(aid) for aid in future.filter(pl.col("type") == 2)["aid"])
        if future_carts:
            carts[int(session)] = future_carts
        if future_orders:
            orders[int(session)] = future_orders
    history = pl.concat(histories) if histories else test.head(0)
    return Truncated(history=history, clicks=clicks, carts=carts, orders=orders)
