/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The normal distribution's functions the Fit Engine needs, and the moments of a normal cut to an interval.
 */

/**
 * docs/adr/064. Student-built and graded (CLAUDE.md rule 6): every formula is
 * written out, and research/fit/fit/gaussian.py is the same code line for
 * line, so the shop and the evaluation (E12) compute the same numbers
 * (src/lib/fit/size/parity.test.ts).
 */

/**
 * The complementary error function, erfc(x) = 1 − erf(x).
 *
 * The Chebyshev fit of Numerical Recipes (Press et al., §6.2, "erfcc"):
 * fractional error below 1.2·10⁻⁷ everywhere, which is far finer than any fit
 * probability needs, and — unlike a library call — the same in TypeScript and
 * Python to the last bit, so the parity test can ask for 10⁻¹².
 */
export function erfc(x: number): number {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const r =
    t *
    Math.exp(
      -z * z -
        1.26551223 +
        t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))),
    );
  return x >= 0 ? r : 2 - r;
}

const SQRT2 = Math.SQRT2;
const INV_SQRT_2PI = 1 / Math.sqrt(2 * Math.PI);

/** The standard normal density φ(x) = e^(−x²/2) / √(2π). */
export const pdf = (x: number): number => INV_SQRT_2PI * Math.exp(-0.5 * x * x);

/** The standard normal distribution function Φ(x) = ½·erfc(−x/√2). */
export const cdf = (x: number): number => 0.5 * erfc(-x / SQRT2);

/** Below this an interval's probability is treated as nothing: the update would divide by it. */
const TINY = 1e-12;

/**
 * A standard normal cut to the interval [a, b] (either end may be infinite):
 * how far its mean moves (`v`) and how much its variance shrinks (`w`, so
 * the variance becomes 1 − w). These are TrueSkill's v and w (Herbrich, Minka
 * and Graepel, 2007), written for any interval instead of its two cases:
 *
 *   Z = Φ(b) − Φ(a)
 *   v = (φ(a) − φ(b)) / Z                      mean of the cut normal
 *   w = v² − (a·φ(a) − b·φ(b)) / Z             1 − its variance
 *
 * with a·φ(a) taken as 0 at a = −∞ and b·φ(b) as 0 at b = +∞.
 */
export function truncatedMoments(a: number, b: number): { v: number; w: number } {
  const pa = a === Number.NEGATIVE_INFINITY ? 0 : pdf(a);
  const pb = b === Number.POSITIVE_INFINITY ? 0 : pdf(b);
  const ca = a === Number.NEGATIVE_INFINITY ? 0 : cdf(a);
  const cb = b === Number.POSITIVE_INFINITY ? 1 : cdf(b);
  const z = cb - ca;
  if (z < TINY) {
    // The interval lies far in a tail: the cut normal sits at its near end with no spread left.
    const near = a === Number.NEGATIVE_INFINITY ? b : b === Number.POSITIVE_INFINITY ? a : Math.abs(a) < Math.abs(b) ? a : b;
    return { v: near, w: 1 };
  }
  const apa = a === Number.NEGATIVE_INFINITY ? 0 : a * pa;
  const bpb = b === Number.POSITIVE_INFINITY ? 0 : b * pb;
  const v = (pa - pb) / z;
  const w = v * v - (apa - bpb) / z;
  // Rounding can carry w a hair outside [0, 1]; a variance is never negative nor larger than it was.
  return { v, w: Math.min(1, Math.max(0, w)) };
}
