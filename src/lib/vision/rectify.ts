/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Rectifying a rug: its studio photograph, taken at an angle, warped back to the flat rug seen from above.
 */

import { applyHomography, homographyDLT, orderTaps, type Point2 } from "@/lib/vision/camera";

/**
 * docs/adr/048 addendum. The shop window lays a rug on its floor as a flat
 * textured slab, so it needs the rug as seen from straight above. The
 * catalogue does not have that photograph: a rug's first picture is usually
 * the rug in a furnished room, and its studio picture (on white) shows the
 * whole rug lying at an angle, in perspective. But a rug is a flat rectangle,
 * and a photograph of a flat rectangle is related to the rectangle itself by
 * a homography — the same 3 × 3 projective map the room planner (A4) uses to
 * read an A4 sheet on a floor. So:
 *
 *   1. CUT OUT. The studio white is removed by the edge flood fill
 *      (src/lib/vision/cutout.ts); what remains is the rug's silhouette.
 *
 *   2. FIND THE CORNERS. A convex quadrilateral is the silhouette of a flat
 *      rectangle in perspective. Its corners are among the silhouette's
 *      extreme points: for each of 16 directions θ, the pixel that goes
 *      furthest that way (maximum of x·cos θ + y·sin θ). Of those candidates,
 *      the four that enclose the largest area are the corners. Choosing by
 *      area makes a fringe or a soft edge cost little: the corners are where
 *      most of the rug's area is spanned from.
 *
 *   3. ORIENT. The corners are put in order around the centre
 *      (camera.ts orderTaps). Opposite edges of the quadrilateral are averaged;
 *      the longer pair is the rug's long side. Perspective shortens the far
 *      edge, which averaging tolerates.
 *
 *   4. WARP. The homography H from the output rectangle to the photo's
 *      quadrilateral (DLT with normalisation, camera.ts homographyDLT) sends
 *      every output pixel to the point of the photograph it shows; that point
 *      is sampled bilinearly. The output has the rug's true proportions, from
 *      its listed size.
 *
 * Nothing about the rug is invented: every output pixel is a pixel of its own
 * photograph, put back where it lies on the rug.
 */

export type Quad = [Point2, Point2, Point2, Point2];

/** Twice the area of a convex polygon given in order (shoelace). */
function area2(points: readonly Point2[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const [x1, y1] = points[i]!;
    const [x2, y2] = points[(i + 1) % points.length]!;
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum);
}

/**
 * The four corners of the silhouette in `mask` (1 = rug), or null when there
 * is no sensible quadrilateral (an empty mask, or one too small to be a rug).
 */
export function quadFromMask(mask: { data: ArrayLike<number>; width: number; height: number }, directions = 16): Quad | null {
  const { data, width, height } = mask;
  const cos = Array.from({ length: directions }, (_, k) => Math.cos((2 * Math.PI * k) / directions));
  const sin = Array.from({ length: directions }, (_, k) => Math.sin((2 * Math.PI * k) / directions));
  const best = new Array<number>(directions).fill(-Infinity);
  const at: (Point2 | null)[] = new Array(directions).fill(null);
  let count = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[y * width + x] === 0) continue;
      count += 1;
      for (let k = 0; k < directions; k += 1) {
        const reach = x * cos[k]! + y * sin[k]!;
        if (reach > best[k]!) {
          best[k] = reach;
          at[k] = [x, y];
        }
      }
    }
  }
  // Fewer than 1% of the photograph is not a rug worth rectifying.
  if (count < width * height * 0.01) return null;
  const candidates = at.filter((point): point is Point2 => point !== null).filter((point, index, all) => all.findIndex((other) => other[0] === point[0] && other[1] === point[1]) === index);
  if (candidates.length < 4) return null;

  let bestQuad: Quad | null = null;
  let bestArea = -1;
  const n = candidates.length;
  for (let a = 0; a < n; a += 1) {
    for (let b = a + 1; b < n; b += 1) {
      for (let c = b + 1; c < n; c += 1) {
        for (let d = c + 1; d < n; d += 1) {
          const ordered = orderTaps([candidates[a]!, candidates[b]!, candidates[c]!, candidates[d]!]);
          if (ordered === null) continue;
          const area = area2(ordered);
          if (area > bestArea) {
            bestArea = area;
            bestQuad = ordered;
          }
        }
      }
    }
  }
  // A "quadrilateral" that covers less than half the silhouette is not the rug's outline.
  return bestQuad !== null && bestArea / 2 >= count * 0.5 ? bestQuad : null;
}

/**
 * The output rectangle for a quad (in orderTaps' order, counter-clockwise from
 * the corner nearest the camera) and the rug's true proportions: the longer
 * pair of opposite edges becomes the rug's long side. Returns the rectangle's
 * corners, matched one to one with the quad's, and its size in pixels.
 */
