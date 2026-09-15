/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Unit tests for the camera model, homography, pose recovery and RANSAC.
 */

import { describe, expect, it } from "vitest";

import { seededRandom } from "@/lib/reco/simulate";
import {
  A4_SHEET,
  applyHomography,
  backProject,
  boxCorners,
  cameraCentre,
  fitPlaneRansac,
  floorPointAt,
  focalFrom35mm,
  focalFromFov,
  homographyDLT,
  intrinsics,
  normalisingTransform,
  orderTaps,
  refinePose,
  sheetWorld,
  solveSheet,
  poseFromHomography,
  projectedHeight,
  projectPoint,
  reprojectionError,
  upSign,
  verticalFovDegrees,
  type Point2,
} from "@/lib/vision/camera";
import { dot3, mulMat3, mulMat3Vec, norm3, rotationDistanceDegrees, rotationFromVector, sub3, type Vec3 } from "@/lib/vision/linalg";
import { gaussian, lookAtPose, measureSizeError, randomScene, withTapNoise } from "@/lib/vision/synthetic";

describe("intrinsics", () => {
  it("converts a 35 mm-equivalent focal length to pixels", () => {
    // A 26 mm-equivalent phone main camera, 4032 × 3024 photo: 26 / 36 · 4032.
    expect(focalFrom35mm(26, 4032, 3024)).toBeCloseTo(2912, 6);
    // Portrait photos use the longer side too.
    expect(focalFrom35mm(26, 3024, 4032)).toBeCloseTo(2912, 6);
  });

  it("agrees with the field of view it implies", () => {
    // A 36 mm-wide frame at f35 sees 2·atan(18 / f35) horizontally.
    const f35 = 26;
    const fov = (2 * Math.atan(18 / f35) * 180) / Math.PI;
    expect(focalFromFov(fov, 4032)).toBeCloseTo(focalFrom35mm(f35, 4032, 3024), 6);
  });

  it("puts the principal point at the centre and gives the matching vertical field of view", () => {
    const K = intrinsics(1000, 1600, 1200);
    expect(K).toEqual([1000, 0, 800, 0, 1000, 600, 0, 0, 1]);
    expect(verticalFovDegrees(1000, 1200)).toBeCloseTo((2 * Math.atan(0.6) * 180) / Math.PI, 10);
  });

  it("rejects impossible inputs", () => {
    expect(() => focalFrom35mm(0, 100, 100)).toThrow(RangeError);
    expect(() => focalFromFov(180, 100)).toThrow(RangeError);
  });
});

