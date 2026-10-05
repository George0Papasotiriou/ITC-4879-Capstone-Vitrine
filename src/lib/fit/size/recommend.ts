/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The Fit Engine's answer: every size's chance of fitting this shopper, the best and the runner-up, and the body zones in words.
 */

import { maxOfBeliefs, sizeIndexOf, SELF_MEASURED_SD_CM, stepAt, zoneWord, type ChartRow, type ZoneWord } from "@/lib/fit/size/body";
import { predictFit, type Belief, type FitParams, type FitProbabilities, type ItemBelief } from "@/lib/fit/size/ordinal";

/**
 * docs/adr/064. The pieces together:
 *
 * 1. Each measured zone becomes a belief about the shopper's size
 *    (`sizeIndexOf`); the garment must fit all of them, so their maximum is
 *    the shopper's size for this garment (`maxOfBeliefs`).
 * 2. The item — how it runs and how forgiving it is, learned from reviewers'
 *    fit remarks, the fabric's stretch and the shop's own kept and returned
 *    sizes (evidence.ts) — shifts every size and widens or narrows "fits".
 * 3. The ordinal model gives each size its probabilities of small, fit and
 *    large (`predictFit`).
 * 4. The best size is the one most likely to fit (on a tie to within a
 *    billionth — a body exactly at a size's limit — the smaller, as the chart
 *    reads "up to"); the runner-up is next. The answer is "sure" from a 75%
 *    chance, "between" two sizes when the best is under 50% or the runner-up
 *    is within ten points of it, and "likely" otherwise.
 */

export type SizeChoice = { size: string; index: number; probabilities: FitProbabilities };

export type FitAdvice = {
  sizes: SizeChoice[];
  best: SizeChoice;
  runnerUp: SizeChoice | null;
  /** "sure" from 75% likely to fit; "between" under 50% or with the runner-up within ten points; otherwise "likely". */
  verdict: "sure" | "likely" | "between";
  /** The shopper's size on the scale for this garment, and the item belief that was used. */
  body: Belief;
  item: ItemBelief;
  /** The zone that decided (the one needing the largest size), and every measured zone in words for the best size. */
  decidedBy: string;
  zones: { zone: string; word: ZoneWord; cm: number }[];
};

export type FitInput = {
  /** The sizes in order, as they are sold ("XS"…"XL", "38"…"46"). */
  sizes: readonly string[];
  /** The chart's rows, each value lined up with `sizes`. */
  rows: readonly ChartRow[];
  /** The shopper's measurements in centimetres, by zone name. */
  measurements: Readonly<Record<string, number | undefined>>;
  /** How the item runs and how forgiving it is (`unknownItem` when nothing is known). */
  item: ItemBelief;
  params: FitParams;
  sdCm?: number;
};

export function adviseFit(input: FitInput): FitAdvice | { problem: "no_measurements" } {
  const measured = input.rows.filter((row) => typeof input.measurements[row.zone] === "number" && Number.isFinite(input.measurements[row.zone]));
  if (measured.length === 0) return { problem: "no_measurements" };
  const zones = measured.map((row) => ({ row, belief: sizeIndexOf(row, input.measurements[row.zone]!, input.sdCm ?? SELF_MEASURED_SD_CM) }));
  const body = maxOfBeliefs(zones.map((zone) => zone.belief));
  const decidedBy = zones.reduce((best, zone) => (zone.belief.mean > best.belief.mean ? zone : best)).row.zone;

  const sizes: SizeChoice[] = input.sizes.map((size, index) => ({ size, index, probabilities: predictFit(input.params, index, input.item, body) }));
  const ranked = [...sizes].sort((a, b) => (Math.abs(b.probabilities.fit - a.probabilities.fit) > 1e-9 ? b.probabilities.fit - a.probabilities.fit : a.index - b.index));
  const best = ranked[0]!;
  const runnerUp = ranked[1] ?? null;
  const close = runnerUp !== null && best.probabilities.fit - runnerUp.probabilities.fit < 0.1;
  const verdict = best.probabilities.fit >= 0.75 ? "sure" : best.probabilities.fit < 0.5 || close ? "between" : "likely";

  return {
    sizes,
    best,
    runnerUp,
    verdict,
    body,
    item: input.item,
    decidedBy,
    // In words for the size chosen, allowing for how the item runs: a size that runs large is roomier everywhere.
    zones: zones.map((zone) => ({ zone: zone.row.zone, ...zoneWord(best.index + input.item.offset.mean, zone.belief, stepAt(zone.row, best.index)) })),
  };
}

export const isFitAdvice = (result: FitAdvice | { problem: "no_measurements" }): result is FitAdvice => "best" in result;
