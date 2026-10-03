/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Tests for the E1 ranking measures, against values worked out by hand.
 */

import { describe, expect, it } from "vitest";

import { dcg, judgingPool, ndcg, pairedBootstrap, perQuery, recallAt, reciprocalRank, scoreSystem, type Grade } from "@/lib/search/metrics";

const judged = (entries: [string, Grade][]) => new Map<string, Grade>(entries);

describe("dcg and ndcg", () => {
  it("matches a hand calculation", () => {
    // Grades 3, 2, 0 at positions 1–3: 7/log2(2) + 3/log2(3) + 0 = 7 + 1.8928…
    expect(dcg([3, 2, 0], 10)).toBeCloseTo(7 + 3 / Math.log2(3), 10);
    const judgements = judged([["a", 3], ["b", 2], ["c", 0], ["d", 1]]);
    // Ideal order 3, 2, 1, 0: 7 + 3/log2(3) + 1/log2(4) = 9.3928…
    const ideal = 7 + 3 / Math.log2(3) + 0.5;
    expect(ndcg(["a", "b", "c", "d"], judgements)).toBeCloseTo((7 + 3 / Math.log2(3) + 0 + 1 / Math.log2(5)) / ideal, 10);
  });

  it("is 1 for the ideal order and lower for a worse one", () => {
    const judgements = judged([["a", 3], ["b", 2], ["c", 1]]);
    expect(ndcg(["a", "b", "c"], judgements)).toBeCloseTo(1, 12);
    expect(ndcg(["c", "b", "a"], judgements)!).toBeLessThan(1);
  });

  it("counts unjudged products as irrelevant, and says nothing for a query with nothing relevant", () => {
    const judgements = judged([["a", 3]]);
    expect(ndcg(["x", "a"], judgements)).toBeCloseTo(1 / Math.log2(3), 10);
    expect(ndcg(["x"], judged([["x", 0]]))).toBeNull();
  });

  it("looks only at the top k", () => {
    const judgements = judged([["a", 3]]);
    const ranking = Array.from({ length: 10 }, (_, index) => `z${index}`).concat("a");
    expect(ndcg(ranking, judgements, 10)).toBe(0);
  });
});

describe("reciprocal rank and recall", () => {
  const judgements = judged([["a", 1], ["b", 3], ["c", 2], ["d", 2]]);

  it("finds the first real answer (grade 2 or 3), not the first related one", () => {
    expect(reciprocalRank(["a", "b"], judgements)).toBe(0.5);
    expect(reciprocalRank(["a"], judgements)).toBe(0);
  });

  it("counts how much of what should be found was found", () => {
    expect(recallAt(["b", "x", "c"], judgements)).toBeCloseTo(2 / 3, 12);
    expect(recallAt(["b"], judged([["b", 1]]))).toBeNull();
  });
});

describe("scoreSystem", () => {
  it("averages over the queries where a score means something", () => {
    const score = scoreSystem("lexical", [
      { ranking: ["a"], judgements: judged([["a", 3]]) },
      { ranking: ["x", "b"], judgements: judged([["b", 2]]) },
      { ranking: ["y"], judgements: judged([["y", 0]]) },
    ]);
    expect(score.queries).toBe(2);
    expect(score.mrr).toBeCloseTo((1 + 0.5) / 2, 12);
    expect(score.recall10).toBe(1);
    expect(score.ndcg10).toBeCloseTo((1 + 1 / Math.log2(3)) / 2, 10);
  });
});

describe("judgingPool", () => {
  it("merges every system's top results in turns, without repeats or what is judged", () => {
    expect(judgingPool([["a", "b", "c"], ["b", "d", "a"]], new Set(["c"]), 3)).toEqual(["a", "b", "d"]);
  });
});

describe("paired comparisons", () => {
  it("scores each query, leaving out those with nothing relevant judged", () => {
    const runs = [
      { ranking: ["a", "b"], judgements: judged([["a", 3]]) },
      { ranking: ["c"], judgements: judged([["c", 0]]) },
    ];
    expect(perQuery(runs)).toEqual({ ndcg: [1, null], rr: [1, null] });
  });

  it("gives a constant difference back exactly, and an interval that holds the mean", () => {
    expect(pairedBootstrap([0.6, 0.7, 0.8], [0.5, 0.6, 0.7])).toMatchObject({ queries: 3 });
    const constant = pairedBootstrap([0.6, 0.7, 0.8], [0.5, 0.6, 0.7]);
    expect(constant.mean).toBeCloseTo(0.1, 12);
    expect(constant.low).toBeCloseTo(0.1, 12);
    expect(constant.high).toBeCloseTo(0.1, 12);
    const varied = pairedBootstrap([0.9, 0.2, 0.8, 0.4, 0.7, 0.6], [0.5, 0.3, 0.6, 0.5, 0.4, 0.6]);
    expect(varied.low).toBeLessThanOrEqual(varied.mean);
    expect(varied.high).toBeGreaterThanOrEqual(varied.mean);
    // Seeded: the same interval every time.
    expect(pairedBootstrap([0.9, 0.2, 0.8, 0.4, 0.7, 0.6], [0.5, 0.3, 0.6, 0.5, 0.4, 0.6])).toEqual(varied);
    // Queries either side leaves undefined count on neither.
    expect(pairedBootstrap([1, null, 0.5], [0.5, 0.2, null]).queries).toBe(1);
  });
});
