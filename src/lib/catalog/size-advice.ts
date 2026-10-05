/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Size advice: a size from one or two body measurements, read against the piece's own chart.
 */

import type { SizeChart } from "@/lib/catalog/capsule";
import { CAPSULE_SIZES, type CapsuleSize } from "@/lib/catalog/taxonomy";
import { SHOP_FIT_PARAMS } from "@/lib/fit/size/model";
import { unknownItem, type ItemBelief } from "@/lib/fit/size/ordinal";
import { adviseFit, isFitAdvice, type FitAdvice } from "@/lib/fit/size/recommend";

/**
 * docs/adr/034. The questionnaire on a garment's page and the Concierge's
 * `suggest_size` both come here, so they cannot disagree.
 *
 * Only the chart's first two rows are asked: they are the body's girths
 * (chest and waist for what is worn above, waist and hip below). The third
 * row is the garment's length, which a shopper does not measure on
 * themselves.
 *
 * The rule, per measurement: the smallest size whose chart value is at least
 * the measurement (a garment has to close around the body). With two
 * measurements the larger of the two sizes wins, for the same reason — a
 * jacket that fits the waist but not the chest does not fit. When the two
 * point more than one size apart the advice says so, because then no size
 * fits both well and the shopper should know before buying.
 */

/** Measurements outside this range are typing mistakes (or inches), not bodies. */
export const MEASURE_MIN_CM = 40;
export const MEASURE_MAX_CM = 200;

/** How many chart rows a shopper is asked for. */
export const ASKED_MEASURES = 2;

export type MeasureVerdict = {
  /** Row of the chart (0 or 1). */
  index: number;
  cm: number;
  size: CapsuleSize;
  /** The chart value for that size in this row: "up to 98 cm". */
  upToCm: number;
  /** Larger than the largest size in this row. */
  beyondChart: boolean;
};

export type SizeAdvice = {
  size: CapsuleSize;
  beyondChart: boolean;
  /** The row that decided the size (the one needing the larger size). */
  decidedBy: number;
  /** Size steps between the two measurements' sizes: 0 or 1 is normal; 2 or more, no size fits both well. */
  apart: number;
  verdicts: MeasureVerdict[];
};

export type AdviceProblem = { problem: "no_measurements" } | { problem: "out_of_range"; index: number };

/** The size for one measurement against one chart row. */
export function sizeForMeasure(row: SizeChart, cm: number, index: number): MeasureVerdict {
  for (const size of CAPSULE_SIZES) {
    if (cm <= row.values[size]) return { index, cm, size, upToCm: row.values[size], beyondChart: false };
  }
  const largest = CAPSULE_SIZES[CAPSULE_SIZES.length - 1]!;
  return { index, cm, size: largest, upToCm: row.values[largest], beyondChart: true };
}

/**
 * Advice from the chart and the measurements given (null or absent for a
 * measurement not taken). At least one is needed.
 */
export function adviseSize(chart: readonly SizeChart[], measurements: readonly (number | null | undefined)[]): SizeAdvice | AdviceProblem {
  const verdicts: MeasureVerdict[] = [];
  for (let index = 0; index < Math.min(ASKED_MEASURES, chart.length); index += 1) {
    const cm = measurements[index];
    if (cm === null || cm === undefined || Number.isNaN(cm)) continue;
    if (cm < MEASURE_MIN_CM || cm > MEASURE_MAX_CM) return { problem: "out_of_range", index };
    verdicts.push(sizeForMeasure(chart[index]!, cm, index));
  }
  if (verdicts.length === 0) return { problem: "no_measurements" };

  const rank = (size: CapsuleSize) => CAPSULE_SIZES.indexOf(size);
  // The measurement needing the larger size decides; on a tie, the first row (chest or waist).
  const decider = verdicts.reduce((best, verdict) => (rank(verdict.size) > rank(best.size) ? verdict : best));
  const ranks = verdicts.map((verdict) => rank(verdict.size));
  return {
    size: decider.size,
    beyondChart: decider.beyondChart,
    decidedBy: decider.index,
    apart: Math.max(...ranks) - Math.min(...ranks),
    verdicts,
  };
}

export function isAdvice(result: SizeAdvice | AdviceProblem): result is SizeAdvice {
  return "size" in result;
}

/**
 * The Fit Engine's advice from the same chart rows and measurements
 * (docs/adr/064): every size's chance of fitting, allowing for how this piece
 * runs and how forgiving it is (`item`, from its reviews and the shop's
 * returns). With nothing known about the piece it agrees with the chart rule
 * above; what it adds is how sure the advice is, the size next most likely,
 * each zone in words, and the piece's own lean. Measurements out of range
 * are left out, as the chart rule refuses them.
 */
export function engineAdvice(chart: readonly SizeChart[], measurements: readonly (number | null | undefined)[], item: ItemBelief = unknownItem(SHOP_FIT_PARAMS)): FitAdvice | null {
  const rows = chart.slice(0, ASKED_MEASURES).map((row) => ({ zone: row.measure.en, values: CAPSULE_SIZES.map((size) => row.values[size]) }));
  const measured: Record<string, number> = {};
  rows.forEach((row, index) => {
    const cm = measurements[index];
    if (typeof cm === "number" && Number.isFinite(cm) && cm >= MEASURE_MIN_CM && cm <= MEASURE_MAX_CM) measured[row.zone] = cm;
  });
  const advice = adviseFit({ sizes: CAPSULE_SIZES, rows, measurements: measured, item, params: SHOP_FIT_PARAMS });
  return isFitAdvice(advice) ? advice : null;
}
