/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Tests for the AR Mirror's geometry: the head's pose from landmarks, smoothing, the irises' scale, anchors, occlusion, the swinging earring, light and pieces.
 */

import { describe, expect, it } from "vitest";

import type { Point2 } from "@/lib/vision/camera";
import { mulMat3, rotationDistanceDegrees, rotationFromEuler, scale3, add3, type Vec3 } from "@/lib/vision/linalg";
import { accelerationOf, ANCHORS_MM, earTurnedAway, hangingCard, hatCard, hiddenBehindFace, HEAD_WIDTH_MM, neckPoint, Pendulum, projectCard } from "@/lib/vision/mirror/anchors";
import { CANONICAL_FACE_MM, FACE_OUTLINE, IRISES, LANDMARK, RIGHT_EYE_OUTLINE, RIGID_LANDMARKS } from "@/lib/vision/mirror/face-model";
import { faceScale, IRIS_DIAMETER_MM, IRIS_RIM_CALIBRATION, irisDiameterPx } from "@/lib/vision/mirror/iris";
import { faceLight, insidePolygon, pieceGains, scleraPixels } from "@/lib/vision/mirror/light";
import { earringHeightMm, earringStyle, hatWidthFactor, oneEarring, titleMillimetres } from "@/lib/vision/mirror/pieces";
import { FRONTAL, frameIntrinsics, headAngles, project, refinePose, solveHeadPose, weakPerspectivePose, type HeadPose } from "@/lib/vision/mirror/pose";
import { matrixFromQuaternion, OneEuroFilter, PoseSmoother, quaternionFromMatrix } from "@/lib/vision/mirror/smoothing";
import { affineFromTriangles, inflateTriangle, warpTriangles } from "@/lib/vision/mirror/warp";

const K = frameIntrinsics(1280, 720);
const radians = (degrees: number) => (degrees * Math.PI) / 180;
/** A head turned by yaw, pitch and roll (degrees) at t millimetres from the camera. */
const headAt = (yaw: number, pitch: number, roll: number, t: Vec3): HeadPose => ({ R: mulMat3(rotationFromEuler(radians(yaw), radians(pitch), radians(roll)), FRONTAL), t });
const rigidModel = RIGID_LANDMARKS.map((index) => CANONICAL_FACE_MM[index]!);
const imageOf = (pose: HeadPose, model: readonly Vec3[]) => model.map((X) => project(K, pose, X)!);

/** A repeatable normal noise (Box–Muller over a small linear-congruential generator). */
function noise(seed: number) {
  let state = seed;
  const uniform = () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return (state + 0.5) / 4294967296;
  };
  return () => Math.sqrt(-2 * Math.log(uniform())) * Math.cos(2 * Math.PI * uniform());
}

describe("the head's pose from landmarks (docs/adr/065)", () => {
  const truth = headAt(25, -10, 8, [20, -15, 600]);

  it("reads the same yaw, pitch and roll it was built from", () => {
    for (const [yaw, pitch, roll] of [
      [0, 0, 0],
      [30, -15, 10],
      [-60, 20, -25],
    ] as const) {
      const angles = headAngles(headAt(yaw, pitch, roll, [0, 0, 500]).R);
      expect(angles.yaw).toBeCloseTo(yaw, 9);
      expect(angles.pitch).toBeCloseTo(pitch, 9);
      expect(angles.roll).toBeCloseTo(roll, 9);
    }
  });

  it("starts close with weak perspective, and refines to the exact pose from exact points", () => {
    const image = imageOf(truth, rigidModel);
    const start = weakPerspectivePose(image, rigidModel, K)!;
    expect(rotationDistanceDegrees(start.R, truth.R)).toBeLessThan(6);
    const solved = refinePose(image, rigidModel, K, start);
    expect(rotationDistanceDegrees(solved.R, truth.R)).toBeLessThan(1e-6);
    for (let i = 0; i < 3; i += 1) expect(solved.t[i]!).toBeCloseTo(truth.t[i]!, 5);
    expect(solved.rmsPx).toBeLessThan(1e-6);
  });

  it("stays within two degrees with a pixel of noise on every landmark", () => {
    const next = noise(7);
    const image = imageOf(truth, rigidModel).map(([u, v]) => [u + next(), v + next()] as Point2);
    const solved = solveHeadPose(image, rigidModel, K)!;
    expect(rotationDistanceDegrees(solved.R, truth.R)).toBeLessThan(2);
  });

  it("is pulled less by a few badly placed landmarks when weighted robustly", () => {
    const image = imageOf(truth, rigidModel);
    for (const index of [0, 5, 11]) image[index] = [image[index]![0] + 45, image[index]![1] - 30];
    const start = weakPerspectivePose(image, rigidModel, K)!;
    const robust = refinePose(image, rigidModel, K, start, { robust: true });
    const plain = refinePose(image, rigidModel, K, start, { robust: false });
    expect(rotationDistanceDegrees(robust.R, truth.R)).toBeLessThan(rotationDistanceDegrees(plain.R, truth.R));
  });

  it("tracks from the last frame's pose, and recovers when the face jumps", () => {
    const image = imageOf(truth, rigidModel);
    const near = solveHeadPose(image, rigidModel, K, headAt(22, -8, 6, [15, -10, 610]))!;
    expect(rotationDistanceDegrees(near.R, truth.R)).toBeLessThan(1e-4);
    const far = solveHeadPose(image, rigidModel, K, headAt(-70, 40, -40, [200, 200, 300]))!;
    expect(rotationDistanceDegrees(far.R, truth.R)).toBeLessThan(1e-4);
  });
});

