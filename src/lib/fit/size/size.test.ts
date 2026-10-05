/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Tests for the Fit Engine: the normal functions, the ordinal model and its learning, a body on the size scale, and the advice.
 */

import { describe, expect, it } from "vitest";

import { maxOfBeliefs, sizeIndexOf, stretchAllowance, stretchPercent, zoneWord } from "@/lib/fit/size/body";
import { cdf, erfc, pdf, truncatedMoments } from "@/lib/fit/size/gaussian";
import { describeItem, itemBelief, outcomeOf, remarksCounted, typicalTolerance, REMARKS_WORTH } from "@/lib/fit/size/evidence";
import { SHOP_FIT_PARAMS } from "@/lib/fit/size/model";
import { itemFromCounts, predictFit, unknownItem, updateFit, type FitParams } from "@/lib/fit/size/ordinal";
import { adviseFit, isFitAdvice } from "@/lib/fit/size/recommend";

const PARAMS: FitParams = { margin: 0.5, noise: 0.35, itemPrior: 0.5, tolerancePrior: 0.2, customerPrior: 0.6, drift: 0 };
const UNKNOWN = unknownItem(PARAMS);

describe("the normal functions (docs/adr/064)", () => {
  it("match known values to the approximation's 1.2·10⁻⁷", () => {
    expect(erfc(0)).toBeCloseTo(1, 7);
    expect(erfc(1)).toBeCloseTo(0.157299207050285, 7);
    expect(erfc(-1)).toBeCloseTo(1.842700792949715, 7);
    expect(cdf(1.959963985)).toBeCloseTo(0.975, 6);
    expect(cdf(0)).toBeCloseTo(0.5, 7);
    expect(pdf(0)).toBeCloseTo(0.3989422804, 9);
  });

  it("move a cut normal's mean the way the cut pulls it, and never grow its variance", () => {
    // Cut to [0, ∞): the half-normal, mean √(2/π), variance 1 − 2/π.
    const half = truncatedMoments(0, Number.POSITIVE_INFINITY);
    expect(half.v).toBeCloseTo(Math.sqrt(2 / Math.PI), 6);
    expect(1 - half.w).toBeCloseTo(1 - 2 / Math.PI, 6);
    // A symmetric interval keeps the mean and narrows the spread.
    const middle = truncatedMoments(-1, 1);
    expect(middle.v).toBeCloseTo(0, 9);
    expect(middle.w).toBeGreaterThan(0);
    expect(middle.w).toBeLessThan(1);
    // An interval far in the tail: no spread left, and no division by nothing.
    expect(truncatedMoments(40, Number.POSITIVE_INFINITY)).toEqual({ v: 40, w: 1 });
  });
});