export function targetRectangle(quad: Quad, rug: { long: number; short: number }, longSidePixels = 1024): { corners: Quad; width: number; height: number } {
  const length = (p: Point2, q: Point2) => Math.hypot(q[0] - p[0], q[1] - p[1]);
  const firstPair = (length(quad[0], quad[1]) + length(quad[2], quad[3])) / 2;
  const secondPair = (length(quad[1], quad[2]) + length(quad[3], quad[0])) / 2;
  const shortPixels = Math.max(1, Math.round((longSidePixels * rug.short) / rug.long));
  // quad[0] → quad[1] runs along the output's bottom edge, left to right; the rest follow counter-clockwise.
  const width = firstPair >= secondPair ? longSidePixels : shortPixels;
  const height = firstPair >= secondPair ? shortPixels : longSidePixels;
  return {
    corners: [
      [0, height],
      [width, height],
      [width, 0],
      [0, 0],
    ],
    width,
    height,
  };
}

/**
 * The reverse of `warp`: a flat picture (a rectified rug) laid onto a
 * quadrilateral of a larger picture (the floor of a room, in perspective).
 * `quad` holds where the picture's corners land, in the same order as
 * `targetRectangle`'s: bottom-left, bottom-right, top-right, top-left. The
 * homography from the quad to the flat picture sends every output pixel to the
 * point of the picture it shows; pixels it sends outside the picture are left
 * transparent, so only the quad is painted.
 */
export function warpOnto(source: { data: ArrayLike<number>; width: number; height: number }, quad: Quad, size: { width: number; height: number }): Uint8ClampedArray<ArrayBuffer> {
  const { data, width, height } = source;
  const corners: Quad = [
    [0, height],
    [width, height],
    [width, 0],
    [0, 0],
  ];
  const H = homographyDLT(quad, corners);
  const out = new Uint8ClampedArray(size.width * size.height * 4);
  // Only the quad's bounding box can be painted.
  const xs = quad.map((corner) => corner[0]);
  const ys = quad.map((corner) => corner[1]);
  const x0 = Math.max(0, Math.floor(Math.min(...xs)));
  const x1 = Math.min(size.width, Math.ceil(Math.max(...xs)));
  const y0 = Math.max(0, Math.floor(Math.min(...ys)));
  const y1 = Math.min(size.height, Math.ceil(Math.max(...ys)));
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const [u, v] = applyHomography(H, [x + 0.5, y + 0.5]);
      if (!(u >= 0 && u < width && v >= 0 && v < height)) continue;
      const sx = Math.min(width - 1.001, Math.max(0, u - 0.5));
      const sy = Math.min(height - 1.001, Math.max(0, v - 0.5));
      const ix = Math.floor(sx);
      const iy = Math.floor(sy);
      const fx = sx - ix;
      const fy = sy - iy;
      const index = (y * size.width + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        const top = data[(iy * width + ix) * 4 + channel]! * (1 - fx) + data[(iy * width + ix + 1) * 4 + channel]! * fx;
        const bottom = data[((iy + 1) * width + ix) * 4 + channel]! * (1 - fx) + data[((iy + 1) * width + ix + 1) * 4 + channel]! * fx;
        out[index + channel] = top * (1 - fy) + bottom * fy;
      }
    }
  }
  return out;
}

/** The photograph warped onto the output rectangle: each output pixel sampled bilinearly from where H sends it. */
export function warp(source: { data: ArrayLike<number>; width: number; height: number }, quad: Quad, target: { corners: Quad; width: number; height: number }): Uint8ClampedArray<ArrayBuffer> {
  const H = homographyDLT(target.corners, quad);
  const out = new Uint8ClampedArray(target.width * target.height * 4);
  const { data, width, height } = source;
  for (let y = 0; y < target.height; y += 1) {
    for (let x = 0; x < target.width; x += 1) {
      const [u, v] = applyHomography(H, [x + 0.5, y + 0.5]);
      const sx = Math.min(width - 1.001, Math.max(0, u - 0.5));
      const sy = Math.min(height - 1.001, Math.max(0, v - 0.5));
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const fx = sx - x0;
      const fy = sy - y0;
      const index = (y * target.width + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        const top = data[(y0 * width + x0) * 4 + channel]! * (1 - fx) + data[(y0 * width + x0 + 1) * 4 + channel]! * fx;
        const bottom = data[((y0 + 1) * width + x0) * 4 + channel]! * (1 - fx) + data[((y0 + 1) * width + x0 + 1) * 4 + channel]! * fx;
        out[index + channel] = top * (1 - fy) + bottom * fy;
      }
    }
  }
  return out;
}
