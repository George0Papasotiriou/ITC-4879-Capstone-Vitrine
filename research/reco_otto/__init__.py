# Vitrine — AI-native e-shop (ITC 4949 Capstone)
# Copyright (c) 2026 George Papasotiriou. All rights reserved.
# Author: George Papasotiriou <g.papasotiriou@acg.edu>
# Project started: 2026-09-12
#
# E2: the Taste Graph (the shop's recommender, src/lib/reco) evaluated offline on OTTO's sessions.

"""Evaluation E2 (docs/PLAN.md 2.6, docs/adr/050).

OTTO's public dataset (otto-de/recsys-dataset, CC BY 4.0) holds 12.9 million
real shopping sessions of a large online shop: clicks, carts and orders over
four weeks. The question E2 answers: does the Taste Graph — the shop's own
recommender, ported here line for line — beat a strong, well-known baseline
(a co-visitation reranker) at predicting what a shopper clicks, carts and
orders next? The answer is measured with OTTO's own metric, Recall@20 per
event type and their weighted sum.

Modules:
    data          loading OTTO, the last-week split, the random truncation
    covisit       the co-visitation baseline (three matrices and a reranker)
    taste_graph   the Taste Graph, as src/lib/reco/graph.ts and walk.ts
    metrics       Recall@20 and the weighted score, as OTTO defines them
    synthetic     OTTO-format sessions made up for tests (never reported)
    evaluate      the command that runs everything and writes the report
"""
