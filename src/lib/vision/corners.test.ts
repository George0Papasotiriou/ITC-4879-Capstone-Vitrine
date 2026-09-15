/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Unit tests for sub-pixel sheet corner refinement.
 */

import { describe, expect, it } from "vitest";

import { seededRandom } from "@/lib/reco/simulate";
import { orderTaps, type Point2 } from "@/lib/vision/camera";
import { fitLine, intersectLines, refineCorners, sample, toGray, type GrayImage } from "@/lib/vision/corners";
import { randomScene, renderSheet, withTapNoise } from "@/lib/vision/synthetic";

const error = (a: Point2, b: Point2) => Math.hypot(a[0] - b[0], a[1] - b[1]);

describe("image sampling and line geometry", () => {
  it("converts RGBA to luminance and interpolates bilinearly", () => {
    const rgba = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255, 255, 0, 0, 0, 255]);
    const gray = toGray(rgba, 2, 2);
    expect(gray.data[1]).toBeCloseTo(1, 6);
    expect(sample(gray, 0.5, 0)).toBeCloseTo(0.5, 6);
    expect(sample(gray, 0.5, 0.5)).toBeCloseTo(0.5, 6);
    expect(Number.isNaN(sample(gray, -1, 0))).toBe(true);
  });

  it("fits a line by total least squares and intersects two lines", () => {
    const fit = fitLine([
      [0, 1],
      [1, 3],
      [2, 5],
      [3, 7],
    ])!;
    expect(Math.abs(fit.line.direction[1] / fit.line.direction[0])).toBeCloseTo(2, 10);
    fit.distances.forEach((d) => expect(d).toBeCloseTo(0, 10));
    const other = fitLine([
      [0, 4],
      [4, 0],
    ])!.line;
    const p = intersectLines(fit.line, other)!;
    expect(p[0]).toBeCloseTo(1, 10);
    expect(p[1]).toBeCloseTo(3, 10);
    expect(intersectLines(fit.line, { point: [5, 5], direction: fit.line.direction })).toBeNull();
  });
});

describe("snapping taps to the sheet's corners", () => {
  it("brings 3 px taps to well under half a pixel", () => {
    const random = seededRandom(51);
    let tapError = 0;
    let refinedError = 0;
    let count = 0;
    for (let trial = 0; trial < 8; trial += 1) {
      const scene = randomScene(random, { width: 640, height: 480, distance: [0.6, 1.4] });
      const truth = orderTaps(scene.image)!;
      const image = renderSheet(truth, 640, 480, random);
      const taps = withTapNoise(truth, 3, random);
      const result = refineCorners(image, taps, { searchRadius: 10 });
      result.corners.forEach((corner, i) => {
        if (!result.refined[i]) return;
        tapError += error(taps[i]!, truth[i]!) ** 2;
        refinedError += error(corner, truth[i]!) ** 2;
        count += 1;
      });
    }
    expect(count).toBeGreaterThan(24);
    const tapRms = Math.sqrt(tapError / count);
    const refinedRms = Math.sqrt(refinedError / count);
    expect(tapRms).toBeGreaterThan(2);
    expect(refinedRms).toBeLessThan(0.5);
  });

  it("ignores a dark blob sitting on one edge", () => {
    const random = seededRandom(53);
    const truth: Point2[] = [
      [180, 380],
      [470, 360],
      [430, 170],
      [220, 180],
    ];
    const image = renderSheet(truth, 640, 480, random, { blobs: [{ centre: [325, 372], radius: 9 }] });
    const result = refineCorners(image, withTapNoise(truth, 2.5, random), { searchRadius: 10 });
    expect(result.refined.every(Boolean)).toBe(true);
    result.corners.forEach((corner, i) => expect(error(corner, truth[i]!)).toBeLessThan(0.6));
  });

  it("slides a corner onto its one reliable edge when the other edge is hidden", () => {
    const random = seededRandom(59);
    const truth: Point2[] = [
      [180, 380],
      [470, 360],
      [430, 170],
      [220, 180],
    ];
    // A large shadow over the middle of the bottom edge (corner 0 → corner 1).
    const image = renderSheet(truth, 640, 480, random, { blobs: [{ centre: [325, 372], radius: 70 }] });
    const taps: Point2[] = truth.map(([x, y], i) => [x + (i % 2 === 0 ? 3 : -3), y + 3]);
    const result = refineCorners(image, taps, { searchRadius: 10 });
    expect(result.refined[0]).toBe(false);
    expect(result.refined[1]).toBe(false);
    // Corner 0 lies on the left edge (corner 3 → corner 0); distance from that true line:
    const distanceToLine = (p: Point2, a: Point2, b: Point2) =>
      Math.abs((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) / Math.hypot(b[0] - a[0], b[1] - a[1]);
    expect(distanceToLine(taps[0]!, truth[3]!, truth[0]!)).toBeGreaterThan(2);
    expect(distanceToLine(result.corners[0]!, truth[3]!, truth[0]!)).toBeLessThan(0.5);
    expect(distanceToLine(result.corners[1]!, truth[1]!, truth[2]!)).toBeLessThan(0.5);
  });

  it("keeps the taps when there is no edge to find", () => {
    const flat: GrayImage = { data: new Float32Array(640 * 480).fill(0.5), width: 640, height: 480 };
    const taps: Point2[] = [
      [180, 380],
      [470, 360],
      [430, 170],
      [220, 180],
    ];
    const result = refineCorners(flat, taps);
    expect(result.refined).toEqual([false, false, false, false]);
    expect(result.corners).toEqual(taps);
  });

  it("keeps a tap that is too far from any edge intersection", () => {
    const random = seededRandom(57);
    const truth: Point2[] = [
      [180, 380],
      [470, 360],
      [430, 170],
      [220, 180],
    ];
    const image = renderSheet(truth, 640, 480, random);
    const taps = truth.map((p) => [p[0], p[1]] as Point2);
    taps[2] = [460, 150]; // 36 px off: the sides next to it are searched in the wrong place
    const result = refineCorners(image, taps, { searchRadius: 10 });
    expect(result.refined[0]).toBe(true);
    expect(result.corners[2]).toEqual(taps[2]);
  });
});
