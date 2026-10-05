/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Drawing a photograph onto any four corners with a 2D canvas: the homography, cut into triangles each drawn by its own affine map.
 */

import { applyHomography, homographyDLT, type Point2 } from "@/lib/vision/camera";

/**
 * docs/adr/065. A piece's card, seen in perspective, is a quadrilateral on
 * screen, and its photograph must be mapped onto it by a homography
 * (camera.ts). A 2D canvas can only draw affine maps (straight lines stay
 * parallel). But a homography is close to affine over a small patch, and
 * exactly affine on a triangle whose three corners it maps: so the
 * photograph is cut into an n × n grid, each cell into two triangles, the
 * grid's points are mapped by the homography, and each triangle is drawn
 * with the one affine map that takes its three corners where they belong.
 * The error is zero at every grid point and tiny in between.
 */

export type Affine = [number, number, number, number, number, number];

/**
 * The affine map x' = a·x + c·y + e, y' = b·x + d·y + f (a 2D canvas's
 * setTransform order) taking the triangle `from` onto `to`; null when `from`
 * is degenerate. Solved directly: with u = from₁ − from₀, v = from₂ − from₀
 * and their images u', v', the linear part M satisfies M·[u v] = [u' v'].
 */
export function affineFromTriangles(from: readonly [Point2, Point2, Point2], to: readonly [Point2, Point2, Point2]): Affine | null {
  const [p0, p1, p2] = from;
  const [q0, q1, q2] = to;
  const ux = p1[0] - p0[0];
  const uy = p1[1] - p0[1];
  const vx = p2[0] - p0[0];
  const vy = p2[1] - p0[1];
  const det = ux * vy - vx * uy;
  if (Math.abs(det) < 1e-12) return null;
  const ux2 = q1[0] - q0[0];
  const uy2 = q1[1] - q0[1];
  const vx2 = q2[0] - q0[0];
  const vy2 = q2[1] - q0[1];
  // M = [u' v']·[u v]⁻¹, with [u v]⁻¹ = (1/det)·[[vy, −vx], [−uy, ux]].
  const a = (ux2 * vy - vx2 * uy) / det;
  const c = (-ux2 * vx + vx2 * ux) / det;
  const b = (uy2 * vy - vy2 * uy) / det;
  const d = (-uy2 * vx + vy2 * ux) / det;
  return [a, b, c, d, q0[0] - a * p0[0] - c * p0[1], q0[1] - b * p0[0] - d * p0[1]];
}

export type WarpTriangle = { from: [Point2, Point2, Point2]; to: [Point2, Point2, Point2]; transform: Affine };

/**
 * The triangles that draw a width × height photograph onto `quad` (top
 * left, top right, bottom right, bottom left), on an n × n grid. Null when
 * the quadrilateral is degenerate.
 */
export function warpTriangles(width: number, height: number, quad: readonly [Point2, Point2, Point2, Point2], n = 4): WarpTriangle[] | null {
  const corners: Point2[] = [
    [0, 0],
    [width, 0],
    [width, height],
    [0, height],
  ];
  let H;
  try {
    H = homographyDLT(corners, [...quad]);
  } catch {
    return null;
  }
  const source = (i: number, j: number): Point2 => [(width * i) / n, (height * j) / n];
  const target = (i: number, j: number): Point2 => applyHomography(H, source(i, j));
  const out: WarpTriangle[] = [];
  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      for (const [a, b, c] of [
        [
          [i, j],
          [i + 1, j],
          [i + 1, j + 1],
        ],
        [
          [i, j],
          [i + 1, j + 1],
          [i, j + 1],
        ],
      ] as const) {
        const from: [Point2, Point2, Point2] = [source(a[0], a[1]), source(b[0], b[1]), source(c[0], c[1])];
        const to: [Point2, Point2, Point2] = [target(a[0], a[1]), target(b[0], b[1]), target(c[0], c[1])];
        const transform = affineFromTriangles(from, to);
        if (transform === null) return null;
        out.push({ from, to, transform });
      }
    }
  }
  return out;
}

/** A triangle pushed out from its centre by `pixels`, so neighbouring triangles overlap a little and no seam shows between them. */
export function inflateTriangle(triangle: readonly [Point2, Point2, Point2], pixels = 0.6): [Point2, Point2, Point2] {
  const cx = (triangle[0][0] + triangle[1][0] + triangle[2][0]) / 3;
  const cy = (triangle[0][1] + triangle[1][1] + triangle[2][1]) / 3;
  return triangle.map(([x, y]) => {
    const dx = x - cx;
    const dy = y - cy;
    const length = Math.hypot(dx, dy) || 1;
    return [x + (dx / length) * pixels, y + (dy / length) * pixels] as Point2;
  }) as [Point2, Point2, Point2];
}
