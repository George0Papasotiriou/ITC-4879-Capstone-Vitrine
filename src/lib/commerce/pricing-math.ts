/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Rounded integer division used by every money calculation.
 */

/**
 * Integer division rounded half away from zero, for non-negative integers: the
 * one rounding rule every money calculation in the shop uses, so a VAT line or
 * a converted price is never a cent off between two places that compute it.
 */
export function divideRounded(numerator: number, denominator: number): number {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || denominator <= 0 || numerator < 0) {
    throw new RangeError("divideRounded expects a non-negative safe integer and a positive divisor");
  }
  return Math.floor((2 * numerator + denominator) / (2 * denominator));
}
