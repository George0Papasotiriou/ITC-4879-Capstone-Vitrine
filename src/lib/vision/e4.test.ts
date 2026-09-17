/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Tests the real-photo E4 measurement: size error from marks, and the summary over a set of rooms.
 */

import { describe, expect, it } from "vitest";

import { seededRandom } from "@/lib/reco/simulate";
import { focalFromFov, intrinsics, projectPoint, solveSheet, type Point2 } from "@/lib/vision/camera";
import { compareMethods, markedHeightPx, measureWithPose, summariseE4, type E4Marks, type E4Record } from "@/lib/vision/e4";
import { lookAtPose, randomScene, withTapNoise } from "@/lib/vision/synthetic";

const WIDTH = 1600;
const HEIGHT = 1200;
const K = intrinsics(focalFromFov(69, WIDTH), WIDTH, HEIGHT);

/** A box of known height standing on the floor, marked as George would mark it. */
function marks(pose: ReturnType<typeof lookAtPose>, sheet: Point2[], spot: Point2, heightCm: number): E4Marks {
  const base = projectPoint(K, pose, [spot[0], spot[1], 0])!;
  const top = projectPoint(K, pose, [spot[0], spot[1], heightCm / 100])!;
  return { sheet: sheet.map((p) => projectPoint(K, pose, [p[0], p[1], 0])!), base, top, objectHeightCm: heightCm };
}

describe("measureWithPose", () => {
  const pose = lookAtPose([0.1, -1.5, 1.4], [0, 0.6, 0]);
  const sheet: Point2[] = [
    [-0.15, -0.1],
    [0.15, -0.1],
    [0.15, 0.1],
    [-0.15, 0.1],
  ];

  it("reports no error when the camera is the one that took the photo", () => {
    const marked = marks(pose, sheet, [0.2, 0.9], 40);
    const result = measureWithPose(K, pose, marked, 1.4)!;
    expect(result.sizeError).toBeLessThan(1e-9);
    expect(result.measuredPx).toBeCloseTo(markedHeightPx(marked), 9);
    expect(result.cameraHeight).toBe(1.4);
  });

  it("reports the error a wrong camera would draw", () => {
    const marked = marks(pose, sheet, [0.2, 0.9], 40);
    // A camera believed to be 20% higher than it was draws everything smaller.
    const wrong = lookAtPose([0.1, -1.5, 1.4 * 1.2], [0, 0.6, 0]);
    const result = measureWithPose(K, wrong, marked, 1.68)!;
    expect(result.sizeError).toBeGreaterThan(0.05);
    expect(result.sizeError).toBeLessThan(0.35);
  });

  it("returns nothing when the marks cannot be explained", () => {
    const marked = marks(pose, sheet, [0.2, 0.9], 40);
    // A level camera sees the horizon inside the frame: a foot marked above it is on no floor.
    const level = lookAtPose([0, -2, 1.4], [0, 2, 1.4]);
    expect(measureWithPose(K, level, { ...marked, base: [WIDTH / 2, 10] }, 1.4)).toBeNull();
    // Just below the horizon the floor runs away to nothing; that is not a measurement either.
    expect(measureWithPose(K, level, { ...marked, base: [WIDTH / 2, HEIGHT / 2 + 4] }, 1.4)).toBeNull();
    // And a foot marked on top of the top is no height at all.
    expect(measureWithPose(K, pose, { ...marked, top: marked.base }, 1.4)).toBeNull();
  });

  it("measures the sheet method end to end, from taps to size error", () => {
    const random = seededRandom(3);
    const scene = randomScene(random);
    const spot: Point2 = [scene.world[0]![0] + 0.4, scene.world[0]![1] + 0.3];
    const base = projectPoint(scene.K, scene.pose, [spot[0], spot[1], 0]);
    const top = projectPoint(scene.K, scene.pose, [spot[0], spot[1], 0.4]);
    if (base === null || top === null) throw new Error("scene puts the object out of view");

    // Taps land a pixel or two off, as a finger does.
    const solution = solveSheet(scene.K, withTapNoise(scene.image, 1, random))!;
    const result = measureWithPose(scene.K, solution.pose, { sheet: scene.image, base, top, objectHeightCm: 40 }, 1.4)!;
    expect(result).not.toBeNull();
    // The synthetic evaluation puts this method around 1–2% at one pixel of tap noise.
    expect(result.sizeError).toBeLessThan(0.05);
  });
});

describe("summarising a set of rooms", () => {
  const record = (file: string, paperError: number | null, depthError: number | null): E4Record => ({
    file,
    width: WIDTH,
    height: HEIGHT,
    focalFrom: "exif",
    objectHeightCm: 40,
    paper: paperError === null ? null : { predictedPx: 100 * (1 + paperError), measuredPx: 100, sizeError: paperError, cameraHeight: 1.4, distance: 2 },
    depth: depthError === null ? null : { predictedPx: 100 * (1 + depthError), measuredPx: 100, sizeError: depthError, cameraHeight: 1.45, distance: 2, floorShare: 0.6, planeRmsRelative: 0.02, metric: true },
    measuredAt: "2026-09-18T10:00:00.000Z",
  });

  const records = [record("a.jpg", 0.02, 0.06), record("b.jpg", 0.04, 0.2), record("c.jpg", 0.12, null), record("d.jpg", null, 0.08)];

  it("counts what each method managed and how wrong it was", () => {
    const paper = summariseE4(records, "paper");
    expect(paper.count).toBe(3);
    expect(paper.failed).toBe(1);
    expect(paper.mape).toBeCloseTo(0.06, 9);
    expect(paper.within10).toBeCloseTo(2 / 3, 9);
    expect(paper.meanCameraHeight).toBeCloseTo(1.4, 9);

    const depth = summariseE4(records, "depth");
    expect(depth.count).toBe(3);
    expect(depth.p50).toBeCloseTo(0.08, 9);
  });

  it("compares the two methods only on the rooms where both answered", () => {
    const { both } = compareMethods(records);
    expect(both.count).toBe(2);
    expect(both.paperMape).toBeCloseTo(0.03, 9);
    expect(both.depthMape).toBeCloseTo(0.13, 9);
    expect(both.depthWorseBy).toBeCloseTo(0.1, 9);
  });

  it("says nothing rather than something wrong when there are no measurements yet", () => {
    const empty = summariseE4([], "paper");
    expect(empty.count).toBe(0);
    expect(Number.isNaN(empty.mape)).toBe(true);
    expect(Number.isNaN(empty.within10)).toBe(true);
  });
});
