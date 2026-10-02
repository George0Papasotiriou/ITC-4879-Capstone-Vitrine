# Vitrine — AI-native e-shop (ITC 4949 Capstone)
# Copyright (c) 2026 George Papasotiriou. All rights reserved.
# Author: George Papasotiriou <g.papasotiriou@acg.edu>
# Project started: 2026-09-12
#
# Tests for OTTO's metric: Recall@20 per type and the weighted score, on worked examples.

import pytest

from reco_otto import metrics
from reco_otto.metrics import recall_at_20, score


def test_click_recall_is_the_share_of_sessions_whose_next_click_was_predicted():
    predictions = {1: [10, 11, 12], 2: [20, 21], 3: [30]}
    labels = {1: 11, 2: 99, 3: 30}
    assert recall_at_20(predictions, labels) == 2 / 3


def test_cart_recall_divides_by_min_20_and_the_number_of_items():
    # Session 1 carted 3 items, 2 predicted; session 2 carted 25, 20 predicted (all hits): (2 + 20) / (3 + 20).
    predictions = {1: [1, 2, 3, 4], 2: list(range(100, 125))}
    labels = {1: {1, 2, 9}, 2: set(range(100, 125))}
    assert recall_at_20(predictions, labels) == 22 / 23


def test_only_the_first_20_predictions_count_and_unlabelled_sessions_are_left_out():
    predictions = {1: list(range(30)), 2: [5]}
    labels = {1: {25}, 2: set()}
    assert recall_at_20(predictions, labels) == 0.0


def test_a_session_with_no_prediction_scores_zero_for_its_labels():
    assert recall_at_20({}, {1: {1, 2}}) == 0.0


def test_the_score_weighs_orders_most():
    assert abs(score({"clicks": 0.5, "carts": 0.4, "orders": 0.6}) - (0.05 + 0.12 + 0.36)) < 1e-12


def test_the_counts_add_up_to_the_recall():
    predictions = {1: [5, 6], 2: [7], 3: [9]}
    labels = {1: {5, 8}, 2: {7}, 3: {4}}
    counts = metrics.counts_per_session(predictions, labels)
    assert counts == {1: (1, 2), 2: (1, 1), 3: (0, 1)}
    assert sum(hit for hit, _ in counts.values()) / sum(total for _, total in counts.values()) == metrics.recall_at_20(predictions, labels)


def test_the_bootstrap_brackets_the_score_and_a_method_does_not_differ_from_itself():
    import random

    draw = random.Random(1)
    labels = {kind: {session: {draw.randrange(50)} for session in range(400)} for kind in ("clicks", "carts", "orders")}
    good = {session: list(range(25)) for session in range(400)}
    poor = {session: list(range(3)) for session in range(400)}
    methods = {
        name: {kind: metrics.counts_per_session(shelf, labels[kind]) for kind in labels}
        for name, shelf in (("good", good), ("poor", poor))
    }
    result = metrics.bootstrap(methods, ["poor", "good"], repeats=300, seed=3)
    point = metrics.score({kind: metrics.recall_at_20(good, labels[kind]) for kind in labels})
    low, high = result["good"]["score"]
    assert low <= point <= high
    assert result["poor"]["difference"]["poor"] == (0.0, 0.0)
    assert result["good"]["difference"]["poor"][0] > 0
    # The pairing makes the two differences mirror images.
    assert result["poor"]["difference"]["good"] == pytest.approx(tuple(-value for value in reversed(result["good"]["difference"]["poor"])))
    assert metrics.bootstrap(methods, ["poor", "good"], repeats=300, seed=3) == result
