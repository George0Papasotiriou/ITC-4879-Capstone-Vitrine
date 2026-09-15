/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Colour harmony in CIELAB and LCh for the Budget Stylist.
 */

/**
 * Colour harmony for the Budget Stylist (A3, docs/PLAN.md 2.6).
 *
 * Two pieces go together when their colours do. "Do" has a working definition
 * from colour theory, and it is stated in hue angles, so colours are compared
 * in CIELAB (and its polar form, LCh) rather than in RGB. RGB describes a
 * screen; CIELAB was built so that equal distances look like equal differences
 * to a human eye, and its hue angle is a usable notion of "which colour".
 *
 * sRGB → CIELAB, step by step (IEC 61966-2-1 and CIE 15, D65 white):
 *
 *   1. Scale to 0–1 and undo the sRGB transfer curve (linearise):
 *        c ≤ 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055)^2.4
 *   2. Linear RGB → XYZ with the sRGB primaries matrix.
 *   3. Divide by the D65 reference white (Xn, Yn, Zn).
 *   4. f(t) = t^(1/3) above (6/29)^3, else a linear segment that avoids an
 *      infinite slope at black:  t / (3·(6/29)²) + 4/29
 *   5. L* = 116·f(Y) − 16,  a* = 500·(f(X) − f(Y)),  b* = 200·(f(Y) − f(Z))
 *
 * LCh: chroma C = √(a*² + b*²) (how vivid), hue h = atan2(b*, a*) in degrees.
 *
 * Harmony of two colours, in [−1, 1]:
 *
 *   neutral      either colour has chroma below 18 (black, white, grey,
 *                beige): +0.5. Neutrals go with anything, which is why rooms
 *                are mostly neutral.
 *   analogous    hues within 30° of each other: +1
 *   complementary hues 150–210° apart: +0.8
 *   clash        anything else: a penalty that grows with how vivid the
 *                duller of the two colours is, −(min chroma / 60), capped at 1.
 *                Two muted colours at an awkward angle barely clash; two
 *                saturated ones do.
 */

export type Lab = { L: number; a: number; b: number };
export type LCh = { L: number; C: number; h: number };

const D65 = { X: 0.95047, Y: 1.0, Z: 1.08883 };
const EPSILON = (6 / 29) ** 3;

function linearise(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function f(t: number): number {
  return t > EPSILON ? Math.cbrt(t) : t / (3 * (6 / 29) ** 2) + 4 / 29;
}

export function hexToRgb(hex: string): [number, number, number] {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (match === null) throw new RangeError(`Not a six-digit hex colour: ${hex}`);
  const value = Number.parseInt(match[1]!, 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

export function rgbToLab([red, green, blue]: readonly [number, number, number]): Lab {
  const r = linearise(red);
  const g = linearise(green);
  const bl = linearise(blue);

  const X = 0.4124564 * r + 0.3575761 * g + 0.1804375 * bl;
  const Y = 0.2126729 * r + 0.7151522 * g + 0.072175 * bl;
  const Z = 0.0193339 * r + 0.119192 * g + 0.9503041 * bl;

  const fx = f(X / D65.X);
  const fy = f(Y / D65.Y);
  const fz = f(Z / D65.Z);

  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

export function labToLch({ L, a, b }: Lab): LCh {
  const h = (Math.atan2(b, a) * 180) / Math.PI;
  return { L, C: Math.hypot(a, b), h: h < 0 ? h + 360 : h };
}

/** The smaller angle between two hues, 0–180°. */
export function hueDifference(h1: number, h2: number): number {
  const difference = Math.abs(h1 - h2) % 360;
  return difference > 180 ? 360 - difference : difference;
}

export const NEUTRAL_CHROMA = 18;

export function harmony(first: LCh, second: LCh): number {
  if (first.C < NEUTRAL_CHROMA || second.C < NEUTRAL_CHROMA) return 0.5;
  const difference = hueDifference(first.h, second.h);
  if (difference <= 30) return 1;
  if (difference >= 150) return 0.8;
  return -Math.min(1, Math.min(first.C, second.C) / 60);
}

/**
 * A representative swatch for each canonical colour id in the catalogue
 * vocabulary (src/lib/search/vocabulary.ts). Products are tagged with ids, not
 * measured colours, so each id stands for the typical furniture shade of that
 * name — a brown sofa is walnut, not chocolate-bar brown.
 */
export const COLOR_SWATCHES: Readonly<Record<string, string>> = {
  black: "#202020",
  white: "#f5f5f2",
  grey: "#8c8c8c",
  brown: "#7b5b3e",
  beige: "#d8c7a6",
  red: "#b3342d",
  blue: "#2f5d9a",
  green: "#4f7f4a",
  yellow: "#e0b83a",
  orange: "#d9782f",
  pink: "#e3a1b0",
  purple: "#7d5a94",
  gold: "#c9a54a",
  silver: "#c0c0c4",
};

const swatchCache = new Map<string, LCh>();

export function swatch(colorId: string): LCh | null {
  const hex = COLOR_SWATCHES[colorId];
  if (hex === undefined) return null;
  let lch = swatchCache.get(colorId);
  if (lch === undefined) {
    lch = labToLch(rgbToLab(hexToRgb(hex)));
    swatchCache.set(colorId, lch);
  }
  return lch;
}

/**
 * Harmony between two products, each tagged with any number of colours: the
 * mean over every pairing of one colour from each. Zero when either product's
 * colours are unknown, so missing data neither helps nor hurts a bundle.
 */
export function paletteHarmony(first: readonly string[], second: readonly string[]): number {
  const a = first.map(swatch).filter((value): value is LCh => value !== null);
  const b = second.map(swatch).filter((value): value is LCh => value !== null);
  if (a.length === 0 || b.length === 0) return 0;
  let total = 0;
  for (const x of a) for (const y of b) total += harmony(x, y);
  return total / (a.length * b.length);
}