describe("the ordinal fit model", () => {
  it("gives probabilities that add up to one, symmetric when size and body agree", () => {
    const p = predictFit(PARAMS, 2, UNKNOWN, { mean: 2, variance: 0.04 });
    expect(p.small + p.fit + p.large).toBeCloseTo(1, 12);
    expect(p.small).toBeCloseTo(p.large, 12);
    expect(p.fit).toBeGreaterThan(0.5);
    // A size too small for the body is most likely small; too big, large.
    expect(predictFit(PARAMS, 1, UNKNOWN, { mean: 2.5, variance: 0.04 }).small).toBeGreaterThan(0.5);
    expect(predictFit(PARAMS, 4, UNKNOWN, { mean: 2.5, variance: 0.04 }).large).toBeGreaterThan(0.5);
    // A forgiving item fits more often; an unforgiving one less, but never not at all.
    expect(predictFit(PARAMS, 2, unknownItem(PARAMS, 0.3), { mean: 2, variance: 0.04 }).fit).toBeGreaterThan(p.fit);
    expect(predictFit(PARAMS, 2, unknownItem(PARAMS, -5), { mean: 2, variance: 0.04 }).fit).toBeGreaterThan(0);
  });

  it("learns from 'too large' that the item runs large and forgives less, and the shopper is smaller, each in proportion to its spread", () => {
    const customer = { mean: 2, variance: 0.36 };
    const after = updateFit(PARAMS, 2, UNKNOWN, customer, "large");
    expect(after.item.offset.mean).toBeGreaterThan(0);
    expect(after.item.tolerance.mean).toBeLessThan(0);
    expect(after.customer.mean).toBeLessThan(2);
    expect(after.item.offset.variance).toBeLessThan(0.25);
    expect(after.customer.variance).toBeLessThan(0.36);
    expect(after.item.offset.mean / (2 - after.customer.mean)).toBeCloseTo(0.25 / 0.36, 9);
    expect(-after.item.tolerance.mean / after.item.offset.mean).toBeCloseTo(0.04 / 0.25, 9);
    // "Too small" is the mirror image, and also says the item forgives less.
    const small = updateFit(PARAMS, 2, UNKNOWN, customer, "small");
    expect(small.item.offset.mean).toBeCloseTo(-after.item.offset.mean, 12);
    expect(small.item.tolerance.mean).toBeCloseTo(after.item.tolerance.mean, 12);
    expect(small.customer.mean - 2).toBeCloseTo(2 - after.customer.mean, 12);
  });

  it("learns from 'fits' that the item forgives, both edges from the same start, so a centred belief does not move", () => {
    const after = updateFit(PARAMS, 2, UNKNOWN, { mean: 2, variance: 0.36 }, "fit");
    expect(after.item.offset.mean).toBeCloseTo(0, 12);
    expect(after.customer.mean).toBeCloseTo(2, 12);
    expect(after.item.tolerance.mean).toBeGreaterThan(0);
    expect(after.item.offset.variance).toBeLessThan(0.25);
  });

  it("forgets a little with drift, for the offset and the shopper but not the tolerance", () => {
    const withDrift = updateFit({ ...PARAMS, drift: 0.1 }, 2, UNKNOWN, { mean: 2, variance: 0.04 }, "fit");
    const without = updateFit(PARAMS, 2, UNKNOWN, { mean: 2, variance: 0.04 }, "fit");
    expect(withDrift.item.offset.variance).toBeGreaterThan(without.item.offset.variance);
    const none = { ...PARAMS, tolerancePrior: 0, drift: 0.1 };
    expect(updateFit(none, 2, unknownItem(none), { mean: 2, variance: 0.04 }, "large").item.tolerance).toEqual({ mean: 0, variance: 0 });
  });

  it("reads an item from reviewers' fit remarks: which way it runs, how forgiving it is, and many remarks more surely than few", () => {
    expect(itemFromCounts(PARAMS, { small: 0, trueToSize: 0, large: 0 })).toEqual(UNKNOWN);
    const runsSmall = itemFromCounts(PARAMS, { small: 600, trueToSize: 300, large: 50 });
    expect(runsSmall.offset.mean).toBeLessThan(-0.2);
    const runsLarge = itemFromCounts(PARAMS, { small: 50, trueToSize: 300, large: 600 });
    expect(runsLarge.offset.mean).toBeCloseTo(-runsSmall.offset.mean, 4);
    expect(Math.abs(itemFromCounts(PARAMS, { small: 40, trueToSize: 400, large: 40 }).offset.mean)).toBeLessThan(0.01);
    expect(itemFromCounts(PARAMS, { small: 120, trueToSize: 120, large: 120 }).tolerance.mean).toBeLessThan(0);
    expect(itemFromCounts(PARAMS, { small: 3, trueToSize: 90, large: 2 }).tolerance.mean).toBeGreaterThan(0);
    const few = itemFromCounts(PARAMS, { small: 6, trueToSize: 3, large: 0.5 });
    expect(Math.abs(few.offset.mean)).toBeLessThan(Math.abs(runsSmall.offset.mean));
    expect(few.offset.variance).toBeGreaterThan(runsSmall.offset.variance);
    expect(few.offset.variance).toBeLessThanOrEqual(0.25);
  });
});

