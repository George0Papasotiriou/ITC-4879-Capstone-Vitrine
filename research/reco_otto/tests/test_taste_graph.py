# Vitrine — AI-native e-shop (ITC 4949 Capstone)
# Copyright (c) 2026 George Papasotiriou. All rights reserved.
# Author: George Papasotiriou <g.papasotiriou@acg.edu>
# Project started: 2026-09-12
#
# Tests for the Taste Graph port: edges by hand, the polars edges equal to the plain ones, the walk's mass, the ablations.

import math

import polars as pl
import pytest

from reco_otto import data, synthetic
from reco_otto.taste_graph import Options, TasteGraph, behaviour_edges, behaviour_edges_pure, random_walk_with_restart, seed_vector, transitions, transitions_pure

MIN = 60


def test_one_pair_by_hand():
    # A click on 1, then a cart of 2 a minute later: √(1·3) · e^(−60/600) · 0.5^(0) at "now".
    events = [(1, 1, 1000, 0), (1, 2, 1000 + MIN, 1)]
    raw, normalised, counts = behaviour_edges_pure(events, now_s=1000 + MIN)
    expected = math.sqrt(3) * math.exp(-0.1)
    assert raw[1][2] == pytest.approx(expected) and raw[2][1] == pytest.approx(expected)
    # With one edge each, both degrees are that edge: ŵ = w / √(w·w) = 1.
    assert normalised[1][2] == pytest.approx(1.0)
    assert counts == {1: 1, 2: 1}


def test_events_beyond_the_window_and_the_same_item_are_not_related():
    events = [(1, 1, 0, 0), (1, 1, 10, 0), (1, 2, 31 * MIN, 0)]
    raw, _, _ = behaviour_edges_pure(events, now_s=31 * MIN)
    assert raw == {}


def test_without_decay_and_normalisation_the_weight_is_the_plain_geometric_mean():
    events = [(1, 1, 0, 2), (1, 2, 5 * MIN, 0)]
    _, edges, _ = behaviour_edges_pure(events, now_s=40 * 24 * 3600, options=Options(decay=False, normalise=False))
    assert edges[1][2] == pytest.approx(math.sqrt(6))


@pytest.fixture(scope="module")
def small() -> pl.DataFrame:
    return data.from_records(synthetic.sessions(count=300, items=80, aisles=8, days=6, seed=3))


@pytest.mark.parametrize("options", [Options(), Options(decay=False), Options(normalise=False)])
def test_the_polars_edges_equal_the_plain_ones(small: pl.DataFrame, options: Options):
    now = int(small["ts"].max())
    rows = list(small.select("session", "aid", "ts", "type").iter_rows())
    _, expected, _ = behaviour_edges_pure(rows, now, options)
    got = behaviour_edges(small, now, options)
    pairs = {(x, y): w for x, y, w in got.iter_rows()}
    assert len(pairs) == sum(len(row) for row in expected.values())
    for x, row in expected.items():
        for y, w in row.items():
            assert pairs[(x, y)] == pytest.approx(w, rel=1e-9)


def test_transitions_keep_the_top_50_and_sum_to_one(small: pl.DataFrame):
    now = int(small["ts"].max())
    graph = transitions(behaviour_edges(small, now))
    rows = list(small.select("session", "aid", "ts", "type").iter_rows())
    plain = transitions_pure(behaviour_edges_pure(rows, now)[1])
    assert set(graph) == set(plain)
    for aid, row in graph.items():
        assert len(row) <= 50
        assert sum(row.values()) == pytest.approx(1.0)
        assert set(row) == set(plain[aid])


def test_the_walk_keeps_all_its_mass_and_restart_one_returns_the_seeds():
    graph = {1: {2: 0.5, 3: 0.5}, 2: {1: 1.0}}
    seeds = {1: 0.75, 4: 0.25}
    scores = random_walk_with_restart(graph, seeds)
    assert sum(scores.values()) == pytest.approx(1.0)
    assert scores[3] > 0
    assert random_walk_with_restart(graph, seeds, restart=1) == pytest.approx(seeds)
    with pytest.raises(ValueError):
        random_walk_with_restart(graph, seeds, restart=0)


def test_seeds_sum_to_one_and_halve_every_three_days():
    day = 24 * 3600
    seeds = seed_vector([(1, 0, 0), (2, 3 * day, 0)])
    assert sum(seeds.values()) == pytest.approx(1.0)
    assert seeds[1] == pytest.approx(seeds[2] / 2)


def test_the_shop_way_never_recommends_what_the_session_has_seen(small: pl.DataFrame):
    model = TasteGraph(small, with_history=False)
    session = small.filter(pl.col("session") == small["session"][0])
    aids, types, tss = session["aid"].to_list(), session["type"].to_list(), session["ts"].to_list()
    shelf = model.clicks_for(aids, types, tss)
    assert len(shelf) == 20 and not set(shelf) & set(aids)
    with_history = TasteGraph(small).clicks_for(aids, types, tss)
    assert with_history[0] in aids


@pytest.mark.parametrize("options", [Options(), Options(normalise=False)])
def test_pairing_the_sessions_a_group_at_a_time_gives_the_same_edges(small: pl.DataFrame, options: Options, monkeypatch: pytest.MonkeyPatch):
    from reco_otto import taste_graph

    now = int(small["ts"].max())
    whole = {(x, y): w for x, y, w in behaviour_edges(small, now, options).iter_rows()}
    monkeypatch.setattr(taste_graph, "CHUNK_EVENTS", 500)
    assert len(taste_graph.chunks_of(small)) > 1
    grouped = {(x, y): w for x, y, w in behaviour_edges(small, now, options).iter_rows()}
    assert grouped.keys() == whole.keys()
    for pair, weight in whole.items():
        assert grouped[pair] == pytest.approx(weight, rel=1e-12)


def test_the_pruned_walk_only_lowers_scores_and_zero_is_the_exact_walk(small: pl.DataFrame):
    graph = transitions(behaviour_edges(small, int(small["ts"].max())))
    seeds = {aid: 1 / 3 for aid in list(graph)[:3]}
    exact = random_walk_with_restart(graph, seeds)
    assert random_walk_with_restart(graph, seeds, prune=0.0) == exact
    pruned = random_walk_with_restart(graph, seeds, prune=1e-3)
    for aid, score in pruned.items():
        assert score <= exact[aid] + 1e-15
    # The mass that left the walk is what the pruned items held: the rest is still there.
    assert 0 < sum(exact.values()) - sum(pruned.values()) < 0.5