describe("homography by normalised DLT", () => {
  const random = seededRandom(11);

  it("normalises points to centroid 0 and mean distance √2", () => {
    const points: Point2[] = [
      [100, 200],
      [1500, 250],
      [1400, 1100],
      [180, 900],
    ];
    const T = normalisingTransform(points);
    const mapped = points.map((p) => applyHomography(T, p));
    const cx = mapped.reduce((sum, p) => sum + p[0], 0) / 4;
    const cy = mapped.reduce((sum, p) => sum + p[1], 0) / 4;
    const mean = mapped.reduce((sum, p) => sum + Math.hypot(p[0], p[1]), 0) / 4;
    expect(cx).toBeCloseTo(0, 12);
    expect(cy).toBeCloseTo(0, 12);
    expect(mean).toBeCloseTo(Math.SQRT2, 12);
  });

  it("recovers a random homography exactly from four points", () => {
    for (let trial = 0; trial < 100; trial += 1) {
      const scene = randomScene(random);
      const H = homographyDLT(scene.world, scene.image);
      expect(reprojectionError(H, scene.world, scene.image)).toBeLessThan(1e-6);
      // And maps points it was not fitted on: the sheet's centre.
      const centre: Point2 = [
        scene.world.reduce((sum, p) => sum + p[0], 0) / 4,
        scene.world.reduce((sum, p) => sum + p[1], 0) / 4,
      ];
      const truth = projectPoint(scene.K, scene.pose, [centre[0], centre[1], 0])!;
      const mapped = applyHomography(H, centre);
      expect(Math.hypot(mapped[0] - truth[0], mapped[1] - truth[1])).toBeLessThan(1e-6);
    }
  });

  it("rejects fewer than four points and collinear corners", () => {
    expect(() => homographyDLT([[0, 0], [1, 0], [1, 1]], [[0, 0], [1, 0], [1, 1]])).toThrow(RangeError);
    const collinear: Point2[] = [
      [0, 0],
      [1, 0],
      [2, 0],
      [0, 1],
    ];
    expect(() => homographyDLT(collinear, collinear)).toThrow(RangeError);
  });

  it("is better conditioned than the unnormalised DLT under tap noise", () => {
    // A least-squares fit to 12 noisy points spread over a 1.2 m floor patch,
    // measured on the true (noise-free) pixels. Hartley's normalisation should
    // never be worse on average, and usually clearly better.
    const local = seededRandom(5);
    let normalised = 0;
    let raw = 0;
    const trials = 200;
    for (let trial = 0; trial < trials; trial += 1) {
      const scene = randomScene(local);
      const world: Point2[] = Array.from({ length: 12 }, () => [
        scene.world[0]![0] + (local() - 0.5) * 1.2,
        scene.world[0]![1] + (local() - 0.5) * 1.2,
      ]);
      const pixels = world.map((p) => projectPoint(scene.K, scene.pose, [p[0], p[1], 0]));
      if (pixels.some((p) => p === null)) continue;
      const truth = pixels as Point2[];
      const noisy = withTapNoise(truth, 2, local);
      normalised += reprojectionError(homographyDLT(world, noisy), world, truth);
      raw += reprojectionError(homographyDLT(world, noisy, { normalise: false }), world, truth);
    }
    expect(normalised).toBeLessThan(raw);
  });
});

describe("camera pose from the floor homography", () => {
  it("recovers a known camera exactly from exact taps", () => {
    const random = seededRandom(3);
    for (let trial = 0; trial < 200; trial += 1) {
      const scene = randomScene(random);
      const pose = poseFromHomography(scene.K, homographyDLT(scene.world, scene.image));
      expect(rotationDistanceDegrees(pose.R, scene.pose.R)).toBeLessThan(1e-5);
      expect(norm3(sub3(pose.t, scene.pose.t))).toBeLessThan(1e-7);
      // The camera height above the floor is metric, from the sheet's known size.
      expect(cameraCentre(pose)[2]).toBeCloseTo(cameraCentre(scene.pose)[2], 7);
    }
  });

  it("recovers a hand-built camera: 1.5 m up, looking down 40° at a sheet 2 m ahead", () => {
    const K = intrinsics(focalFromFov(65, 1600), 1600, 1200);
    const truth = lookAtPose([0, -2, 1.5], [0, 0, 0]);
    const world: Point2[] = [
      [0, 0],
      [0.297, 0],
      [0.297, 0.21],
      [0, 0.21],
    ];
    const image = world.map((p) => projectPoint(K, truth, [p[0], p[1], 0])!);
    const pose = poseFromHomography(K, homographyDLT(world, image));
    const centre = cameraCentre(pose);
    expect(centre[0]).toBeCloseTo(0, 6);
    expect(centre[1]).toBeCloseTo(-2, 6);
    expect(centre[2]).toBeCloseTo(1.5, 6);
    // The camera's viewing axis (third row of R) points 36.9° below the horizon: atan(1.5 / 2).
    const forward: Vec3 = [pose.R[6], pose.R[7], pose.R[8]];
    expect((Math.asin(-forward[2]) * 180) / Math.PI).toBeCloseTo((Math.atan(1.5 / 2) * 180) / Math.PI, 6);
  });

  it("returns a proper rotation and a camera in front of the sheet even with noisy taps", () => {
    const random = seededRandom(21);
    for (let trial = 0; trial < 200; trial += 1) {
      const scene = randomScene(random);
      const taps = withTapNoise(scene.image, 3, random);
      const pose = poseFromHomography(scene.K, homographyDLT(scene.world, taps));
      const rtr = [0, 1, 2].map((i) => [0, 1, 2].map((j) => pose.R[i]! * pose.R[j]! + pose.R[i + 3]! * pose.R[j + 3]! + pose.R[i + 6]! * pose.R[j + 6]!));
      rtr.forEach((row, i) => row.forEach((value, j) => expect(value).toBeCloseTo(i === j ? 1 : 0, 9)));
      expect(pose.t[2]).toBeGreaterThan(0);
    }
  });
});

