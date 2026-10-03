/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Tests for rectifying a rug photograph: its corners found, its long side kept long, its pattern put back flat.
 */

import { describe, expect, it } from "vitest";

import { applyHomography, homographyDLT, type Point2 } from "@/lib/vision/camera";
import { quadFromMask, targetRectangle, warp, warpOnto, type Quad } from "@/lib/vision/rectify";

/**
 * A synthetic studio photograph: a 2 : 1 rug lying in perspective on white.
 * The rug's left third is red, its right third blue, the middle grey; its
 * near half is dark and its far half light — so any flip or turn in the
 * rectified picture shows.
 */
const W = 480;
const H = 320;
// The rug's corners in the photograph: near-left, near-right, far-right, far-left (the far edge shorter).
const PHOTO: Quad = [
  [70, 270],
  [420, 245],
  [350, 70],
  [110, 85],
];
const RUG: Point2[] = [
  [0, 0],
  [200, 0],
  [200, 100],
  [0, 100],
];

function photograph() {
  const toRug = homographyDLT(PHOTO, RUG);
  const rgba = new Uint8ClampedArray(W * H * 4).fill(255);
  const mask = new Uint8Array(W * H);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const [u, v] = applyHomography(toRug, [x + 0.5, y + 0.5]);
      if (u < 0 || u > 200 || v < 0 || v > 100) continue;
      const index = y * W + x;
      mask[index] = 1;
      const [r, b] = u < 66 ? [220, 30] : u > 134 ? [30, 220] : [120, 120];
      rgba.set([r, v < 50 ? 60 : 180, b, 255], index * 4);
    }
  }
  return { rgba, mask };
}

describe("rectifying a rug", () => {
  const { rgba, mask } = photograph();

  it("finds the four corners of the silhouette, to within two pixels", () => {
    const quad = quadFromMask({ data: mask, width: W, height: H });
    expect(quad).not.toBeNull();
    for (const corner of PHOTO) {
      const nearest = Math.min(...quad!.map((point) => Math.hypot(point[0] - corner[0], point[1] - corner[1])));
      expect(nearest).toBeLessThan(2);
    }
  });

  it("keeps the rug's long side long, at its true proportions", () => {
    const quad = quadFromMask({ data: mask, width: W, height: H })!;
    const target = targetRectangle(quad, { long: 2, short: 1 }, 400);
    expect([target.width, target.height]).toEqual([400, 200]);
  });

  it("puts the pattern back flat: the colour bands run across, the light and dark halves stay apart", () => {
    const quad = quadFromMask({ data: mask, width: W, height: H })!;
    const target = targetRectangle(quad, { long: 2, short: 1 }, 400);
    const flat = warp({ data: rgba, width: W, height: H }, quad, target);
    const at = (x: number, y: number) => Array.from(flat.slice((y * target.width + x) * 4, (y * target.width + x) * 4 + 3));
    // Columns well inside the red and blue thirds, at both depths.
    const leftNear = at(40, 160);
    const leftFar = at(40, 40);
    const rightNear = at(360, 160);
    const rightFar = at(360, 40);
    // One end red, the other blue, whichever way round, and each end one colour from near to far.
    expect(Math.abs(leftNear[0]! - leftFar[0]!)).toBeLessThan(25);
    expect(Math.abs(rightNear[0]! - rightFar[0]!)).toBeLessThan(25);
    expect(Math.abs(leftNear[0]! - rightNear[0]!)).toBeGreaterThan(150);
    // Near and far differ in green, the same way at both ends: rows were not mixed.
    expect(Math.sign(leftNear[1]! - leftFar[1]!)).toBe(Math.sign(rightNear[1]! - rightFar[1]!));
    expect(Math.abs(leftNear[1]! - leftFar[1]!)).toBeGreaterThan(80);
    // Nothing of the white studio is left inside the rectangle.
    expect(Math.min(...at(200, 100))).toBeLessThan(200);
  });

  it("gives no quadrilateral for an empty or tiny silhouette", () => {
    expect(quadFromMask({ data: new Uint8Array(W * H), width: W, height: H })).toBeNull();
    const speck = new Uint8Array(W * H);
    speck[H / 2 * W + W / 2] = 1;
    expect(quadFromMask({ data: speck, width: W, height: H })).toBeNull();
  });
});

describe("laying a flat picture onto a floor (docs/adr/053)", () => {
  // A 40 × 20 flat rug: its left half red, its right half blue, fully opaque.
  const flat = { data: new Uint8ClampedArray(40 * 20 * 4), width: 40, height: 20 };
  for (let y = 0; y < 20; y += 1) for (let x = 0; x < 40; x += 1) flat.data.set(x < 20 ? [200, 30, 30, 255] : [30, 30, 200, 255], (y * 40 + x) * 4);
  // A trapezoid as a floor in perspective shows it: the near edge wide and low, the far edge narrower and higher.
  const quad: Quad = [
    [10, 90],
    [110, 90],
    [90, 60],
    [30, 60],
  ];
  const out = warpOnto(flat, quad, { width: 120, height: 100 });
  const at = (x: number, y: number) => Array.from(out.slice((y * 120 + x) * 4, (y * 120 + x) * 4 + 4));

  it("paints only inside the quadrilateral and leaves the rest transparent", () => {
    expect(at(5, 5)[3]).toBe(0);
    expect(at(60, 95)[3]).toBe(0);
    expect(at(15, 62)[3]).toBe(0);
    expect(at(60, 75)[3]).toBe(255);
  });

  it("keeps each half on its own side, with the seam on the projected midline", () => {
    expect(at(40, 80).slice(0, 3)).toEqual([200, 30, 30]);
    expect(at(85, 80).slice(0, 3)).toEqual([30, 30, 200]);
    // The rug's midline runs from (60, 90) to (60, 60): symmetric trapezoid, so it stays at x = 60.
    expect(at(57, 70)[0]).toBeGreaterThan(at(57, 70)[2]!);
    expect(at(63, 70)[2]).toBeGreaterThan(at(63, 70)[0]!);
  });
});
