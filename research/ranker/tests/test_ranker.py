# Vitrine — AI-native e-shop (ITC 4949 Capstone)
# Copyright (c) 2026 George Papasotiriou. All rights reserved.
# Author: George Papasotiriou <g.papasotiriou@acg.edu>
# Project started: 2026-09-12
#
# Tests for the learned ranker: E1's measures, the lambda gradients, the trees, and learning a ranking it can learn.

import json
import math

import numpy as np

from ranker.data import Dataset
from ranker.lambdamart import Model, Tree, bin_edges, fit_tree, lambdas, to_bins, train
from ranker.metrics import dcg, paired_bootstrap, per_query


def dataset(X, y, sizes, ideal=None):
    qid = np.repeat(np.arange(len(sizes)), sizes)
    bounds, start = [], 0
    for size in sizes:
        bounds.append((start, start + size))
        start += size
    return Dataset([f"f{i}" for i in range(X.shape[1])], np.asarray(X, dtype=float), np.asarray(y), qid, [str(i) for i in range(len(y))], bounds, ideal)


def test_dcg_is_e1s():
    # gain 2^g − 1, discount log2(position + 2): grades 3, 2, 0 → 7/1 + 3/log2(3).
    assert math.isclose(dcg(np.array([3, 2, 0])), 7 + 3 / math.log2(3))
    assert dcg(np.array([0, 0])) == 0


def test_ndcg_uses_the_ideal_over_everything_judged():
    # One query: the system found a grade-2 product first, but a grade-3 product was judged and never found.
    data = dataset(np.zeros((2, 1)), [2, 0], [2], ideal={0: [3, 2]})
    ndcgs, rrs, kept = per_query(data, np.array([1.0, 0.0]))
    assert kept == [0]
    assert math.isclose(ndcgs[0], 3 / (7 + 3 / math.log2(3)))
    assert rrs[0] == 1.0


def test_ties_keep_the_fused_order():
    data = dataset(np.zeros((3, 1)), [0, 3, 0], [3])
    # All scores equal: the order stays the row order, so the grade-3 product is second.
    ndcgs, rrs, _ = per_query(data, np.zeros(3))
    assert rrs[0] == 0.5


def test_lambdas_push_a_better_product_up_and_balance_out():
    data = dataset(np.zeros((3, 1)), [0, 3, 1], [3])
    # The best product is scored lowest.
    g, h = lambdas(data, np.array([2.0, 0.0, 1.0]))
    assert g[1] < 0  # a negative gradient: raising its score lowers the cost
    assert g[0] > 0
    assert math.isclose(g.sum(), 0.0, abs_tol=1e-12)
    assert (h >= 0).all()


def test_a_tree_splits_where_the_gradient_changes():
    X = np.arange(100, dtype=float).reshape(-1, 1)
    g = np.where(X[:, 0] < 50, 1.0, -1.0)
    edges = bin_edges(X)
    tree = fit_tree(to_bins(X, edges), edges, g, np.ones(100), depth=1, min_leaf=5, l2=0.0, rate=1.0)
    assert tree.feature[0] == 0
    assert 48 <= tree.threshold[0] <= 50
    predicted = tree.predict(X)
    assert np.allclose(predicted[:45], -1.0) and np.allclose(predicted[-45:], 1.0)


def test_the_vectorised_walk_matches_a_plain_one():
    rng = np.random.default_rng(3)
    tree = Tree()
    root = tree.add(0, 0.5)
    left = tree.add(1, 0.2)
    tree.left[root], tree.right[root] = left, tree.add(value=3.0)
    tree.left[left], tree.right[left] = tree.add(value=1.0), tree.add(value=2.0)
    X = rng.random((500, 2))

    def walk(row):
        node = 0
        while tree.feature[node] >= 0:
            node = tree.left[node] if row[tree.feature[node]] <= tree.threshold[node] else tree.right[node]
        return tree.value[node]

    assert np.array_equal(tree.predict(X), np.array([walk(row) for row in X]))


def test_it_learns_a_ranking_hidden_in_one_feature_among_noise():
    rng = np.random.default_rng(57)

    def make(queries):
        sizes = [20] * queries
        y = rng.integers(0, 4, sum(sizes))
        # Feature 0 is the grade plus a little noise; the others are noise.
        X = np.column_stack([y + rng.normal(0, 0.3, len(y)), rng.random(len(y)), rng.random(len(y))])
        return dataset(X, y, sizes)

    model, curve = train(make(60), make(20), rounds=60, rate=0.2, depth=3, min_leaf=10, patience=20)
    test = make(20)
    ndcgs, _, _ = per_query(test, model.predict(test.X))
    fusion, _, _ = per_query(test, -np.arange(len(test.y), dtype=float))
    assert ndcgs.mean() > 0.95
    assert ndcgs.mean() > fusion.mean() + 0.2
    assert max(curve) > 0.95


def test_the_export_predicts_as_the_model_does():
    rng = np.random.default_rng(9)
    y = rng.integers(0, 4, 200)
    data = dataset(np.column_stack([y + rng.normal(0, 0.5, 200), rng.random(200)]), y, [20] * 10)
    model, _ = train(data, data, rounds=10, rate=0.3, depth=2, min_leaf=5, patience=10)
    exported = json.loads(json.dumps(model.export("test", {})))
    trees = [Tree(t["feature"], t["threshold"], t["left"], t["right"], t["value"]) for t in exported["trees"]]
    again = Model(exported["features"], trees, exported["base"])
    assert np.allclose(again.predict(data.X), model.predict(data.X))


def test_paired_bootstrap():
    a = np.array([0.5, 0.6, 0.7, 0.8])
    assert paired_bootstrap(a, a) == (0.0, 0.0, 0.0)
    mean, low, high = paired_bootstrap(a + 0.1, a)
    assert math.isclose(mean, 0.1) and math.isclose(low, 0.1) and math.isclose(high, 0.1)
