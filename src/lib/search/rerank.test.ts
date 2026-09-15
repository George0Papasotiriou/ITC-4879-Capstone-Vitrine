/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Unit tests for Bayesian ratings, reranking and diversification.
 */

import { describe, expect, it } from "vitest";

import type { FusedResult } from "@/lib/search/fusion";
import {
  bayesianRating,
  catalogRatingPrior,
  cosineSimilarity,
  DEFAULT_RERANK_WEIGHTS,
  diversify,
  rerank,
  type RerankSignals,
} from "@/lib/search/rerank";

const prior = { mean: 4, weight: 10 };

describe("bayesianRating", () => {
  it("returns the prior mean when there are no reviews", () => {
    expect(bayesianRating({ ratingSum: 0, ratingCount: 0 }, prior)).toBe(4);
  });

  it("ranks many good reviews above a single perfect one (the worked example)", () => {
    const single = bayesianRating({ ratingSum: 5, ratingCount: 1 }, prior);
    const many = bayesianRating({ ratingSum: 920, ratingCount: 200 }, prior);
    expect(single).toBeCloseTo(45 / 11, 10);
    expect(many).toBeCloseTo(960 / 210, 10);
    expect(many).toBeGreaterThan(single);
  });

  it("approaches the sample mean as reviews accumulate", () => {
    const at = (n: number) => bayesianRating({ ratingSum: 2 * n, ratingCount: n }, prior);
    expect(at(10)).toBeCloseTo(3, 10);
    expect(Math.abs(at(10_000) - 2)).toBeLessThan(0.01);
    expect(at(100)).toBeLessThan(at(10));
  });

  it("with no prior weight is the plain average", () => {
    expect(bayesianRating({ ratingSum: 9, ratingCount: 2 }, { mean: 4, weight: 0 })).toBe(4.5);
  });

  it("rejects negative counts", () => {
    expect(() => bayesianRating({ ratingSum: 0, ratingCount: -1 }, prior)).toThrow(RangeError);
  });
});

describe("catalogRatingPrior", () => {
  it("uses the mean of all reviews and the average review count of rated products", () => {
    expect(
      catalogRatingPrior([
        { ratingSum: 40, ratingCount: 10 },
        { ratingSum: 90, ratingCount: 30 },
        { ratingSum: 0, ratingCount: 0 },
      ]),
    ).toEqual({ mean: 130 / 40, weight: 20 });
  });

  it("falls back when nothing is rated", () => {
    expect(catalogRatingPrior([{ ratingSum: 0, ratingCount: 0 }])).toEqual({ mean: 3, weight: 1 });
  });
});

const fused = (entries: [string, number][]): FusedResult[] =>
  entries.map(([id, score]) => ({ id, score, ranks: { lexical: 1 } }));

const signal = (overrides: Partial<RerankSignals> = {}): RerankSignals => ({
  inStock: true,
  ratingSum: 0,
  ratingCount: 0,
  popularity: 0,
  ...overrides,
});

describe("rerank", () => {
  it("multiplies relevance by 1 plus the weighted signals", () => {
    const [result] = rerank(
      fused([["a", 0.03]]),
      new Map([["a", signal({ inStock: true, ratingSum: 500, ratingCount: 100, popularity: 10, taste: 0.5 })]]),
      prior,
      { inStock: 0.1, rating: 0.2, popularity: 0.05, taste: 0.4 },
    );
    const rating = (bayesianRating({ ratingSum: 500, ratingCount: 100 }, prior) - 1) / 4;
    const expected = 1 + 0.1 + 0.2 * rating + 0.05 * Math.log1p(10) + 0.4 * 0.5;
    expect(result?.boost).toBeCloseTo(expected, 12);
    expect(result?.score).toBeCloseTo(0.03 * expected, 12);
    expect(result?.relevance).toBe(0.03);
  });

  it("lifts an in-stock product over a slightly more relevant one that is sold out", () => {
    const order = rerank(
      fused([["sold-out", 1 / 61], ["available", 1 / 62]]),
      new Map([["sold-out", signal({ inStock: false })], ["available", signal({ inStock: true })]]),
      prior,
    ).map((r) => r.id);
    expect(order).toEqual(["available", "sold-out"]);
  });

  it("does not let signals overturn a result several retrievers agreed on", () => {
    const order = rerank(
      fused([["agreed", 3 / 61], ["popular", 1 / 61]]),
      new Map([
        ["agreed", signal({ inStock: false })],
        ["popular", signal({ inStock: true, ratingSum: 5000, ratingCount: 1000, popularity: 500 })],
      ]),
      prior,
    ).map((r) => r.id);
    expect(order).toEqual(["agreed", "popular"]);
  });

  it("keeps fusion order when every weight is zero", () => {
    const order = rerank(
      fused([["a", 0.05], ["b", 0.04], ["c", 0.03]]),
      new Map([["c", signal({ popularity: 1000 })]]),
      prior,
      { inStock: 0, rating: 0, popularity: 0, taste: 0 },
    ).map((r) => r.id);
    expect(order).toEqual(["a", "b", "c"]);
  });

  it("gives a result with no signals no boost instead of failing", () => {
    const [result] = rerank(fused([["new", 0.02]]), new Map(), prior);
    expect(result?.boost).toBe(1);
    expect(result?.score).toBe(0.02);
  });

  it("does not use taste by default, since the Taste Graph arrives in Phase 8", () => {
    expect(DEFAULT_RERANK_WEIGHTS.taste).toBe(0);
  });

  it("keeps the rating and taste boosts within their weights", () => {
    const [result] = rerank(
      fused([["a", 0.01]]),
      new Map([["a", signal({ ratingSum: 5_000_000, ratingCount: 1_000_000, taste: 7 })]]),
      prior,
      { inStock: 0, rating: 0.25, popularity: 0, taste: 0.1 },
    );
    expect(result?.boosts.rating).toBeLessThanOrEqual(0.25);
    expect(result?.boosts.taste).toBeLessThanOrEqual(0.1);
  });

  it("rejects negative weights", () => {
    expect(() => rerank([], new Map(), prior, { ...DEFAULT_RERANK_WEIGHTS, rating: -0.1 })).toThrow(RangeError);
  });
});

