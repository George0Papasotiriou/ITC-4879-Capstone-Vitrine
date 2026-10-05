/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * From a body to the size scale: each measurement read against its chart row with its uncertainty, zones combined, and how stretch forgives.
 */

import { cdf, pdf } from "@/lib/fit/size/gaussian";
import type { Belief } from "@/lib/fit/size/ordinal";

/**
 * docs/adr/064. A size chart gives, for each size, the largest body
 * measurement it is cut for ("chest up to 98 cm"). Sizes are numbered 0, 1,
 * 2… in the chart's order, and the size scale is continuous between them.
 */

export type ChartRow = { zone: string; values: readonly number[] };

/** How well a person measures themselves with a tape: about ±1.5 cm (one standard deviation). */
export const SELF_MEASURED_SD_CM = 1.5;

/**
 * Where a measurement sits on the size scale, and how sure that is.
 *
 * Size k is cut for bodies from just above the previous size's limit up to
 * its own, so a body exactly at size k's limit is halfway to the next size.
 * The scale therefore runs through the points (limit_k, k + ½), linearly in
 * between, and beyond the chart by the nearest step:
 *
 *   x = 95 cm against chest limits 92 (S = 1) and 98 (M = 2)
 *   → 1.5 + (95 − 92)/(98 − 92) = 2.0: right in the middle of M.
 *
 * The measurement's ± in centimetres becomes ± in sizes by dividing by the
 * local step (the centimetres between those two limits).
 */
export function sizeIndexOf(row: ChartRow, cm: number, sdCm = SELF_MEASURED_SD_CM): Belief {
  const limits = row.values;
  if (limits.length === 1) return { mean: 0, variance: 0.25 };
  // The segment the measurement falls in, or the nearest one at either end.
  let k = 0;
  while (k < limits.length - 2 && cm > limits[k + 1]!) k += 1;
  const step = limits[k + 1]! - limits[k]!;
  const mean = k + 0.5 + (cm - limits[k]!) / step;
  const sd = sdCm / step;
  return { mean, variance: sd * sd };
}

/**
 * The size a garment must be to fit every zone: the largest of the zones'
 * sizes. Two uncertain sizes' maximum is not Gaussian, but its first two
 * moments are known exactly (Clark, 1961), and the Gaussian with those
 * moments is what the model needs. For X₁ ~ N(μ₁, σ₁²) and X₂ ~ N(μ₂, σ₂²):
 *
 *   θ = √(σ₁² + σ₂²),   α = (μ₁ − μ₂)/θ
 *   E[max] = μ₁Φ(α) + μ₂Φ(−α) + θφ(α)
 *   E[max²] = (μ₁² + σ₁²)Φ(α) + (μ₂² + σ₂²)Φ(−α) + (μ₁ + μ₂)θφ(α)
 *
 * and three or more zones are folded in two at a time.
 */
export function maxOfBeliefs(beliefs: readonly Belief[]): Belief {
  if (beliefs.length === 0) throw new Error("no beliefs");
  return beliefs.slice(1).reduce((a, b) => {
    const theta = Math.sqrt(a.variance + b.variance);
    if (theta < 1e-9) return a.mean >= b.mean ? a : b;
    const alpha = (a.mean - b.mean) / theta;
    const first = a.mean * cdf(alpha) + b.mean * cdf(-alpha) + theta * pdf(alpha);
    const second = (a.mean * a.mean + a.variance) * cdf(alpha) + (b.mean * b.mean + b.variance) * cdf(-alpha) + (a.mean + b.mean) * theta * pdf(alpha);
    return { mean: first, variance: Math.max(1e-9, second - first * first) };
  }, beliefs[0]!);
}

/** The stretch a fabric line gives ("82% cotton, 17% polyester, 1% spandex" → 1): elastane, spandex and Lycra, in percent. */
export function stretchPercent(fabric: string | null | undefined): number {
  if (fabric === null || fabric === undefined) return 0;
  let total = 0;
  for (const match of fabric.matchAll(/(\d{1,3})\s*%\s*(elastane|spandex|lycra|elasthan)/gi)) total += Number(match[1]);
  return Math.min(total, 30);
}

/**
 * How much wider "fits" is for a stretchy fabric, in size steps: a garment
 * with elastane gives where a woven one does not. A twentieth of a size per
 * percent, at most half a size (10% elastane) — a design choice, stated as
 * one: no dataset here records fabric and fit together.
 */
export const stretchAllowance = (percent: number): number => Math.min(0.5, Math.max(0, percent) * 0.05);

export type ZoneWord = "snug" | "right" | "roomy";

/**
 * A zone in words, for the size chosen: how far that size is from the body
 * there, in sizes and in centimetres. Within a quarter of a size either way
 * is "right"; a smaller garment than the body is "snug"; a larger, "roomy".
 */
export function zoneWord(size: number, zone: Belief, stepCm: number): { word: ZoneWord; cm: number } {
  const difference = size - zone.mean;
  const cm = Math.round(difference * stepCm);
  return { word: difference < -0.25 ? "snug" : difference > 0.25 ? "roomy" : "right", cm };
}

/** The centimetres between neighbouring sizes around a size, for turning size steps back into a tape measure. */
export function stepAt(row: ChartRow, size: number): number {
  const limits = row.values;
  const k = Math.min(Math.max(Math.round(size), 1), limits.length - 1);
  return limits[k]! - limits[k - 1]!;
}
