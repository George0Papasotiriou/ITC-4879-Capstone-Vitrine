/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Unit tests for reciprocal rank fusion.
 */

import { describe, expect, it } from "vitest";

import { reciprocalRankFusion, RRF_K } from "@/lib/search/fusion";

const ids = (results: { id: string }[]) => results.map((r) => r.id);

describe("reciprocalRankFusion", () => {
  it("scores a single list as 1 / (k + rank)", () => {
    const fused = reciprocalRankFusion([{ name: "lexical", ids: ["a", "b", "c"] }]);
    expect(ids(fused)).toEqual(["a", "b", "c"]);
    expect(fused[0]?.score).toBeCloseTo(1 / 61, 12);
    expect(fused[2]?.score).toBeCloseTo(1 / 63, 12);
  });

  it("sums contributions across retrievers", () => {
    const fused = reciprocalRankFusion([
      { name: "lexical", ids: ["a", "b"] },
      { name: "semantic", ids: ["b", "a"] },
    ]);
    const a = fused.find((r) => r.id === "a");
    expect(a?.score).toBeCloseTo(1 / 61 + 1 / 62, 12);
    expect(a?.ranks).toEqual({ lexical: 1, semantic: 2 });
  });

  it("lets agreement beat a single first place, which is the reason k is 60", () => {
    const fused = reciprocalRankFusion([
      { name: "lexical", ids: ["solo", "x1", "x2", "x3", "shared"] },
      { name: "fuzzy", ids: ["y1", "y2", "y3", "y4", "shared"] },
    ]);
    // shared: 2 / 65 = 0.0308 beats solo: 1 / 61 = 0.0164.
    expect(fused[0]?.id).toBe("shared");
  });

  it("does not let agreement win when k is 0", () => {
    const fused = reciprocalRankFusion(
      [
        { name: "lexical", ids: ["solo", "x1", "x2", "x3", "shared"] },
        { name: "fuzzy", ids: ["y1", "y2", "y3", "y4", "shared"] },
      ],
      0,
    );
    // With k = 0: solo scores 1, shared scores 2 / 5 = 0.4.
    expect(fused[0]?.id).not.toBe("shared");
  });

  it("applies weights", () => {
    const fused = reciprocalRankFusion([
      { name: "lexical", ids: ["a"], weight: 1 },
      { name: "semantic", ids: ["b"], weight: 2 },
    ]);
    expect(ids(fused)).toEqual(["b", "a"]);
    expect(fused[0]?.score).toBeCloseTo(2 / 61, 12);
  });

  it("gives a retriever with weight 0 no influence, while still recording ranks", () => {
    const fused = reciprocalRankFusion([
      { name: "lexical", ids: ["a", "b"] },
      { name: "semantic", ids: ["b"], weight: 0 },
    ]);
    expect(ids(fused)).toEqual(["a", "b"]);
    expect(fused[1]?.ranks).toEqual({ lexical: 2, semantic: 1 });
  });

  it("counts a duplicated id once, at its best position, without shifting later ranks", () => {
    const fused = reciprocalRankFusion([{ name: "fuzzy", ids: ["a", "a", "b"] }]);
    expect(fused.find((r) => r.id === "a")?.score).toBeCloseTo(1 / 61, 12);
    expect(fused.find((r) => r.id === "b")?.ranks).toEqual({ fuzzy: 2 });
  });

  it("breaks ties deterministically, whatever order the lists arrive in", () => {
    const lists = [
      { name: "lexical", ids: ["m", "z"] },
      { name: "fuzzy", ids: ["z", "m"] },
      { name: "semantic", ids: ["q"] },
    ];
    const forward = ids(reciprocalRankFusion(lists));
    const backward = ids(reciprocalRankFusion([...lists].reverse()));
    expect(forward).toEqual(backward);
    // m and z tie on score, best rank and count, so the id decides.
    expect(forward.slice(0, 2)).toEqual(["m", "z"]);
  });

  it("prefers the better best rank when scores tie", () => {
    // p is 1st in list a: 1/61. q is 2nd in list b, weighted 62/61: (62/61)/62 = 1/61.
    const fused = reciprocalRankFusion([
      { name: "a", ids: ["p"] },
      { name: "b", ids: ["x", "q"], weight: (RRF_K + 2) / (RRF_K + 1) },
    ]);
    const p = fused.find((r) => r.id === "p")!;
    const q = fused.find((r) => r.id === "q")!;
    expect(p.score).toBeCloseTo(q.score, 12);
    expect(ids(fused).indexOf("p")).toBeLessThan(ids(fused).indexOf("q"));
  });

  it("returns nothing for no lists or empty lists", () => {
    expect(reciprocalRankFusion([])).toEqual([]);
    expect(reciprocalRankFusion([{ name: "lexical", ids: [] }])).toEqual([]);
  });

  it("rejects negative or non-finite parameters", () => {
    expect(() => reciprocalRankFusion([{ name: "x", ids: ["a"], weight: -1 }])).toThrow(RangeError);
    expect(() => reciprocalRankFusion([{ name: "x", ids: ["a"], weight: Number.NaN }])).toThrow(RangeError);
    expect(() => reciprocalRankFusion([], -1)).toThrow(RangeError);
  });

  it("keeps every document any retriever returned, within the theoretical bound, best first", () => {
    const fused = reciprocalRankFusion([
      { name: "lexical", ids: ["a", "b", "c", "d"] },
      { name: "fuzzy", ids: ["c", "e"] },
      { name: "semantic", ids: ["f", "a", "g"] },
    ]);
    expect(new Set(ids(fused))).toEqual(new Set(["a", "b", "c", "d", "e", "f", "g"]));
    // No document can score more than first place in every list.
    for (const result of fused) expect(result.score).toBeLessThanOrEqual(3 / (RRF_K + 1));
    for (let i = 1; i < fused.length; i += 1) {
      expect(fused[i]!.score).toBeLessThanOrEqual(fused[i - 1]!.score + 1e-12);
    }
  });
});
