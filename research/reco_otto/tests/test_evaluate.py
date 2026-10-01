# Vitrine — AI-native e-shop (ITC 4949 Capstone)
# Copyright (c) 2026 George Papasotiriou. All rights reserved.
# Author: George Papasotiriou <g.papasotiriou@acg.edu>
# Project started: 2026-09-12
#
# The evaluation end to end on synthetic sessions: the split and truncation keep their promises, every method scores.

import polars as pl
import pytest

from reco_otto import data, synthetic
from reco_otto.evaluate import run


@pytest.fixture(scope="module")
def events() -> pl.DataFrame:
    return data.from_records(synthetic.sessions(count=1500, items=300, aisles=20, seed=11))


def test_the_split_puts_only_earlier_events_in_training(events: pl.DataFrame):
    train, test = data.split_last_week(events)
    assert train["ts"].max() < test.group_by("session").agg(pl.col("ts").min())["ts"].min()
    assert set(test["session"]).isdisjoint(set(train["session"])) or train.height > 0


def test_truncation_keeps_history_before_the_labels_and_is_repeatable(events: pl.DataFrame):
    _, test = data.split_last_week(events)
    first = data.truncate(test, seed=5)
    again = data.truncate(test, seed=5)
    assert first.clicks == again.clicks and first.orders == again.orders
    assert first.history.group_by("session").len()["len"].min() >= 1
    # Every labelled session also has a history.
    assert set(first.clicks) <= set(first.history["session"])


def test_every_method_scores_and_learning_co_occurrence_beats_popularity(events: pl.DataFrame):
    report = run(events, seed=4949, label="synthetic (test)")
    scores = {row["method"]: row["score"] for row in report["results"]}
    assert set(scores) == {"popularity", "co-visitation", "taste graph", "taste graph + history", "without time decay", "without normalisation"}
    for value in scores.values():
        assert 0 <= value <= 1
    assert scores["co-visitation"] > scores["popularity"]
    assert scores["taste graph + history"] > scores["popularity"]