describe("smoothing", () => {
  it("steadies a still signal and keeps up with a moving one", () => {
    const next = noise(3);
    // β is in the signal's own units: small enough that noise's jitter barely raises the cut-off, large enough that a real movement does.
    const filter = new OneEuroFilter({ minCutoff: 0.5, beta: 0.05 });
    const out: number[] = [];
    for (let k = 0; k < 300; k += 1) out.push(filter.filter(10 + next(), k / 30));
    const tail = out.slice(100);
    const mean = tail.reduce((sum, value) => sum + value, 0) / tail.length;
    const sd = Math.sqrt(tail.reduce((sum, value) => sum + (value - mean) ** 2, 0) / tail.length);
    expect(Math.abs(mean - 10)).toBeLessThan(0.3);
    expect(sd).toBeLessThan(0.4);
    // On a ramp of 60 units a second, the speed term keeps the lag far below a plain low-pass filter's.
    const fast = new OneEuroFilter({ minCutoff: 0.5, beta: 0.05 });
    const plain = new OneEuroFilter({ minCutoff: 0.5, beta: 0 });
    let lagFast = 0;
    let lagPlain = 0;
    for (let k = 0; k < 90; k += 1) {
      const value = 2 * k;
      lagFast = value - fast.filter(value, k / 30);
      lagPlain = value - plain.filter(value, k / 30);
    }
    expect(lagFast).toBeLessThan(lagPlain / 4);
  });

  it("turns matrices into quaternions and back, and never averages a rotation with its own negative", () => {
    const R = headAt(40, -20, 15, [0, 0, 500]).R;
    expect(rotationDistanceDegrees(matrixFromQuaternion(quaternionFromMatrix(R)), R)).toBeLessThan(1e-4);
    const smoother = new PoseSmoother();
    const pose = headAt(179, 0, 0, [0, 0, 500]);
    smoother.smooth(pose, 0);
    // The same rotation again: a quaternion sign flip must not move the smoothed pose.
    const again = smoother.smooth(headAt(-179.9, 0, 0, [0, 0, 500]), 1 / 30);
    expect(rotationDistanceDegrees(again.R, pose.R)).toBeLessThan(1);
  });
});

/** A synthetic picture's landmarks: the face's points and two irises 11.7 mm across as MediaPipe's rim marks them, the face `size` times the average. */
function landmarksFor(pose: HeadPose, size: number): Point2[] {
  const points: Point2[] = CANONICAL_FACE_MM.map((X) => project(K, pose, scale3(X, size))!);
  for (const [index, iris] of IRISES.entries()) {
    const [outer, inner] = index === 0 ? [LANDMARK.rightEyeOuter, LANDMARK.rightEyeInner] : [LANDMARK.leftEyeOuter, LANDMARK.leftEyeInner];
    const centre = scale3(add3(CANONICAL_FACE_MM[outer]!, CANONICAL_FACE_MM[inner]!), size / 2);
    const r = IRIS_DIAMETER_MM / IRIS_RIM_CALIBRATION / 2;
    const rim: Vec3[] = [
      add3(centre, [r, 0, 0]),
      add3(centre, [0, r, 0]),
      add3(centre, [-r, 0, 0]),
      add3(centre, [0, -r, 0]),
    ];
    points[iris.centre] = project(K, pose, centre)!;
    iris.rim.forEach((landmark, k) => (points[landmark] = project(K, pose, rim[k]!)!));
  }
  return points;
}

