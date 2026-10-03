/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Tests for the learned ranking stage: its features, its tree walk, and its parity with the Python that trained it.
 */

import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { checkModel, FEATURE_NAMES, predict, rankingFeatures, type RankerModel, type RankingQuery } from "@/lib/search/ranker";

const query = (text: string, overrides: Partial<RankingQuery> = {}): RankingQuery => ({
  text,
  colors: [],
  idf: (word) => ({ canova: 7, sofa: 3, grey: 2, seater: 4 })[word] ?? 1,
  lexical: new Map(),
  fuzzy: new Map(),
  fused: new Map(),
  ...overrides,
});
const feature = (values: number[], name: (typeof FEATURE_NAMES)[number]) => values[FEATURE_NAMES.indexOf(name)];

describe("the learned ranker's features (docs/adr/057)", () => {
  it("measures how much of the query a title holds, weighting rare words more", () => {
    const product = { id: "a", title: "Canova 3 Seater Maxi", brand: "Canova", colors: ["grey"] };
    const values = rankingFeatures(query("canova sofa"), product);
    expect(values).toHaveLength(FEATURE_NAMES.length);
    expect(feature(values, "coverage")).toBe(0.5);
    // "canova" (idf 7) of "canova" + "sofa" (7 + 3).
    expect(feature(values, "idf_coverage")).toBeCloseTo(0.7, 9);
    expect(feature(values, "max_idf_matched")).toBe(7);
    expect(feature(values, "brand_in_query")).toBe(1);
    expect(feature(values, "first_word_in_query")).toBe(1);
    expect(feature(values, "query_words")).toBe(2);
  });

  it("reads colours and numbers the query asks for, and what contradicts them", () => {
    const grey = { id: "a", title: "Sofa 3 seater", brand: null, colors: ["grey"] };
    const asked = query("grey 3 seater sofa", { colors: ["grey"] });
    expect(feature(rankingFeatures(asked, grey), "color_match")).toBe(1);
    expect(feature(rankingFeatures(asked, grey), "number_match")).toBe(1);
    const blue = { id: "b", title: "Sofa 2 seater", brand: null, colors: ["blue"] };
    expect(feature(rankingFeatures(asked, blue), "color_conflict")).toBe(1);
    expect(feature(rankingFeatures(asked, blue), "number_conflict")).toBe(1);
    // Word pairs in the query's order, side by side in the title: "3 seater" and "seater sofa" are not both there.
    expect(feature(rankingFeatures(asked, grey), "bigram_order")).toBeCloseTo(1 / 3, 9);
  });

  it("carries each retriever's evidence: scores, reciprocal ranks and agreement", () => {
    const evidence = { lexical: new Map([["a", { rank: 0, score: 0.8 }]]), fuzzy: new Map([["a", { rank: 3, score: 0.5 }]]), fused: new Map([["a", { rank: 1, score: 0.03 }]]) };
    const values = rankingFeatures(query("x", evidence), { id: "a", title: "x", brand: null, colors: [] });
    expect([feature(values, "lexical_score"), feature(values, "lexical_rr"), feature(values, "fuzzy_rr"), feature(values, "rrf_rr"), feature(values, "both_retrievers")]).toEqual([0.8, 1, 0.25, 0.5, 1]);
    const absent = rankingFeatures(query("x"), { id: "z", title: "x", brand: null, colors: [] });
    expect([feature(absent, "lexical_rr"), feature(absent, "both_retrievers")]).toEqual([0, 0]);
  });
});

describe("the tree walk", () => {
  // One tree: x0 ≤ 0.5 → (x1 ≤ 2 → 1, else 2), else 3; a second tree adds 0.25 everywhere.
  const model: RankerModel = {
    version: "test",
    features: [...FEATURE_NAMES],
    base: 0.5,
    trees: [
      { feature: [0, 1, -1, -1, -1], threshold: [0.5, 2, 0, 0, 0], left: [1, 2, -1, -1, -1], right: [4, 3, -1, -1, -1], value: [0, 0, 1, 2, 3] },
      { feature: [-1], threshold: [0], left: [-1], right: [-1], value: [0.25] },
    ],
  };

  it("sends x ≤ t left, as the Python does, and adds the base and every tree", () => {
    const x = (a: number, b: number) => [a, b, ...new Array<number>(FEATURE_NAMES.length - 2).fill(0)];
    expect(predict(model, x(0.5, 2))).toBe(1.75);
    expect(predict(model, x(0.4, 3))).toBe(2.75);
    expect(predict(model, x(0.6, 0))).toBe(3.75);
  });

  it("refuses a model trained on other features", () => {
    expect(checkModel(model)).toBe(true);
    expect(checkModel({ ...model, features: ["something", ...FEATURE_NAMES.slice(1)] })).toBe(false);
  });
});

const MODEL = "src/lib/search/models/ranker-v1.json";
describe.skipIf(!existsSync(MODEL))("parity with the Python that trained it", () => {
  it("gives the 200 fixture rows exactly the scores the Python gave them", () => {
    const model = JSON.parse(readFileSync(MODEL, "utf8")) as RankerModel;
    const parity = JSON.parse(readFileSync(MODEL.replace(".json", ".parity.json"), "utf8")) as { rows: number[][]; scores: number[] };
    expect(checkModel(model)).toBe(true);
    for (const [index, row] of parity.rows.entries()) expect(Math.abs(predict(model, row) - parity.scores[index]!)).toBeLessThan(1e-9);
  });
});