describe("what the shop knows about a piece", () => {
  it("counts at most a hundred remarks, keeping their shares", () => {
    expect(remarksCounted({ small: 10, trueToSize: 20, large: 5 })).toEqual({ small: 10, trueToSize: 20, large: 5 });
    const scaled = remarksCounted({ small: 200, trueToSize: 600, large: 200 });
    expect(scaled.small + scaled.trueToSize + scaled.large).toBeCloseTo(REMARKS_WORTH, 9);
    expect(scaled.trueToSize / scaled.small).toBeCloseTo(3, 9);
  });

  it("learns a size returned as too small or too big, a size kept past the window as a fit, and nothing else", () => {
    expect(outcomeOf({ returnReason: "too_small", deliveredAt: new Date(), windowClosed: false })).toBe("small");
    expect(outcomeOf({ returnReason: "too_big: the sleeves too", deliveredAt: new Date(), windowClosed: true })).toBe("large");
    expect(outcomeOf({ returnReason: "changed_mind", deliveredAt: new Date(), windowClosed: true })).toBeNull();
    expect(outcomeOf({ returnReason: null, deliveredAt: new Date(), windowClosed: true })).toBe("fit");
    expect(outcomeOf({ returnReason: null, deliveredAt: new Date(), windowClosed: false })).toBeNull();
    expect(outcomeOf({ returnReason: null, deliveredAt: null, windowClosed: true })).toBeNull();
  });

  it("reads forgiveness against the typical piece, starts a stretchy piece more forgiving, and learns from returns", () => {
    const catalogue = [
      { small: 30, trueToSize: 60, large: 10 },
      { small: 20, trueToSize: 60, large: 20 },
    ];
    const typical = typicalTolerance(SHOP_FIT_PARAMS, catalogue);
    const middle = itemBelief(SHOP_FIT_PARAMS, { remarks: catalogue[1]!, typicalTolerance: typical, stretch: 0, outcomes: [] });
    const roomier = itemBelief(SHOP_FIT_PARAMS, { remarks: { small: 5, trueToSize: 90, large: 5 }, typicalTolerance: typical, stretch: 0, outcomes: [] });
    expect(roomier.tolerance.mean).toBeGreaterThan(middle.tolerance.mean);
    const plain = itemBelief(SHOP_FIT_PARAMS, { remarks: null, typicalTolerance: 0, stretch: 0, outcomes: [] });
    const stretchy = itemBelief(SHOP_FIT_PARAMS, { remarks: null, typicalTolerance: 0, stretch: 5, outcomes: [] });
    expect(stretchy.tolerance.mean).toBeCloseTo(0.25, 12);
    expect(plain.tolerance.mean).toBe(0);
    const returnedSmall = itemBelief(SHOP_FIT_PARAMS, { remarks: null, typicalTolerance: 0, stretch: 0, outcomes: Array.from({ length: 8 }, () => ({ sizeIndex: 2, outcome: "small" as const })) });
    expect(returnedSmall.offset.mean).toBeLessThan(-0.2);
    expect(describeItem(returnedSmall).lean).toBe("small");
    expect(describeItem(plain)).toEqual({ lean: "true", cut: "usual" });
  });
});

