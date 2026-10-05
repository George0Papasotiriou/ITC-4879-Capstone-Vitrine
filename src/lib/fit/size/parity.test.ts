/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The shop's Fit Engine against the one E12 measured: the same predictions and the same lessons, step by step, on 200 RentTheRunway rentals.
 */

import { describe, expect, it } from "vitest";

import parity from "@/lib/fit/size/parity.json";
import { itemFromCounts, predictFit, updateFit, type Belief, type FitOutcome, type FitParams, type ItemBelief } from "@/lib/fit/size/ordinal";

/**
 * docs/adr/064. research/fit/evaluate.py writes parity.json from the Python
 * twin with E12's own parameters (RentTheRunway's units): for each step the
 * beliefs going in, the outcome, the prediction and the beliefs coming out.
 * Both sides compute the normal functions with the same Chebyshev fit, so
 * they agree to the last digits; the counts are a search and a numerical
 * curvature, so to the search's own precision.
 */

type Pair = [number, number];
type JsonItem = { offset: Pair; tolerance: Pair };
type Step = { size: number; item: JsonItem; customer: Pair; outcome: FitOutcome; predicted: [number, number, number]; itemAfter: JsonItem; customerAfter: Pair };
type CountCase = { counts: [number, number, number]; toleranceMean: number; item: JsonItem };

const fixture = parity as unknown as { params: FitParams; steps: Step[]; counts: CountCase[] };
const belief = ([mean, variance]: Pair): Belief => ({ mean, variance });
const item = (json: JsonItem): ItemBelief => ({ offset: belief(json.offset), tolerance: belief(json.tolerance) });

describe("the shop's Fit Engine is E12's (docs/adr/064)", () => {
  it("predicts and learns as the evaluated one did, step by step", () => {
    expect(fixture.steps.length).toBe(200);
    for (const step of fixture.steps) {
      const predicted = predictFit(fixture.params, step.size, item(step.item), belief(step.customer));
      expect(predicted.small).toBeCloseTo(step.predicted[0], 10);
      expect(predicted.fit).toBeCloseTo(step.predicted[1], 10);
      expect(predicted.large).toBeCloseTo(step.predicted[2], 10);
      const after = updateFit(fixture.params, step.size, item(step.item), belief(step.customer), step.outcome);
      expect(after.item.offset.mean).toBeCloseTo(step.itemAfter.offset[0], 9);
      expect(after.item.offset.variance).toBeCloseTo(step.itemAfter.offset[1], 9);
      expect(after.item.tolerance.mean).toBeCloseTo(step.itemAfter.tolerance[0], 9);
      expect(after.item.tolerance.variance).toBeCloseTo(step.itemAfter.tolerance[1], 9);
      expect(after.customer.mean).toBeCloseTo(step.customerAfter[0], 9);
      expect(after.customer.variance).toBeCloseTo(step.customerAfter[1], 9);
    }
  });

  it("reads an item from fit remarks as the evaluated one did", () => {
    for (const { counts, toleranceMean, item: expected } of fixture.counts) {
      const read = itemFromCounts(fixture.params, { small: counts[0], trueToSize: counts[1], large: counts[2] }, toleranceMean);
      const scale = fixture.params.margin;
      expect(Math.abs(read.offset.mean - expected.offset[0])).toBeLessThan(1e-6 * scale);
      expect(Math.abs(read.tolerance.mean - expected.tolerance[0])).toBeLessThan(1e-6 * scale);
      // The spreads come from second differences of a large sum: equal to a part in a thousand.
      expect(Math.abs(read.offset.variance - expected.offset[1])).toBeLessThanOrEqual(1e-3 * expected.offset[1]);
      expect(Math.abs(read.tolerance.variance - expected.tolerance[1])).toBeLessThanOrEqual(1e-3 * expected.tolerance[1]);
    }
  });
});
