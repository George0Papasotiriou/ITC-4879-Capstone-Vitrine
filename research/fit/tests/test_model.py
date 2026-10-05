# Vitrine — AI-native e-shop (ITC 4949 Capstone)
# Copyright (c) 2026 George Papasotiriou. All rights reserved.
# Author: George Papasotiriou <g.papasotiriou@acg.edu>
# Project started: 2026-09-12
#
# Tests for E12's Fit Engine: the normal functions against math.erfc, the model's symmetries, the ladder sizes and the measures on known cases.

from __future__ import annotations

import math

import numpy as np

from fit.data import Transaction
from fit.evaluate import on_ladders
from fit.gaussian import cdf, erfc, truncated_moments
from fit.metrics import auc, decide, macro_f1, mean_auc
from fit.model import FitParams, item_from_counts, predict, unknown_item, update

PARAMS = FitParams(margin=0.5, noise=0.35, item_prior=0.5, tolerance_prior=0.2, customer_prior=0.6, drift=0.0)


def test_erfc_is_within_its_stated_error_of_the_library():
    for x in np.linspace(-6, 6, 241):
        exact = math.erfc(x)
        assert abs(erfc(x) - exact) <= 1.2e-7 * max(exact, 1e-300) + 1e-15


def test_cut_normals_match_the_half_normal():
    v, w = truncated_moments(0.0, math.inf)
    assert abs(v - math.sqrt(2 / math.pi)) < 1e-6
    assert abs((1 - w) - (1 - 2 / math.pi)) < 1e-6


def test_predictions_add_up_and_are_symmetric():
    small, fit, large = predict(PARAMS, 2.0, unknown_item(PARAMS), (2.0, 0.04))
    assert abs(small + fit + large - 1) < 1e-12
    assert abs(small - large) < 1e-12
    # A more forgiving item fits more often.
    assert predict(PARAMS, 2.0, unknown_item(PARAMS, 0.3), (2.0, 0.04))[1] > fit


def test_too_large_moves_offset_up_customer_down_and_tolerance_down_in_proportion():
    item, customer = update(PARAMS, 2.0, unknown_item(PARAMS), (2.0, 0.36), "large")
    (b, b_var), (tau, tau_var) = item
    assert b > 0 and customer[0] < 2 and tau < 0
    assert abs(b / (2 - customer[0]) - 0.25 / 0.36) < 1e-9
    assert abs(-tau / b - 0.04 / 0.25) < 1e-9
    small_item, _ = update(PARAMS, 2.0, unknown_item(PARAMS), (2.0, 0.36), "small")
    assert abs(small_item[0][0] + b) < 1e-12 and abs(small_item[1][0] - tau) < 1e-12


def test_drift_widens_offset_and_customer_but_not_tolerance():
    drifting = FitParams(**{**PARAMS.__dict__, "drift": 0.1})
    item, customer = update(drifting, 2.0, unknown_item(drifting), (2.0, 0.04), "fit")
    still, _ = update(PARAMS, 2.0, unknown_item(PARAMS), (2.0, 0.04), "fit")
    assert item[0][1] > still[0][1]
    # With no tolerance prior the tolerance never moves (the one-offset ablation).
    none = FitParams(**{**PARAMS.__dict__, "tolerance_prior": 0.0, "drift": 0.1})
    assert update(none, 2.0, unknown_item(none), (2.0, 0.04), "large")[0][1] == (0.0, 0.0)


def test_a_fit_when_centred_widens_tolerance_and_keeps_the_offset():
    item, customer = update(PARAMS, 2.0, unknown_item(PARAMS), (2.0, 0.36), "fit")
    assert item[1][0] > 0
    # Both edges from the same start: nothing pulls a centred offset or customer either way.
    assert abs(item[0][0]) < 1e-12 and abs(customer[0] - 2.0) < 1e-12
    assert item[0][1] < 0.25 and customer[1] < 0.36


def test_items_from_counts_read_direction_and_forgiveness():
    runs_small = item_from_counts(PARAMS, 600, 300, 50)
    assert runs_small[0][0] < -0.2
    runs_large = item_from_counts(PARAMS, 50, 300, 600)
    assert abs(runs_large[0][0] + runs_small[0][0]) < 1e-4
    unforgiving = item_from_counts(PARAMS, 120, 120, 120)
    forgiving = item_from_counts(PARAMS, 3, 90, 2)
    assert unforgiving[1][0] < 0 < forgiving[1][0]
    few = item_from_counts(PARAMS, 6, 3, 0.5)
    assert abs(few[0][0]) < abs(runs_small[0][0]) and few[0][1] > runs_small[0][1]
    assert item_from_counts(PARAMS, 0, 0, 0) == unknown_item(PARAMS)


def test_ladders_centre_each_item_on_its_typical_buyer():
    rows = [Transaction("a", "tops", 8.0, 1, None), Transaction("b", "tops", 12.0, 1, None), Transaction("c", "tops", 4.0, 0, None),
            Transaction("a", "jeans", 26.0, 1, None), Transaction("d", "jeans", 32.0, 1, None), Transaction("e", "new", 10.0, 1, None)]
    steps = on_ladders(rows, rows[:5])
    assert [row.size for row in steps] == [0.0, 1.0, -1.0, -0.5, 0.5, 0.0]


def test_auc_on_known_cases():
    assert auc(np.array([0.1, 0.4, 0.35, 0.8]), np.array([False, False, True, True])) == 0.75
    # Ties share their rank: all scores equal gives one half.
    assert auc(np.array([0.5, 0.5, 0.5, 0.5]), np.array([True, False, True, False])) == 0.5
    perfect = np.array([[0.9, 0.05, 0.05], [0.05, 0.9, 0.05], [0.05, 0.05, 0.9]])
    assert mean_auc(perfect, np.array([0, 1, 2])) == 1.0


def test_decisions_and_macro_f1():
    p = np.array([[0.6, 0.3, 0.1], [0.1, 0.8, 0.1], [0.1, 0.2, 0.7]])
    predicted = decide(p, (0.5, 0.5))
    assert predicted.tolist() == [0, 1, 2]
    assert macro_f1(predicted, np.array([0, 1, 2])) == 1.0
    assert abs(cdf(0.0) - 0.5) < 1e-7


def test_the_online_item_record_learns_only_from_the_past():
    from fit.baselines import item_record_online

    rows = [Transaction("a", "x", 0.0, 0, None), Transaction("b", "x", 0.0, 0, None), Transaction("c", "x", 0.0, 1, None), Transaction("d", "y", 0.0, 2, None)]
    p = item_record_online(rows, 2)
    # Before "c": two smalls of x, so x leans small; "d" sees y for the first time and gets the overall shares so far.
    assert p[0][0] > p[0][1] and abs(p[1].tolist()[0] - 2 / 3) < 1e-12