describe("placing a product with the recovered pose", () => {
  it("finds the floor point under a pixel: the inverse of projection", () => {
    const random = seededRandom(9);
    for (let trial = 0; trial < 100; trial += 1) {
      const scene = randomScene(random);
      const X: Point2 = [scene.world[0]![0] + (random() - 0.5), scene.world[0]![1] + (random() - 0.5)];
      const pixel = projectPoint(scene.K, scene.pose, [X[0], X[1], 0]);
      if (pixel === null) continue;
      const back = floorPointAt(scene.K, scene.pose, pixel)!;
      expect(back[0]).toBeCloseTo(X[0], 8);
      expect(back[1]).toBeCloseTo(X[1], 8);
    }
  });

  it("returns no floor point above the horizon", () => {
    const K = intrinsics(1000, 1600, 1200);
    const pose = lookAtPose([0, -2, 1.2], [0, 10, 1.2]); // looking straight ahead, horizon at mid-height
    expect(floorPointAt(K, pose, [800, 100])).toBeNull();
    expect(floorPointAt(K, pose, [800, 1100])).not.toBeNull();
  });

  it("builds a box that stands up towards the camera", () => {
    const pose = lookAtPose([0, -2, 1.5], [0, 0, 0]);
    const corners = boxCorners({ x: 0, y: 0, rotation: Math.PI / 2, width: 0.8, depth: 0.4, height: 0.5 }, upSign(pose));
    expect(corners).toHaveLength(8);
    // Rotated 90°: the 0.8 m width now runs along Y.
    const ys = corners.slice(0, 4).map((p) => p[1]);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(0.8, 12);
    corners.slice(4).forEach((p) => expect(p[2]).toBeCloseTo(0.5, 12));
  });

  it("handles taps assigned in the mirrored order: up flips, heights stay right", () => {
    const K = intrinsics(focalFromFov(65, 1600), 1600, 1200);
    const truth = lookAtPose([0.3, -2.2, 1.4], [0, 0, 0], 0.05);
    const world: Point2[] = [
      [0, 0],
      [0.297, 0],
      [0.297, 0.21],
      [0, 0.21],
    ];
    const image = world.map((p) => projectPoint(K, truth, [p[0], p[1], 0])!);
    // The same pixels, but the world corners labelled as a mirror image (x and y swapped).
    const mirrored = world.map((p) => [p[1], p[0]] as Point2);
    const pose = poseFromHomography(K, homographyDLT(mirrored, image));
    expect(upSign(pose)).toBe(-1);
    const pixel = projectPoint(K, truth, [0.5, 0.6, 0])!;
    const spot = floorPointAt(K, pose, pixel)!;
    expect(projectedHeight(K, pose, spot[0], spot[1], 0.4)).toBeCloseTo(projectedHeight(K, truth, 0.5, 0.6, 0.4)!, 6);
  });
});

