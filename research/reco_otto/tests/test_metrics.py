# Vitrine — AI-native e-shop (ITC 4949 Capstone)
# Copyright (c) 2026 George Papasotiriou. All rights reserved.
# Author: George Papasotiriou <g.papasotiriou@acg.edu>
# Project started: 2026-09-12
#
# Tests for OTTO's metric: Recall@20 per type and the weighted score, on worked examples.

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