describe("a body on the size scale", () => {
  const chest = { zone: "Chest", values: [86, 92, 98, 106, 114] };

  it("puts a measurement in the middle of its size, halfway between sizes at a size's limit, and beyond the chart by the nearest step", () => {
    expect(sizeIndexOf(chest, 95).mean).toBeCloseTo(2, 12);
    expect(sizeIndexOf(chest, 98).mean).toBeCloseTo(2.5, 12);
    expect(sizeIndexOf(chest, 122).mean).toBeCloseTo(5.5, 12);
    expect(sizeIndexOf(chest, 80).mean).toBeCloseTo(-0.5, 12);
    // ±1.5 cm on a 6 cm step is ±¼ of a size.
    expect(Math.sqrt(sizeIndexOf(chest, 95).variance)).toBeCloseTo(0.25, 12);
  });

  it("takes the larger of two zones by Clark's moments: the mean of two equal beliefs' maximum is above either", () => {
    const one = { mean: 2, variance: 0.04 };
    const max = maxOfBeliefs([one, one]);
    // E[max of two iid N(μ, σ²)] = μ + σ/√π.
    // Exact up to the error function's approximation (1.2·10⁻⁷).
    expect(max.mean).toBeCloseTo(2 + 0.2 / Math.sqrt(Math.PI), 6);
    expect(max.variance).toBeLessThan(0.04);
    expect(maxOfBeliefs([{ mean: 1, variance: 0.01 }, { mean: 3, variance: 0.01 }]).mean).toBeCloseTo(3, 6);
  });

  it("reads stretch from the fabric line, and says each zone in words", () => {
    expect(stretchPercent("82% cotton, 17% polyester, 1% spandex")).toBe(1);
    expect(stretchPercent("95% polyester, 5% elastane")).toBe(5);
    expect(stretchPercent(null)).toBe(0);
    expect(stretchAllowance(5)).toBeCloseTo(0.25, 12);
    expect(stretchAllowance(40)).toBe(0.5);
    expect(zoneWord(2, { mean: 2.6, variance: 0 }, 6)).toEqual({ word: "snug", cm: -4 });
    expect(zoneWord(2, { mean: 2.1, variance: 0 }, 6).word).toBe("right");
    expect(zoneWord(3, { mean: 2.1, variance: 0 }, 8).word).toBe("roomy");
  });
});

describe("adviseFit", () => {
  const sizes = ["XS", "S", "M", "L", "XL"];
  const rows = [
    { zone: "Chest", values: [86, 92, 98, 106, 114] },
    { zone: "Waist", values: [70, 76, 82, 90, 98] },
  ];

  it("picks the size most likely to fit, with the runner-up and the zone that decided", () => {
    const advice = adviseFit({ sizes, rows, measurements: { Chest: 95, Waist: 88 }, item: UNKNOWN, params: PARAMS });
    if (!isFitAdvice(advice)) throw new Error("no advice");
    // Chest 95 is an M, waist 88 an L near its top: the waist decides, and XL is the next most likely to fit.
    expect(advice.best.size).toBe("L");
    expect(advice.decidedBy).toBe("Waist");
    expect(advice.runnerUp?.size).toBe("XL");
    expect(advice.zones.find((zone) => zone.zone === "Chest")?.word).toBe("roomy");
    for (const choice of advice.sizes) expect(choice.probabilities.small + choice.probabilities.fit + choice.probabilities.large).toBeCloseTo(1, 9);
  });

  it("moves to a larger size for an item that runs small", () => {
    const runsSmall = itemFromCounts(PARAMS, { small: 900, trueToSize: 200, large: 20 });
    const plain = adviseFit({ sizes, rows: rows.slice(0, 1), measurements: { Chest: 97 }, item: UNKNOWN, params: PARAMS });
    const adjusted = adviseFit({ sizes, rows: rows.slice(0, 1), measurements: { Chest: 97 }, item: runsSmall, params: PARAMS });
    if (!isFitAdvice(plain) || !isFitAdvice(adjusted)) throw new Error("no advice");
    expect(plain.best.size).toBe("M");
    expect(adjusted.best.size).toBe("L");
  });

  it("is surer for a forgiving piece, and asks for a measurement when it has none", () => {
    const woven = adviseFit({ sizes, rows: rows.slice(0, 1), measurements: { Chest: 95 }, item: UNKNOWN, params: PARAMS });
    const stretchy = adviseFit({ sizes, rows: rows.slice(0, 1), measurements: { Chest: 95 }, item: unknownItem(PARAMS, 0.25), params: PARAMS });
    if (!isFitAdvice(woven) || !isFitAdvice(stretchy)) throw new Error("no advice");
    expect(stretchy.best.probabilities.fit).toBeGreaterThan(woven.best.probabilities.fit);
    expect(adviseFit({ sizes, rows, measurements: {}, item: UNKNOWN, params: PARAMS })).toEqual({ problem: "no_measurements" });
  });
});
