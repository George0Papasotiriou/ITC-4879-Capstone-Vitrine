/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Tests for size advice from body measurements.
 */

import { describe, expect, it } from "vitest";

import { sizeChartFor } from "@/lib/catalog/capsule";
import { adviseSize, isAdvice, sizeForMeasure } from "@/lib/catalog/size-advice";

const upper = sizeChartFor("JACKET")!; // chest 86 92 98 106 114; waist 70 76 82 90 98
const lower = sizeChartFor("TROUSERS")!; // waist 66 72 78 86 94; hip 90 96 102 110 118

describe("sizeForMeasure", () => {
  it("takes the smallest size that closes around the measurement", () => {
    expect(sizeForMeasure(upper[0]!, 97, 0)).toMatchObject({ size: "M", upToCm: 98, beyondChart: false });
    expect(sizeForMeasure(upper[0]!, 98, 0)).toMatchObject({ size: "M" });
    expect(sizeForMeasure(upper[0]!, 98.5, 0)).toMatchObject({ size: "L", upToCm: 106 });
    expect(sizeForMeasure(upper[0]!, 70, 0)).toMatchObject({ size: "XS" });
  });

  it("says when the body is larger than the chart", () => {
    expect(sizeForMeasure(upper[0]!, 120, 0)).toMatchObject({ size: "XL", upToCm: 114, beyondChart: true });
  });
});

describe("adviseSize", () => {
  it("with one measurement, gives that measurement's size", () => {
    const advice = adviseSize(upper, [100]);
    expect(isAdvice(advice) && advice).toMatchObject({ size: "L", decidedBy: 0, apart: 0, beyondChart: false });
  });

  it("with two, the larger size wins, and says which measurement decided", () => {
    // Chest 95 is M, waist 88 is L: a jacket that closes at the chest but not the waist does not fit.
    const advice = adviseSize(upper, [95, 88]);
    expect(isAdvice(advice) && advice).toMatchObject({ size: "L", decidedBy: 1, apart: 1 });
  });

  it("flags measurements two or more sizes apart", () => {
    // Waist 70 is S, hip 108 is L.
    const advice = adviseSize(lower, [70, 108]);
    expect(isAdvice(advice) && advice).toMatchObject({ size: "L", decidedBy: 1, apart: 2 });
  });

  it("uses whichever measurement was given", () => {
    const advice = adviseSize(lower, [null, 101]);
    expect(isAdvice(advice) && advice).toMatchObject({ size: "M", decidedBy: 1, verdicts: [{ index: 1, cm: 101 }] });
  });

  it("refuses no measurements and implausible ones (inches, typing slips)", () => {
    expect(adviseSize(upper, [])).toEqual({ problem: "no_measurements" });
    expect(adviseSize(upper, [null, undefined])).toEqual({ problem: "no_measurements" });
    expect(adviseSize(upper, [38])).toEqual({ problem: "out_of_range", index: 0 });
    expect(adviseSize(upper, [96, 900])).toEqual({ problem: "out_of_range", index: 1 });
  });

  it("never asks for the garment's length", () => {
    // A third value is ignored: the third row is the garment's length, not the body's.
    const advice = adviseSize(upper, [90, null, 200]);
    expect(isAdvice(advice) && advice.verdicts).toHaveLength(1);
  });
});
