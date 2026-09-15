/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Refines tapped sheet corners to sub-pixel accuracy by fitting edge lines.
 */

import type { Point2 } from "@/lib/vision/camera";
import { column, symmetricEigen } from "@/lib/vision/linalg";

/**
 * Snap rough taps to the sheet's true corners, to a fraction of a pixel.
 *
 * A finger (even with a loupe) lands a few pixels off, and the pose is
 * sensitive to that: on synthetic scenes the size error grows roughly in
 * proportion to tap noise. But a sheet of paper on a floor has four long,
 * straight, high-contrast edges, and many points along a line locate it far more
 * precisely than one tap locates a corner.
 *
 * For each side of the tapped quadrilateral:
 *   1. Sample stations along the middle 70% of the side (corners themselves are
 *      blurred and often occluded by shadows).
 *   2. At each station, read the brightness profile across the side and find the
 *      strongest step: the peak of the derivative, refined to sub-pixel precision
 *      by fitting a parabola through the peak and its two neighbours,
 *      offset = (g₋ − g₊) / (2·(g₋ − 2g₀ + g₊)).
 *   3. Fit a line to those edge points by total least squares: through their
 *      centroid, along the principal direction of their scatter. Points further
 *      than 3 robust standard deviations (1.4826 × median distance) are dropped
 *      once, and the line refitted, so a shoe or a rug pattern does not bend it.
 * Each corner is the intersection of its two adjacent lines. A corner keeps its
 * tap when either line is unreliable (too few edge points, too little spread,
 * weak contrast, or points scattered more than a pixel from the line) or when
 * the intersection lands implausibly far from the tap.
 */

export type GrayImage = { data: Float32Array; width: number; height: number };

/** Luminance (Rec. 709 weights on sRGB values, 0–1) from canvas RGBA pixels. */
export function toGray(rgba: Uint8ClampedArray, width: number, height: number): GrayImage {
  const data = new Float32Array(width * height);
  for (let i = 0; i < width * height; i += 1) {
    data[i] = (0.2126 * rgba[i * 4]! + 0.7152 * rgba[i * 4 + 1]! + 0.0722 * rgba[i * 4 + 2]!) / 255;
  }
  return { data, width, height };
}

/** Bilinear interpolation; NaN outside the image. */
export function sample({ data, width, height }: GrayImage, x: number, y: number): number {
  if (!(x >= 0 && y >= 0 && x <= width - 1 && y <= height - 1)) return Number.NaN;
  const x0 = Math.min(Math.floor(x), width - 2);
  const y0 = Math.min(Math.floor(y), height - 2);
  const fx = x - x0;
  const fy = y - y0;
  const i = y0 * width + x0;
  const top = data[i]! * (1 - fx) + data[i + 1]! * fx;
  const bottom = data[i + width]! * (1 - fx) + data[i + width + 1]! * fx;
  return top * (1 - fy) + bottom * fy;
}

export type Line = { point: Point2; direction: Point2 };

export function fitLine(points: readonly Point2[]): { line: Line; distances: number[] } | null {
  if (points.length < 2) return null;
  const cx = points.reduce((sum, p) => sum + p[0], 0) / points.length;
  const cy = points.reduce((sum, p) => sum + p[1], 0) / points.length;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const [x, y] of points) {
    sxx += (x - cx) ** 2;
    sxy += (x - cx) * (y - cy);
    syy += (y - cy) ** 2;
  }
  // The largest-eigenvalue eigenvector of the scatter matrix is the line's direction.
  const { vectors } = symmetricEigen([sxx, sxy, sxy, syy], 2);
  const direction = column(vectors, 2, 1) as Point2;
  const normal: Point2 = [-direction[1], direction[0]];
  const distances = points.map(([x, y]) => Math.abs((x - cx) * normal[0] + (y - cy) * normal[1]));
  return { line: { point: [cx, cy], direction }, distances };
}

export function intersectLines(a: Line, b: Line): Point2 | null {
  // Solve a.point + s·a.direction = b.point + u·b.direction for s (Cramer's rule).
  const det = a.direction[0] * -b.direction[1] - a.direction[1] * -b.direction[0];
  if (Math.abs(det) < 1e-9) return null;
  const dx = b.point[0] - a.point[0];
  const dy = b.point[1] - a.point[1];
  const s = (dx * -b.direction[1] - dy * -b.direction[0]) / det;
  return [a.point[0] + s * a.direction[0], a.point[1] + s * a.direction[1]];
}

/** The point on a line nearest to p (the direction is a unit vector). */
export function projectOntoLine(line: Line, p: Point2): Point2 {
  const s = (p[0] - line.point[0]) * line.direction[0] + (p[1] - line.point[1]) * line.direction[1];
  return [line.point[0] + s * line.direction[0], line.point[1] + s * line.direction[1]];
}

export type CornerRefinement = {
  corners: Point2[];
  /** Per corner: whether it was moved to the intersection of both its edges (a corner with one reliable edge is only slid onto it). */
  refined: boolean[];
  /** Per side: edge points used and their RMS distance from the fitted line, pixels. */
  sides: { points: number; rms: number }[];
};