describe("the face's own size from its irises", () => {
  it("measures an iris by its longer diameter and finds an average face average, a large one large", () => {
    const pose = headAt(0, 0, 0, [0, 0, 550]);
    const average = landmarksFor(pose, 1);
    expect(irisDiameterPx(average, IRISES[0]!)).toBeCloseTo((K.f * IRIS_DIAMETER_MM) / IRIS_RIM_CALIBRATION / 550, -1);
    const solvedAverage = solveHeadPose(RIGID_LANDMARKS.map((index) => average[index]!), rigidModel, K)!;
    expect(faceScale(average, K, solvedAverage)).toBeCloseTo(1, 1);
    // A face 10% larger than average looks like an average face nearer the camera; its irises are not larger, so they tell.
    const large = landmarksFor(pose, 1.1);
    const solvedLarge = solveHeadPose(RIGID_LANDMARKS.map((index) => large[index]!), rigidModel, K)!;
    expect(faceScale(large, K, solvedLarge)).toBeCloseTo(1.1, 1);
  });
});

describe("anchors, occlusion and the swinging earring", () => {
  it("sees both earlobes from the front, and loses the far one behind the face when the head turns", () => {
    const visible = (yaw: number) => {
      const pose = headAt(yaw, 0, 0, [0, 0, 600]);
      const outline = FACE_OUTLINE.map((index) => project(K, pose, CANONICAL_FACE_MM[index]!)!);
      return (["right", "left"] as const).map((side) => !hiddenBehindFace(project(K, pose, side === "right" ? ANCHORS_MM.rightEarlobe : ANCHORS_MM.leftEarlobe)!, outline, earTurnedAway(pose, side)));
    };
    expect(visible(0)).toEqual([true, true]);
    expect(visible(10)).toEqual([true, true]);
    // A face turned towards the picture's left (positive yaw) turns its right ear away.
    expect(visible(50)).toEqual([false, true]);
    expect(visible(-50)).toEqual([true, false]);
  });

  it("puts a hat above the eyes and a necklace below the chin, on screen", () => {
    const pose = headAt(0, 0, 0, [0, 0, 600]);
    const hat = projectCard(K, hatCard(pose, HEAD_WIDTH_MM * 1.2, 90))!;
    const eyeY = project(K, pose, CANONICAL_FACE_MM[LANDMARK.rightEyeOuter]!)![1];
    expect(hat[2][1]).toBeLessThan(eyeY);
    expect(hat[1][0] - hat[0][0]).toBeGreaterThan(0);
    const chinY = project(K, pose, CANONICAL_FACE_MM[LANDMARK.chin]!)![1];
    const neck = neckPoint(pose);
    expect(K.cy + (K.f * neck[1]) / neck[2]).toBeGreaterThan(chinY);
    const card = hangingCard([0, 0, 600], 20, 40, 0);
    expect(card[3][1] - card[0][1]).toBe(40);
  });

  it("swings with the period of a pendulum, and lags when the ear is jerked sideways", () => {
    const length = 0.02;
    const free = new Pendulum(length, 0);
    free.angle = 0.1;
    let crossings = 0;
    let previous = free.angle;
    const dt = 1 / 1000;
    let time = 0;
    let firstCrossing = 0;
    while (crossings < 3) {
      const angle = free.step(dt, 0, 0);
      time += dt;
      if (Math.sign(angle) !== Math.sign(previous)) {
        crossings += 1;
        if (crossings === 1) firstCrossing = time;
      }
      previous = angle;
    }
    // Two half periods between the first and third crossings: T = 2π√(ℓ/g).
    expect(time - firstCrossing).toBeCloseTo(2 * Math.PI * Math.sqrt(length / 9.81), 2);
    const jerked = new Pendulum(length);
    jerked.step(0.05, 8, 0);
    expect(jerked.angle).toBeLessThan(0);
    expect(accelerationOf([[0, 0, 600], [1, 0, 600], [4, 0, 600]], 0.1, 0.1)).toEqual([0.2, 0]);
  });
});

