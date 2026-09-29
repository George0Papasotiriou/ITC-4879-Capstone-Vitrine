/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Light harmonisation: a studio photograph of a piece relit, roughly, by the light of the room it is placed in.
 */

import type { Point2 } from "@/lib/vision/camera";

/**
 * docs/adr/042. A product photograph is taken in a studio: neutral white light,
 * bright and even. Pasted into a room lit by a warm lamp or a dim evening, it
 * looks cut out even at the right size. Two measurements of the room photo,
 * both made in linear light (the sRGB curve undone, so that multiplying means
 * what it does for light):
 *
 * 1. THE LIGHT — white patch. In the studio a white surface shows as white.
 *    In the room, its whitest surfaces (walls, ceilings, a sheet) show what
 *    the room's light makes of white. So the brightest 5 % of the photo, by
 *    luminance Y = 0.2126 R + 0.7152 G + 0.0722 B, is taken as the room's
 *    white: its luminance is the exposure, its colour the tint.
 *        exposure = Y_p95,                        kept within [0.25, 1.05]
 *        cast_c   = mean_c(brightest 5 %) / Y     c ∈ {R, G, B}
 *    Clipped pixels (a channel at the top of its range) say nothing about the
 *    light's colour and are left out of the tint. Eyes adapt to a colour
 *    cast, only partly, so the tint applied is cast_c^0.6, within ±15 %.
 *
 *    The first version used gray world (the average colour of the whole
 *    room is the light's colour) and exposure √(Y_spot / Y_p95). On the E4-H
 *    development rooms it made the piece LESS like the truth than doing
 *    nothing (mean ΔE2000 8.2 against 7.8): a wooden floor fills half a room
 *    and gray world reads its brown as a warm light, every time; and the
 *    floor around the piece is darker than white walls, so the exposure sat
 *    at its floor. The white patch assumes only that the room has something
 *    white-ish in it, which rooms nearly always do.
 *
 * 2. WHERE THE LIGHT COMES FROM, for the shadow. Across a disc around the
 *    piece's foot, a plane Y ≈ α + β·x + γ·y is fitted by least squares;
 *    (β, γ) points towards the brighter side, so the light comes from there
 *    and the piece's shadow falls the other way, as far as the gradient is
 *    strong:
 *        strength = min(1, |(β, γ)| · r / mean Y)
 *
 * The photograph is then multiplied, pixel by pixel in linear light, by the
 * diagonal matrix diag(exposure·tint_R, exposure·tint_G, exposure·tint_B)
 * (a von Kries adaptation from the studio's white to the room's), and gets a
 * soft shadow on the floor, offset away from the light. It is a
 * harmonisation, not a relighting: no normals, no reflections — measured in
 * E4-H against the same scan truly rendered in the room.
 */

export type LightEstimate = {
  /** Per-channel gain for the light's colour, linear. */
  tint: [number, number, number];
  exposure: number;
  /** Unit vector in image pixels, from the piece towards the light; null when the light is even. */
  towardsLight: [number, number] | null;
  /** 0 (even light) to 1 (strongly one-sided). */
  strength: number;
};

const TINT_POWER = 0.6;
const TINT_LIMIT = 0.15;
const EXPOSURE_RANGE: [number, number] = [0.25, 1.05];
/** The share of the photo, brightest first, taken as the room's white. */
const WHITE_SHARE = 0.05;
/** A channel this high (linear) is clipped: its true value is unknown. */
const CLIPPED = 0.98;

export function toLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function toSrgb(linear: number): number {
  const c = Math.min(1, Math.max(0, linear));
  return Math.round((c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055) * 255);
}

const luminance = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const clamp = (value: number, [low, high]: [number, number]) => Math.min(high, Math.max(low, value));

/** The room's light, from its whitest surfaces: exposure and tint. Once per photo. */
export function roomLight(pixels: ArrayLike<number>, width: number, height: number, step = 3): { tint: [number, number, number]; exposure: number } {
  const samples: [number, number, number, number][] = [];
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      const r = toLinear(pixels[i]!);
      const g = toLinear(pixels[i + 1]!);
      const b = toLinear(pixels[i + 2]!);
      samples.push([luminance(r, g, b), r, g, b]);
    }
  }
  if (samples.length === 0) return { tint: [1, 1, 1], exposure: 1 };
  samples.sort((a, b) => a[0] - b[0]);
  const from = Math.min(samples.length - 1, Math.floor(samples.length * (1 - WHITE_SHARE)));
  const exposure = clamp(samples[from]![0], EXPOSURE_RANGE);
  const white = samples.slice(from).filter(([, r, g, b]) => Math.max(r, g, b) < CLIPPED);
  if (white.length === 0) return { tint: [1, 1, 1], exposure };
  const mean = [1, 2, 3].map((c) => white.reduce((sum, sample) => sum + sample[c]!, 0) / white.length);
  const Y = luminance(mean[0]!, mean[1]!, mean[2]!) || 1;
  const tint = mean.map((value) => clamp((value / Y) ** TINT_POWER, [1 - TINT_LIMIT, 1 + TINT_LIMIT])) as [number, number, number];
  return { tint, exposure };
}