export function refineCorners(
  image: GrayImage,
  taps: readonly Point2[],
  options: { searchRadius?: number; stations?: number; minContrast?: number; maxLineRms?: number; maxShift?: number } = {},
): CornerRefinement {
  const { searchRadius = 12, stations = 32, minContrast = 0.04, maxLineRms = 1 } = options;
  const maxShift = options.maxShift ?? searchRadius * 1.5;
  if (taps.length !== 4) throw new RangeError("Refine exactly four corners");

  const lines: (Line | null)[] = [];
  const sides: CornerRefinement["sides"] = [];

  for (let side = 0; side < 4; side += 1) {
    const a = taps[side]!;
    const b = taps[(side + 1) % 4]!;
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (length < 4 * searchRadius) {
      lines.push(null);
      sides.push({ points: 0, rms: Number.NaN });
      continue;
    }
    const along: Point2 = [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
    const across: Point2 = [-along[1], along[0]];

    // Collect the strongest step at each station, with its sign.
    const found: { point: Point2; strength: number; sign: number }[] = [];
    for (let k = 0; k < stations; k += 1) {
      const t = 0.15 + (0.7 * (k + 0.5)) / stations;
      const base: Point2 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      const step = 0.5;
      const profile: number[] = [];
      for (let o = -searchRadius; o <= searchRadius + 1e-9; o += step) {
        // Average three samples along the side to suppress pixel noise.
        let sum = 0;
        for (const dl of [-1, 0, 1]) sum += sample(image, base[0] + across[0] * o + along[0] * dl, base[1] + across[1] * o + along[1] * dl);
        profile.push(sum / 3);
      }
      if (profile.some((value) => Number.isNaN(value))) continue;
      const gradient = profile.map((_, i) => (i === 0 || i === profile.length - 1 ? 0 : (profile[i + 1]! - profile[i - 1]!) / (2 * step)));
      let peak = 1;
      for (let i = 2; i < gradient.length - 1; i += 1) if (Math.abs(gradient[i]!) > Math.abs(gradient[peak]!)) peak = i;
      const g0 = Math.abs(gradient[peak]!);
      // The brightness step across the edge, in 0–1 units, must be visible.
      if (g0 * 2 < minContrast) continue;
      const gm = Math.abs(gradient[peak - 1]!);
      const gp = Math.abs(gradient[peak + 1]!);
      const curvature = gm - 2 * g0 + gp;
      const offset = curvature < 0 ? Math.max(-0.5, Math.min(0.5, (gm - gp) / (2 * curvature))) : 0;
      const o = -searchRadius + (peak + offset) * step;
      found.push({ point: [base[0] + across[0] * o, base[1] + across[1] * o], strength: g0, sign: Math.sign(gradient[peak]!) });
    }

    // Paper is brighter (or darker) than the floor all along one side: keep the majority sign.
    const positives = found.filter((f) => f.sign > 0).length;
    const majority = positives * 2 >= found.length ? 1 : -1;
    let points = found.filter((f) => f.sign === majority).map((f) => f.point);

    // A trustworthy side has edge points at at least half the stations, spread
    // over at least half of the sampled stretch. A tap far off the true corner
    // tilts the search so only one end finds the edge, which fails the spread.
    const minimumPoints = Math.max(6, stations / 2);
    const spreadEnough = (candidates: Point2[]) => {
      const positions = candidates.map((p) => (p[0] - a[0]) * along[0] + (p[1] - a[1]) * along[1]);
      return Math.max(...positions) - Math.min(...positions) >= 0.5 * 0.7 * length;
    };
    const usable = (candidates: Point2[]) => candidates.length >= minimumPoints && spreadEnough(candidates);

    let fit = usable(points) ? fitLine(points) : null;
    if (fit !== null) {
      const sorted = [...fit.distances].sort((x, y) => x - y);
      const robustSigma = 1.4826 * sorted[Math.floor(sorted.length / 2)]!;
      const limit = Math.max(3 * robustSigma, 0.25);
      points = points.filter((_, i) => fit!.distances[i]! <= limit);
      fit = usable(points) ? fitLine(points) : null;
    }
    const rms = fit === null ? Number.NaN : Math.sqrt(fit.distances.reduce((sum, d) => sum + d * d, 0) / fit.distances.length);
    // A real paper edge is straight to a fraction of a pixel; scattered points mean the search found texture, not the edge.
    lines.push(fit !== null && rms <= maxLineRms ? fit.line : null);
    sides.push({ points: fit === null ? 0 : points.length, rms });
  }

  const corners: Point2[] = [];
  const refined: boolean[] = [];
  for (let corner = 0; corner < 4; corner += 1) {
    const before = lines[(corner + 3) % 4];
    const after = lines[corner];
    const tap = taps[corner]!;
    const intersection = before && after ? intersectLines(before, after) : null;
    if (intersection !== null && Math.hypot(intersection[0] - tap[0], intersection[1] - tap[1]) <= maxShift) {
      corners.push(intersection);
      refined.push(true);
      continue;
    }
    refined.push(false);
    // With one reliable edge, the corner still lies on it: move the tap to its
    // nearest point on that line, which removes the error across the edge.
    const single = before && !after ? before : after && !before ? after : null;
    const projected = single === null ? null : projectOntoLine(single, tap);
    if (projected !== null && Math.hypot(projected[0] - tap[0], projected[1] - tap[1]) <= searchRadius) {
      corners.push(projected);
    } else {
      corners.push([tap[0], tap[1]]);
    }
  }
  return { corners, refined, sides };
}
