/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The light on a face, read from the whites of the eyes, so a piece photographed in a studio can be lit like the face it is drawn on.
 */

import type { Point2 } from "@/lib/vision/camera";
import { toLinear } from "@/lib/vision/harmonize";

/**
 * docs/adr/065, after ADR-042. A piece's photograph was taken under white
 * studio light; the face in the camera is under whatever light the room
 * has. Drawn as it is, the piece looks pasted on. ADR-042 matched a cut-out
 * to a room by its brightest surfaces, assumed white (the "white patch").
 * On a face there is a better white patch: the sclera, the white of the eye,
 * which is close to neutral on every person and always in the picture.
 *
 * In linear light: the sclera's colour (mean of its brightest 40% of
 * pixels, so lashes, shadow and veins drop out) gives the light's tint, its
 * colour divided by its own luminance; its luminance against a well-lit
 * sclera's gives the exposure. The piece's pixels are multiplied by
 * tint × exposure, each gain kept within limits because a small patch can
 * mislead.
 */

export type FaceLight = { tint: [number, number, number]; exposure: number; samples: number };

/** A well-lit sclera's luminance in linear light (a frontal face at a bright window or under office light). */
export const WELL_LIT_SCLERA = 0.45;
/** Wide enough for a tungsten lamp (red about 1.4×, blue about 0.55× of daylight), narrow enough that a mistaken patch cannot paint a piece blue. */
const TINT_LIMITS = [0.5, 1.6] as const;
const EXPOSURE_LIMITS = [0.35, 1.25] as const;

const luminance = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** Even-odd rule: is a point inside a polygon? */
export function insidePolygon([x, y]: Point2, polygon: readonly Point2[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const [xi, yi] = polygon[i]!;
    const [xj, yj] = polygon[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * The linear-light pixels of the white of one eye: inside the eye's opening
 * and outside the iris (with a 20% margin for its dark rim).
 */
export function scleraPixels(rgba: ArrayLike<number>, width: number, height: number, eye: readonly Point2[], iris: { centre: Point2; radius: number }): [number, number, number][] {
  const xs = eye.map((point) => point[0]);
  const ys = eye.map((point) => point[1]);
  const x0 = Math.max(0, Math.floor(Math.min(...xs)));
  const x1 = Math.min(width - 1, Math.ceil(Math.max(...xs)));
  const y0 = Math.max(0, Math.floor(Math.min(...ys)));
  const y1 = Math.min(height - 1, Math.ceil(Math.max(...ys)));
  const out: [number, number, number][] = [];
  const keepOut = (iris.radius * 1.2) ** 2;
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      if ((x - iris.centre[0]) ** 2 + (y - iris.centre[1]) ** 2 < keepOut) continue;
      if (!insidePolygon([x + 0.5, y + 0.5], eye)) continue;
      const i = (y * width + x) * 4;
      out.push([toLinear(rgba[i]!), toLinear(rgba[i + 1]!), toLinear(rgba[i + 2]!)]);
    }
  }
  return out;
}

/** The light from both eyes' whites; null when too few pixels were seen (eyes closed or too small). */
export function faceLight(sclera: readonly [number, number, number][]): FaceLight | null {
  if (sclera.length < 12) return null;
  const sorted = [...sclera].sort((a, b) => luminance(...b) - luminance(...a));
  const brightest = sorted.slice(0, Math.max(6, Math.floor(sorted.length * 0.4)));
  const mean = brightest.reduce((sum, pixel) => [sum[0] + pixel[0], sum[1] + pixel[1], sum[2] + pixel[2]] as [number, number, number], [0, 0, 0] as [number, number, number]).map((value) => value / brightest.length) as [number, number, number];
  const y = luminance(...mean);
  if (y <= 1e-4) return null;
  const clamp = (value: number, [low, high]: readonly [number, number]) => Math.min(high, Math.max(low, value));
  return {
    tint: mean.map((value) => clamp(value / y, TINT_LIMITS)) as [number, number, number],
    exposure: clamp(y / WELL_LIT_SCLERA, EXPOSURE_LIMITS),
    samples: sclera.length,
  };
}

/** The gains to multiply a studio photograph's linear pixels by. */
export const pieceGains = (light: FaceLight | null): [number, number, number] => (light === null ? [1, 1, 1] : (light.tint.map((value) => value * light.exposure) as [number, number, number]));
