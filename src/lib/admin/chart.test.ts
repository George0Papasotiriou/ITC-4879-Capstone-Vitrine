/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Unit tests for chart geometry: round ticks and bar layout.
 */

import { describe, expect, it } from "vitest";

import { barLayout, niceTicks } from "@/lib/admin/chart";

describe("niceTicks", () => {
  it("ends on a round number at or above the maximum", () => {
    expect(niceTicks(937)).toEqual([0, 250, 500, 750, 1000]);
    expect(niceTicks(40)).toEqual([0, 10, 20, 30, 40]);
    expect(niceTicks(123456)).toEqual([0, 50000, 100000, 150000]);
  });

  it("handles small and fractional maxima without floating-point noise", () => {
    expect(niceTicks(0.7)).toEqual([0, 0.2, 0.4, 0.6, 0.8]);
    expect(niceTicks(3)).toEqual([0, 1, 2, 3]);
  });

  it("gives a usable axis when there is nothing to show", () => {
    expect(niceTicks(0)).toEqual([0, 1]);
  });

  it("always reaches the maximum", () => {
    for (const max of [1, 7, 19, 99, 101, 555, 9999, 31415]) expect(niceTicks(max).at(-1)!).toBeGreaterThanOrEqual(max);
  });
});

describe("barLayout", () => {
  it("fills the width with evenly spaced bars rising from the bottom", () => {
    const bars = barLayout([0, 50, 100], { width: 300, height: 100, top: 100, gap: 0.2 });
    expect(bars.map((bar) => bar.x)).toEqual([10, 110, 210]);
    expect(bars.map((bar) => bar.width)).toEqual([80, 80, 80]);
    expect(bars.map((bar) => bar.height)).toEqual([0, 50, 100]);
    expect(bars.map((bar) => bar.y)).toEqual([100, 50, 0]);
  });

  it("keeps a small non-zero value visible", () => {
    expect(barLayout([1], { width: 10, height: 100, top: 100000 })[0]!.height).toBe(1);
  });
});
