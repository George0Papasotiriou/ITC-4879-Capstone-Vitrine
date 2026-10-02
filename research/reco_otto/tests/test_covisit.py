# Vitrine — AI-native e-shop (ITC 4949 Capstone)
# Copyright (c) 2026 George Papasotiriou. All rights reserved.
# Author: George Papasotiriou <g.papasotiriou@acg.edu>
# Project started: 2026-09-12
#
# Tests for the co-visitation baseline: the matrices on a small example, and the reranker's order and fill.

from reco_otto import data
from reco_otto.covisit import CoVisitation, Popularity


def records():
    hour = 3600
    return [
        # Items 1 and 2 go together in three sessions; 1 and 3 once; 4 and 5 are bought together.
        {"session": 1, "events": [{"aid": 1, "ts": 0, "type": "clicks"}, {"aid": 2, "ts": 60, "type": "clicks"}]},
        {"session": 2, "events": [{"aid": 2, "ts": hour, "type": "clicks"}, {"aid": 1, "ts": hour + 30, "type": "carts"}]},
        {"session": 3, "events": [{"aid": 1, "ts": 2 * hour, "type": "clicks"}, {"aid": 2, "ts": 2 * hour + 9, "type": "clicks"}, {"aid": 3, "ts": 2 * hour + 50, "type": "clicks"}]},
        {"session": 4, "events": [{"aid": 4, "ts": 3 * hour, "type": "orders"}, {"aid": 5, "ts": 3 * hour + 5, "type": "orders"}]},
        {"session": 5, "events": [{"aid": 6, "ts": 30 * hour, "type": "clicks"}, {"aid": 7, "ts": 30 * hour + 3 * 24 * hour, "type": "clicks"}]},
    ]


def test_items_seen_together_are_each_others_neighbours_strongest_first():
    model = CoVisitation(data.from_records(records()))
    assert model.clicks[1][0] == 2
    assert model.clicks[2][0] == 1
    assert 3 in model.clicks[1]
    # More than a day apart: not related.
    assert 7 not in model.clicks.get(6, [])
    assert model.buy2buy[4] == [5]


def test_the_reranker_puts_the_history_first_then_neighbours_then_the_popular():
    model = CoVisitation(data.from_records(records()))
    shelf = model.clicks_for([3], [0])
    assert shelf[0] == 3
    assert shelf[1] in (1, 2)
    assert len(shelf) == len(set(shelf))


def test_popularity_gives_everyone_the_same_list():
    model = Popularity(data.from_records(records()))
    assert model.clicks_for([1], [0]) == model.clicks_for([4], [2])
    assert model.top_clicks[0] in (1, 2)


def test_pairing_the_sessions_a_group_at_a_time_gives_the_same_matrices(monkeypatch):
    from reco_otto import synthetic, taste_graph

    events = data.from_records(synthetic.sessions(count=300, items=80, aisles=8, days=6, seed=3))
    whole = CoVisitation(events)
    monkeypatch.setattr(taste_graph, "CHUNK_EVENTS", 500)
    grouped = CoVisitation(events)
    assert grouped.clicks == whole.clicks
    assert grouped.carts_orders == whole.carts_orders
    assert grouped.buy2buy == whole.buy2buy
