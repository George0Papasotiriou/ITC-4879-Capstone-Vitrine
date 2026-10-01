# Vitrine — AI-native e-shop (ITC 4949 Capstone)
# Copyright (c) 2026 George Papasotiriou. All rights reserved.
# Author: George Papasotiriou <g.papasotiriou@acg.edu>
# Project started: 2026-09-12
#
# Parity: the Python Taste Graph gives the shop's numbers on the shared fixture (scripts/reco-parity.ts wrote them).

"""The plan's promise (docs/PLAN.md 2.6): research in Python, production in
TypeScript, and "a shared fixture proves both implement the same algorithm".

fixtures/parity-events.json holds a few dozen sessions in OTTO's format.
scripts/reco-parity.ts ran the shop's own code on them and wrote every
normalised edge, every transition row and three walks to
fixtures/parity-expected.json. Here the Python port computes the same, and
every number must agree to twelve significant digits.
"""

import json
from pathlib import Path

import pytest

from reco_otto.taste_graph import behaviour_edges_pure, random_walk_with_restart, seed_vector, transitions_pure

FIXTURES = Path(__file__).parent / "fixtures"
TYPES = {"clicks": 0, "carts": 1, "orders": 2}


@pytest.fixture(scope="module")
def shared():
    events = json.loads((FIXTURES / "parity-events.json").read_text(encoding="utf-8"))
    expected = json.loads((FIXTURES / "parity-expected.json").read_text(encoding="utf-8"))
    rows = [(s["session"], e["aid"], e["ts"], TYPES[e["type"]]) for s in events["sessions"] for e in s["events"]]
    return events, expected, rows


def as_ints(table: dict) -> dict:
    return {int(key): {int(k): v for k, v in row.items()} for key, row in table.items()}


def test_the_normalised_edges_match_the_shop(shared):
    _, expected, rows = shared
    now = max(ts for _, _, ts, _ in rows)
    _, normalised, _ = behaviour_edges_pure(rows, now)
    want = as_ints(expected["normalised"])
    assert set(normalised) == set(want)
    for aid, row in want.items():
        assert set(normalised[aid]) == set(row)
        for other, weight in row.items():
            assert normalised[aid][other] == pytest.approx(weight, rel=1e-12)


def test_the_transitions_match_the_shop(shared):
    _, expected, rows = shared
    now = max(ts for _, _, ts, _ in rows)
    graph = transitions_pure(behaviour_edges_pure(rows, now)[1])
    # Rows come as [neighbour, probability] pairs, in the shop's ranking order.
    want = {int(aid): [(int(other), probability) for other, probability in row] for aid, row in expected["transitions"].items()}
    assert set(graph) == set(want)
    for aid, row in want.items():
        assert list(graph[aid]) == [other for other, _ in row], f"neighbour order of {aid}"
        for other, probability in row:
            assert graph[aid][other] == pytest.approx(probability, rel=1e-12)


def test_the_walks_match_the_shop(shared):
    events, expected, rows = shared
    now = max(ts for _, _, ts, _ in rows)
    graph = transitions_pure(behaviour_edges_pure(rows, now)[1])
    for walk in expected["walks"]:
        session = next(s for s in events["sessions"] if s["session"] == walk["session"])
        seeds = seed_vector([(e["aid"], e["ts"], TYPES[e["type"]]) for e in session["events"]])
        assert {str(k): v for k, v in seeds.items()} == pytest.approx(walk["seeds"], rel=1e-12)
        scores = random_walk_with_restart(graph, seeds)
        assert set(map(str, scores)) == set(walk["scores"])
        for aid, score in walk["scores"].items():
            assert scores[int(aid)] == pytest.approx(score, rel=1e-12)
