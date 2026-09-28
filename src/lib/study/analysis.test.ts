/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Tests for the user study's scoring and intervals, against published or hand-worked values.
 */

import { describe, expect, it } from "vitest";

import { bootstrapInterval, mean, median, summariseTasks, susScore, wilsonInterval } from "@/lib/study/analysis";

describe("susScore", () => {
  it("scores the best and worst possible answers 100 and 0", () => {
    expect(susScore([5, 1, 5, 1, 5, 1, 5, 1, 5, 1])).toBe(100);
    expect(susScore([1, 5, 1, 5, 1, 5, 1, 5, 1, 5])).toBe(0);
  });

  it("scores all-neutral answers 50", () => {
    expect(susScore([3, 3, 3, 3, 3, 3, 3, 3, 3, 3])).toBe(50);
  });

  it("refuses a questionnaire that is not ten answers from 1 to 5", () => {
    expect(() => susScore([5, 1, 5])).toThrow();
    expect(() => susScore([6, 1, 5, 1, 5, 1, 5, 1, 5, 1])).toThrow();
  });
});

describe("wilsonInterval", () => {
  it("matches the published value for 8 successes in 10", () => {
    // Wilson 95% for 8/10: 0.490 to 0.943 (Newcombe 1998, method 3).
    const interval = wilsonInterval(8, 10)!;
    expect(interval.estimate).toBe(0.8);
    expect(interval.low).toBeCloseTo(0.4902, 3);
    expect(interval.high).toBeCloseTo(0.9433, 3);
  });

  it("stays inside 0–1 and is not zero-width when everyone succeeds", () => {
    const interval = wilsonInterval(10, 10)!;
    expect(interval.high).toBe(1);
    expect(interval.low).toBeGreaterThan(0.6);
    expect(interval.low).toBeLessThan(0.75);
    expect(wilsonInterval(0, 0)).toBeNull();
  });
});

describe("median, mean and the bootstrap", () => {
  it("finds medians of odd and even lists", () => {
    expect(median([30, 10, 20])).toBe(20);
    expect(median([40, 10, 20, 30])).toBe(25);
    expect(median([])).toBeNull();
    expect(mean([1, 2, 3])).toBe(2);
  });

  it("brackets the estimate, and gives the same interval every run", () => {
    const values = [62.5, 70, 75, 77.5, 80, 82.5, 85, 90];
    const first = bootstrapInterval(values, mean, { iterations: 2_000 })!;
    const again = bootstrapInterval(values, mean, { iterations: 2_000 })!;
    expect(first).toEqual(again);
    expect(first.low).toBeLessThanOrEqual(first.estimate);
    expect(first.high).toBeGreaterThanOrEqual(first.estimate);
    expect(first.low).toBeGreaterThan(62.5);
    expect(first.high).toBeLessThan(90);
  });
});

describe("summariseTasks", () => {
  it("counts successes for completion and times successes only", () => {
    const summary = summariseTasks(
      [
        { participant: "P01", task: "find", outcome: "success", seconds: 40 },
        { participant: "P02", task: "find", outcome: "success", seconds: 60 },
        { participant: "P03", task: "find", outcome: "fail", seconds: 300 },
        { participant: "P04", task: "find", outcome: "partial", seconds: 120 },
      ],
      ["find", "size"],
    );
    expect(summary[0]).toMatchObject({ task: "find", attempts: 4, completion: { estimate: 0.5 }, medianSeconds: { estimate: 50 } });
    expect(summary[1]).toEqual({ task: "size", attempts: 0, completion: null, medianSeconds: null });
  });
});