describe("tap order and the sheet's orientation", () => {
  it("orders four taps counter-clockwise from the lowest one", () => {
    const image = orderTaps([
      [397, 90],
      [100, 300],
      [100, 90],
      [397, 300],
    ]);
    // On screen y points down, so counter-clockwise from the bottom-left corner runs right, up, left.
    expect(image).toEqual([
      [100, 300],
      [397, 300],
      [397, 90],
      [100, 90],
    ]);
  });

  it("rejects a bow-tie of taps and needs exactly four", () => {
    // Three corners of a square and a point inside: not convex.
    expect(
      orderTaps([
        [0, 0],
        [100, 0],
        [0, 100],
        [30, 30],
      ]),
    ).toBeNull();
    expect(() => orderTaps([[0, 0]])).toThrow(RangeError);
  });

  it("builds the sheet with either side first", () => {
    expect(sheetWorld(A4_SHEET, true)[1]).toEqual([0.297, 0]);
    expect(sheetWorld(A4_SHEET, false)[1]).toEqual([0.21, 0]);
  });

  it("gives the same placement for the four taps in any order", () => {
    const random = seededRandom(13);
    const permutations = [
      [0, 1, 2, 3],
      [2, 0, 3, 1],
      [3, 2, 1, 0],
      [1, 3, 0, 2],
    ];
    for (let trial = 0; trial < 50; trial += 1) {
      const scene = randomScene(random);
      const spot: Point2 = [scene.world[0]![0] + 0.5, scene.world[0]![1] + 0.3];
      const pixel = projectPoint(scene.K, scene.pose, [spot[0], spot[1], 0]);
      if (pixel === null) continue;
      const truthHeight = projectedHeight(scene.K, scene.pose, spot[0], spot[1], 0.45)!;
      for (const order of permutations) {
        const solution = solveSheet(scene.K, order.map((i) => scene.image[i]!))!;
        expect(solution.rms).toBeLessThan(1e-4);
        const placed = floorPointAt(scene.K, solution.pose, pixel)!;
        expect(projectedHeight(scene.K, solution.pose, placed[0], placed[1], 0.45)).toBeCloseTo(truthHeight, 4);
      }
    }
  });

  it("tells the 297 mm sides from the 210 mm sides even when perspective makes them look shorter", () => {
    // Low camera, sheet's long side pointing away: on screen the long edges are the short ones.
    const K = intrinsics(focalFromFov(69, 1600), 1600, 1200);
    const truth = lookAtPose([0, -1.6, 0.5], [0, 0, 0]);
    const world = sheetWorld(A4_SHEET, false).map(([x, y]) => [x - 0.105, y - 0.1485] as Point2);
    const image = world.map((p) => projectPoint(K, truth, [p[0], p[1], 0])!);
    const edge = (i: number) => Math.hypot(image[(i + 1) % 4]![0] - image[i]![0], image[(i + 1) % 4]![1] - image[i]![1]);
    expect(edge(1)).toBeLessThan(edge(0)); // the 297 mm edge looks shorter than the 210 mm edge

    const solution = solveSheet(K, image)!;
    const sides = [0, 1].map((i) => Math.hypot(solution.world[i + 1]![0] - solution.world[i]![0], solution.world[i + 1]![1] - solution.world[i]![1]));
    const [first] = solution.image;
    const firstIndex = image.findIndex((p) => p[0] === first![0] && p[1] === first![1]);
    // Whichever corner came first, the edge of true length 297 mm must be labelled 297 mm.
    const trueFirstEdge = firstIndex % 2 === 0 ? 0.21 : 0.297;
    expect(sides[0]).toBeCloseTo(trueFirstEdge, 12);
    expect(cameraCentre(solution.pose)[2]).toBeCloseTo(0.5, 6);
  });
});

