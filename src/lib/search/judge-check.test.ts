/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Tests for checking an AI judge: the balanced, repeatable sample and the weighted kappa against worked examples.
 */

import { describe, expect, it } from "vitest";

import { agreement, checkSample, type JudgedPair } from "@/lib/search/judge-check";
import type { Grade } from "@/lib/search/metrics";

const pool = (counts: [number, number, number, number]): JudgedPair[] =>
  counts.flatMap((count, grade) => Array.from({ length: count }, (_, index) => ({ query: `q${index % 7}`, locale: "en" as const, slug: `p-${grade}-${index}`, grade: grade as Grade })));

describe("checkSample", () => {
  it("takes as many of each grade as it can: ten each from a pool with plenty", () => {
    const sample = checkSample(pool([300, 80, 60, 50]), 40);
    expect(sample).toHaveLength(40);
    for (const grade of [0, 1, 2, 3]) expect(sample.filter((pair) => pair.grade === grade)).toHaveLength(10);
  });

  it("fills from the other grades when one is scarce", () => {
    const sample = checkSample(pool([300, 80, 4, 50]), 40);
    expect(sample).toHaveLength(40);
    expect(sample.filter((pair) => pair.grade === 2)).toHaveLength(4);
    expect(sample.filter((pair) => pair.grade === 0).length).toBeGreaterThanOrEqual(12);
  });

  it("is the same sample every time, whatever order the pool comes in, and never repeats a pair", () => {
    const pairs = pool([120, 40, 30, 20]);
    const first = checkSample(pairs, 40, 7);
    expect(checkSample([...pairs].reverse(), 40, 7)).toEqual(first);
    expect(new Set(first.map((pair) => pair.slug)).size).toBe(40);
    expect(checkSample(pairs, 40, 8)).not.toEqual(first);
  });

  it("returns the whole pool when it is smaller than the sample", () => {
    expect(checkSample(pool([3, 2, 1, 0]), 40)).toHaveLength(6);
  });
});

describe("agreement", () => {
  const pairs = (rows: [Grade, Grade, number][]) => rows.flatMap(([judge, person, count]) => Array.from({ length: count }, () => ({ judge, person })));

  it("is 1 for perfect agreement", () => {
    const result = agreement(pairs([[0, 0, 5], [1, 1, 5], [2, 2, 5], [3, 3, 5]]));
    expect(result.exact).toBe(1);
    expect(result.kappa).toBeCloseTo(1, 12);
  });

  it("matches a worked example computed by hand", () => {
    // Observed (judge × person), n = 10:
    //   judge 0: person 0 ×3, person 1 ×1      judge 2: person 2 ×2, person 3 ×1
    //   judge 1: person 1 ×1                   judge 3: person 3 ×2
    // Row totals 4, 1, 3, 2; column totals 3, 2, 2, 3.
    // Σ w·O  = (1/9)·1 + (1/9)·1 = 2/9
    // Σ w·r·c, row by row: 148/9 + 17/9 + 51/9 + 74/9 = 290/9, so Σ w·E = (290/9)/10 = 29/9
    // κ_w    = 1 − (2/9)/(29/9) = 1 − 2/29 = 27/29
    const result = agreement(pairs([[0, 0, 3], [0, 1, 1], [1, 1, 1], [2, 2, 2], [2, 3, 1], [3, 3, 2]]));
    expect(result.n).toBe(10);
    expect(result.exact).toBeCloseTo(0.8, 12);
    expect(result.withinOne).toBe(1);
    expect(result.kappa).toBeCloseTo(27 / 29, 12);
  });

  it("is about 0 when the person's grades are independent of the judge's", () => {
    // Every judge grade meets every person grade equally often: the table is its own expectation.
    const rows: [Grade, Grade, number][] = [];
    for (const judge of [0, 1, 2, 3] as const) for (const person of [0, 1, 2, 3] as const) rows.push([judge, person, 3]);
    expect(agreement(pairs(rows)).kappa).toBeCloseTo(0, 12);
  });

  it("is negative when the two disagree systematically, and undefined when both give one grade only", () => {
    expect(agreement(pairs([[0, 3, 5], [3, 0, 5]])).kappa!).toBeLessThan(0);
    expect(agreement(pairs([[2, 2, 6]])).kappa).toBeNull();
    expect(agreement([]).kappa).toBeNull();
  });
});