describe("cosineSimilarity", () => {
  it("is 1 for the same direction, 0 for orthogonal, -1 for opposite", () => {
    expect(cosineSimilarity([1, 2, 3], [2, 4, 6])).toBeCloseTo(1, 12);
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
    expect(cosineSimilarity([1, 1], [-1, -1])).toBeCloseTo(-1, 12);
  });

  it("is 0 for a zero vector rather than NaN", () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });

  it("rejects vectors of different lengths", () => {
    expect(() => cosineSimilarity([1], [1, 2])).toThrow(RangeError);
  });
});

type Item = { id: string; score: number; group: string };

/** Same group means the same product in another colour. */
const sameGroup = (a: Item, b: Item) => (a.group === b.group ? 1 : 0);

describe("diversify", () => {
  const chairs: Item[] = [
    { id: "chair-black", score: 1.0, group: "chair" },
    { id: "chair-grey", score: 0.99, group: "chair" },
    { id: "chair-green", score: 0.98, group: "chair" },
    { id: "chair-red", score: 0.97, group: "chair" },
    { id: "stool", score: 0.9, group: "stool" },
    { id: "bench", score: 0.85, group: "bench" },
  ];

  it("with lambda 1 keeps relevance order", () => {
    expect(diversify(chairs, sameGroup, { lambda: 1 }).map((i) => i.id)).toEqual(chairs.map((i) => i.id));
  });

  it("stops one chair in several colours from filling the first row", () => {
    const order = diversify(chairs, sameGroup).map((i) => i.id);
    expect(order.slice(0, 3)).toEqual(["chair-black", "stool", "bench"]);
    // The variants still follow, in their own relevance order.
    expect(order.slice(3)).toEqual(["chair-grey", "chair-green", "chair-red"]);
  });

  it("keeps a near-duplicate ahead of an unrelated product that is much less relevant", () => {
    const items: Item[] = [
      { id: "chair-black", score: 1.0, group: "chair" },
      { id: "chair-grey", score: 0.99, group: "chair" },
      { id: "vase", score: 0.3, group: "vase" },
    ];
    // grey: 0.8 · 0.99 − 0.2 · 1 = 0.592; vase: 0.8 · 0.3 = 0.24.
    expect(diversify(items, sameGroup).map((i) => i.id)).toEqual(["chair-black", "chair-grey", "vase"]);
  });

  it("only diversifies the top depth positions and appends the rest in order", () => {
    const order = diversify(chairs, sameGroup, { depth: 2 }).map((i) => i.id);
    expect(order).toEqual(["chair-black", "stool", "chair-grey", "chair-green", "chair-red", "bench"]);
  });

  it("returns every item exactly once", () => {
    const order = diversify(chairs, sameGroup, { lambda: 0.3 });
    expect(order).toHaveLength(chairs.length);
    expect(new Set(order.map((i) => i.id)).size).toBe(chairs.length);
  });

  it("works with embedding similarity", () => {
    const vectors: Record<string, number[]> = { a: [1, 0], b: [0.99, 0.14], c: [0, 1] };
    const items = [
      { id: "a", score: 1 },
      { id: "b", score: 0.95 },
      { id: "c", score: 0.9 },
    ];
    const order = diversify(items, (x, y) => cosineSimilarity(vectors[x.id]!, vectors[y.id]!));
    expect(order.map((i) => i.id)).toEqual(["a", "c", "b"]);
  });

  it("handles empty input and rejects lambda outside [0, 1]", () => {
    expect(diversify([], sameGroup)).toEqual([]);
    expect(() => diversify(chairs, sameGroup, { lambda: 1.2 })).toThrow(RangeError);
  });
});