describe("ambiguous sheets", () => {
  it("is never ambiguous with exact taps, and offers the other labelling", () => {
    const random = seededRandom(61);
    for (let trial = 0; trial < 50; trial += 1) {
      const scene = randomScene(random);
      const solution = solveSheet(scene.K, scene.image)!;
      expect(solution.ambiguous).toBe(false);
      expect(solution.alternative).not.toBeNull();
      expect(solution.alternative!.rms).toBeGreaterThan(solution.rms);
    }
  });

  it("flags small, distant sheets far more often than near ones under the same noise", () => {
    const random = seededRandom(67);
    const share = (distance: [number, number]) => {
      let flagged = 0;
      for (let trial = 0; trial < 150; trial += 1) {
        const scene = randomScene(random, { distance });
        if (solveSheet(scene.K, withTapNoise(scene.image, 3, random))!.ambiguous) flagged += 1;
      }
      return flagged / 150;
    };
    expect(share([2.5, 3])).toBeGreaterThan(share([0.8, 1.2]) + 0.1);
  });
});

describe("pose refinement (Levenberg–Marquardt)", () => {
  it("does not move an exact pose", () => {
    const scene = randomScene(seededRandom(41));
    const { pose, rmsBefore, rmsAfter } = refinePose(scene.K, scene.world, scene.image, scene.pose);
    expect(rmsBefore).toBeLessThan(1e-9);
    expect(rmsAfter).toBeLessThan(1e-9);
    expect(rotationDistanceDegrees(pose.R, scene.pose.R)).toBeLessThan(1e-6);
  });

  it("converges back to the true pose from a disturbed start", () => {
    const random = seededRandom(43);
    for (let trial = 0; trial < 50; trial += 1) {
      const scene = randomScene(random);
      const start = {
        R: mulMat3(rotationFromVector([(random() - 0.5) * 0.06, (random() - 0.5) * 0.06, (random() - 0.5) * 0.06]), scene.pose.R),
        t: [scene.pose.t[0] + (random() - 0.5) * 0.05, scene.pose.t[1] + (random() - 0.5) * 0.05, scene.pose.t[2] + (random() - 0.5) * 0.05] as Vec3,
      };
      const { pose, rmsBefore, rmsAfter } = refinePose(scene.K, scene.world, scene.image, start, { iterations: 50 });
      expect(rmsAfter).toBeLessThan(rmsBefore);
      expect(rmsAfter).toBeLessThan(1e-3);
      expect(rotationDistanceDegrees(pose.R, scene.pose.R)).toBeLessThan(0.01);
    }
  });

  it("always lowers the reprojection error of the DLT pose under noise", () => {
    const random = seededRandom(47);
    for (let trial = 0; trial < 100; trial += 1) {
      const scene = randomScene(random);
      const solution = solveSheet(scene.K, withTapNoise(scene.image, 2, random))!;
      expect(solution.rms).toBeLessThanOrEqual(solution.rmsDlt + 1e-9);
    }
  });
});

describe("true-scale accuracy (synthetic part of E4)", () => {
  // A 45 cm product dropped 0.5–1 m from the sheet; see measureSizeError. The
  // plan's target on real photos is a mean size error of at most 10%.

  it("is exact without tap noise", () => {
    expect(measureSizeError({ sigmaPx: 0, scenes: 100 }).mean).toBeLessThan(1e-6);
  });

  it("stays far inside 10% with 1 px and 2 px tap noise", () => {
    expect(measureSizeError({ sigmaPx: 1 }).mean).toBeLessThan(0.03);
    expect(measureSizeError({ sigmaPx: 2 }).mean).toBeLessThan(0.08);
  });

  it("owes that to the refinement: the DLT pose alone is several times worse", () => {
    const refined = measureSizeError({ sigmaPx: 1 }).mean;
    const dltOnly = measureSizeError({ sigmaPx: 1, refine: false }).mean;
    expect(dltOnly).toBeGreaterThan(4 * refined);
  });

  it("degrades gracefully when the focal length is guessed 15% wrong", () => {
    expect(measureSizeError({ sigmaPx: 0.5, focalError: 0.15 }).mean).toBeLessThan(0.05);
    expect(measureSizeError({ sigmaPx: 0.5, focalError: -0.15 }).mean).toBeLessThan(0.05);
  });
});

