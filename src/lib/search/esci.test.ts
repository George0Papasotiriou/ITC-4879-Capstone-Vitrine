/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Tests for the ESCI labels as grades and the reproducible query sample.
 */

import { describe, expect, it } from "vitest";

import { esciGrade, mulberry32, seededSample } from "@/lib/search/esci";

describe("esciGrade", () => {
  it("puts exact above substitute above complement above irrelevant", () => {
    expect(["E", "S", "C", "I"].map(esciGrade)).toEqual([3, 2, 1, 0]);
  });

  it("reads labels however they are cased or padded, and refuses unknown ones", () => {
    expect(esciGrade(" e ")).toBe(3);
    expect(esciGrade("X")).toBeNull();
  });
});

describe("seededSample", () => {
  it("gives the same sample for the same seed, whatever order the items came in", () => {
    const items = Array.from({ length: 200 }, (_, i) => i);
    const again = [...items].reverse();
    expect(seededSample(items, 20, 7)).toEqual(seededSample(again, 20, 7));
  });

  it("gives a different sample for another seed", () => {
    const items = Array.from({ length: 200 }, (_, i) => i);
    expect(seededSample(items, 20, 7)).not.toEqual(seededSample(items, 20, 8));
  });

  it("never repeats an item and never asks for more than there are", () => {
    const sample = seededSample([3, 1, 2, 3, 1], 10, 1);
    expect([...sample].sort()).toEqual([1, 2, 3]);
  });

  it("draws every item about equally often", () => {
    const counts = new Map<number, number>();
    for (let seed = 0; seed < 2000; seed += 1) {
      for (const item of seededSample([0, 1, 2, 3, 4], 1, seed)) counts.set(item, (counts.get(item) ?? 0) + 1);
    }
    for (const count of counts.values()) expect(count).toBeGreaterThan(300);
  });
});

describe("mulberry32", () => {
  it("stays within [0, 1)", () => {
    const random = mulberry32(42);
    for (let i = 0; i < 1000; i += 1) {
      const value = random();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});