/** Where the piece stands: from which side the light falls, for its shadow. Each time it moves. */
export function spotLight(pixels: ArrayLike<number>, width: number, height: number, foot: Point2, radius: number, step = 2): Pick<LightEstimate, "towardsLight" | "strength"> {
  const [fx, fy] = foot;
  const spot: { dx: number; dy: number; Y: number }[] = [];
  for (let y = Math.max(0, Math.floor(fy - radius)); y < Math.min(height, Math.ceil(fy + radius)); y += step) {
    for (let x = Math.max(0, Math.floor(fx - radius)); x < Math.min(width, Math.ceil(fx + radius)); x += step) {
      const dx = x - fx;
      const dy = y - fy;
      if (dx * dx + dy * dy > radius * radius) continue;
      const i = (y * width + x) * 4;
      spot.push({ dx, dy, Y: luminance(toLinear(pixels[i]!), toLinear(pixels[i + 1]!), toLinear(pixels[i + 2]!)) });
    }
  }
  const { gradient, meanY } = planeGradient(spot);
  const magnitude = Math.hypot(gradient[0], gradient[1]);
  const strength = meanY <= 0 ? 0 : Math.min(1, (magnitude * radius) / meanY);
  const towardsLight: [number, number] | null = magnitude === 0 || strength < 0.05 ? null : [gradient[0] / magnitude, gradient[1] / magnitude];
  return { towardsLight, strength: Math.round(strength * 1000) / 1000 };
}

/**
 * Both at once. `pixels` are RGBA, row by row; `foot` is where the piece
 * stands, `radius` how far around it to look for the light's direction.
 */
export function estimateLight(pixels: ArrayLike<number>, width: number, height: number, foot: Point2, radius: number, step = 2): LightEstimate {
  return { ...roomLight(pixels, width, height, step), ...spotLight(pixels, width, height, foot, radius, step) };
}

/**
 * Least squares for Y = α + β·dx + γ·dy. With the offsets measured from the
 * disc's centre the design is nearly centred, but the normal equations are
 * solved in full (3 × 3) so a disc cut by the photo's edge stays right.
 */
function planeGradient(points: readonly { dx: number; dy: number; Y: number }[]): { gradient: [number, number]; meanY: number } {
  if (points.length < 3) return { gradient: [0, 0], meanY: 0 };
  let n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sY = 0, sxY = 0, syY = 0;
  for (const { dx, dy, Y } of points) {
    n += 1; sx += dx; sy += dy; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; sY += Y; sxY += dx * Y; syY += dy * Y;
  }
  // Solve [[n, sx, sy], [sx, sxx, sxy], [sy, sxy, syy]] · [α, β, γ] = [sY, sxY, syY] by Cramer's rule.
  const det3 = (m: number[][]) => m[0]![0]! * (m[1]![1]! * m[2]![2]! - m[1]![2]! * m[2]![1]!) - m[0]![1]! * (m[1]![0]! * m[2]![2]! - m[1]![2]! * m[2]![0]!) + m[0]![2]! * (m[1]![0]! * m[2]![1]! - m[1]![1]! * m[2]![0]!);
  const A = [[n, sx, sy], [sx, sxx, sxy], [sy, sxy, syy]];
  const det = det3(A);
  if (Math.abs(det) < 1e-9) return { gradient: [0, 0], meanY: sY / n };
  const b = [sY, sxY, syY];
  const replace = (column: number) => A.map((row, r) => row.map((value, c) => (c === column ? b[r]! : value)));
  return { gradient: [det3(replace(1)) / det, det3(replace(2)) / det], meanY: sY / n };
}

/** The diagonal matrix, in linear light, that takes a studio photograph towards the room's light. */
export function harmonizeMatrix(light: LightEstimate): [number, number, number] {
  return [light.tint[0] * light.exposure, light.tint[1] * light.exposure, light.tint[2] * light.exposure];
}

/** Applies the matrix to RGBA pixels in place, in linear light; transparent pixels and alpha are left alone. */
export function applyMatrix(pixels: Uint8ClampedArray | Uint8Array, gains: readonly [number, number, number]): void {
  // A lookup per channel: 256 entries each, so a large cut-out costs one read per value.
  const tables = gains.map((gain) => Array.from({ length: 256 }, (_, value) => toSrgb(toLinear(value) * gain)));
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] === 0) continue;
    pixels[i] = tables[0]![pixels[i]!]!;
    pixels[i + 1] = tables[1]![pixels[i + 1]!]!;
    pixels[i + 2] = tables[2]![pixels[i + 2]!]!;
  }
}

/** The piece's shadow on the floor: offset away from the light by as much as the light is one-sided. */
export function shadowFor(light: LightEstimate, heightPx: number): { dx: number; dy: number; blur: number; opacity: number } {
  const reach = heightPx * 0.22 * light.strength;
  const [tx, ty] = light.towardsLight ?? [0, 0];
  return {
    dx: Math.round(-tx * reach * 10) / 10,
    // A shadow on the floor recedes: its vertical offset in the photo is foreshortened.
    dy: Math.round(-ty * reach * 0.5 * 10) / 10,
    blur: Math.round(8 + heightPx * 0.04),
    opacity: Math.round((0.2 + 0.18 * light.strength) * 100) / 100,
  };
}