describe("RANSAC floor plane", () => {
  it("finds the floor among walls and noise, and refits it to the inliers", () => {
    const random = seededRandom(31);
    const points: Vec3[] = [];
    // 600 floor points at y = 1.4 (camera coordinates: y points down, so the floor is below), ±1 cm noise.
    for (let i = 0; i < 600; i += 1) points.push([(random() - 0.5) * 4, 1.4 + gaussian(random) * 0.01, 1 + random() * 4]);
    // 300 points on a wall at z = 5, and 250 scattered outliers.
    for (let i = 0; i < 300; i += 1) points.push([(random() - 0.5) * 4, random() * 1.4 - 1, 5 + gaussian(random) * 0.01]);
    for (let i = 0; i < 250; i += 1) points.push([(random() - 0.5) * 4, random() * 3 - 1.5, 1 + random() * 4]);

    const result = fitPlaneRansac(points, { threshold: 0.03, random: seededRandom(1) })!;
    expect(result).not.toBeNull();
    const normal = result.plane.normal;
    const angle = (Math.acos(Math.abs(dot3(normal, [0, 1, 0]))) * 180) / Math.PI;
    expect(angle).toBeLessThan(1);
    // Distance from the camera to the floor: |d| for a unit normal.
    expect(Math.abs(result.plane.d)).toBeCloseTo(1.4, 1);
    expect(result.inliers.length).toBeGreaterThan(560);
    expect(result.iterations).toBeLessThan(2_000);
  });

  it("picks the floor over a bigger wall only with the gravity prior", () => {
    const random = seededRandom(33);
    const points: Vec3[] = [];
    for (let i = 0; i < 300; i += 1) points.push([(random() - 0.5) * 4, 1.4 + gaussian(random) * 0.01, 1 + random() * 4]);
    for (let i = 0; i < 700; i += 1) points.push([(random() - 0.5) * 4, random() * 1.4 - 1, 5 + gaussian(random) * 0.01]);
    const tiltFromDown = (normal: Vec3) => (Math.acos(Math.abs(dot3(normal, [0, 1, 0]))) * 180) / Math.PI;

    const unconstrained = fitPlaneRansac(points, { threshold: 0.03, random: seededRandom(1) })!;
    expect(tiltFromDown(unconstrained.plane.normal)).toBeGreaterThan(80); // the wall

    const withPrior = fitPlaneRansac(points, { threshold: 0.03, random: seededRandom(1), expectedNormal: [0, 1, 0] })!;
    expect(tiltFromDown(withPrior.plane.normal)).toBeLessThan(1);
    expect(Math.abs(withPrior.plane.d)).toBeCloseTo(1.4, 1);
  });

  it("returns null when there are too few points", () => {
    expect(fitPlaneRansac([[0, 0, 0]], { threshold: 0.01 })).toBeNull();
  });

  it("back-projects a depth map of a flat floor onto one plane", () => {
    const width = 160;
    const height = 120;
    const K = intrinsics(focalFromFov(65, width), width, height);
    const pose = lookAtPose([0, 0, 1.3], [0, 3, 0]);
    const depth = new Float32Array(width * height);
    for (let v = 0; v < height; v += 1) {
      for (let u = 0; u < width; u += 1) {
        const X = floorPointAt(K, pose, [u, v]);
        if (X === null) continue;
        depth[v * width + u] = (mulMat3Vec(pose.R, [X[0], X[1], 0])[2] ?? 0) + pose.t[2];
      }
    }
    const points = backProject(depth, width, height, K, 4);
    expect(points.length).toBeGreaterThan(100);
    const result = fitPlaneRansac(points, { threshold: 0.01, random: seededRandom(2) })!;
    expect(result.inliers.length).toBe(points.length);
    // The camera is 1.3 m above the floor.
    expect(Math.abs(result.plane.d)).toBeCloseTo(1.3, 6);
  });
});