describe("light and pieces", () => {
  it("reads the light's tint from the whites of the eyes", () => {
    const width = 40;
    const height = 20;
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i += 1) rgba.set([200, 205, 240, 255], i * 4);
    const eye: Point2[] = [[2, 2], [38, 2], [38, 18], [2, 18]];
    expect(insidePolygon([20, 10], eye)).toBe(true);
    expect(insidePolygon([39, 19], eye)).toBe(false);
    const light = faceLight(scleraPixels(rgba, width, height, eye, { centre: [20, 10], radius: 4 }))!;
    expect(light.tint[2]).toBeGreaterThan(light.tint[0]);
    expect(pieceGains(null)).toEqual([1, 1, 1]);
    expect(RIGHT_EYE_OUTLINE.length).toBe(16);
  });

  it("reads an earring's size and kind from its title, and a hat's width from its kind", () => {
    expect(earringHeightMm("Sterling Silver 10mm Polished Ball Studs")).toEqual({ mm: 10, from: "title", style: "stud" });
    expect(earringHeightMm("Stainless Steel Flattened Hoop Earrings")).toEqual({ mm: 40, from: "typical", style: "hoop" });
    expect(earringStyle("Sterling Silver Angel Wing Drop Earrings")).toBe("drop");
    expect(titleMillimetres('Open Loop Cross Pendant Necklace 18"')[0]).toBeCloseTo(457.2, 6);
    expect(hatWidthFactor("UV Protection Men's Wide Brim Sun Hat")).toBeGreaterThan(hatWidthFactor("Beanie Hat"));
  });

  it("keeps one earring from a photograph of a pair", () => {
    const width = 20;
    const height = 10;
    const alpha = new Uint8ClampedArray(width * height);
    const fill = (x0: number, x1: number, y0: number, y1: number) => {
      for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) alpha[y * width + x] = 255;
    };
    fill(1, 6, 1, 8); // the larger one
    fill(12, 16, 2, 7);
    expect(oneEarring(alpha, width, height)).toEqual({ x: 1, y: 1, width: 6, height: 8 });
  });
});

describe("drawing a photograph onto four corners", () => {
  it("maps each triangle exactly with its affine transform", () => {
    const from: [Point2, Point2, Point2] = [[0, 0], [10, 0], [0, 10]];
    const to: [Point2, Point2, Point2] = [[5, 5], [25, 8], [3, 30]];
    const [a, b, c, d, e, f] = affineFromTriangles(from, to)!;
    for (let k = 0; k < 3; k += 1) {
      const [x, y] = from[k]!;
      expect(a * x + c * y + e).toBeCloseTo(to[k]![0], 9);
      expect(b * x + d * y + f).toBeCloseTo(to[k]![1], 9);
    }
    expect(affineFromTriangles([[0, 0], [1, 1], [2, 2]], to)).toBeNull();
  });

  it("covers a perspective quadrilateral with triangles whose corners lie on the homography", () => {
    const quad: [Point2, Point2, Point2, Point2] = [[100, 100], [300, 120], [290, 400], [110, 380]];
    const triangles = warpTriangles(200, 300, quad, 4)!;
    expect(triangles).toHaveLength(32);
    // The photograph's corners land on the quadrilateral's.
    const corners = triangles.flatMap((triangle) => triangle.from.map((point, k) => [point, triangle.to[k]!] as const));
    const at = (x: number, y: number) => corners.find(([point]) => point[0] === x && point[1] === y)![1];
    expect(at(0, 0)[0]).toBeCloseTo(100, 6);
    expect(at(200, 0)[1]).toBeCloseTo(120, 6);
    expect(at(200, 300)[0]).toBeCloseTo(290, 6);
    expect(at(0, 300)[1]).toBeCloseTo(380, 6);
    const inflated = inflateTriangle([[0, 0], [10, 0], [0, 10]], 1);
    expect(inflated[0][0]).toBeLessThan(0);
  });
});
