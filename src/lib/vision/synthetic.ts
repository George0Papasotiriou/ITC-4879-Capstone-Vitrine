/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Synthetic cameras and rendered sheet scenes for testing room geometry.
 */

import { seededRandom } from "@/lib/reco/simulate";
import {
  A4_SHEET,
  cameraCentre,
  floorPointAt,
  focalFromFov,
  intrinsics,
  projectedHeight,
  projectPoint,
  solveSheet,
  type Point2,
  type Pose,
} from "@/lib/vision/camera";
import type { GrayImage } from "@/lib/vision/corners";
import { floorFromDepth, judgeFloor } from "@/lib/vision/depth";
import { add3, cross3, dot3, invert3, mulMat3, mulMat3Vec, normalize3, scale3, sub3, transpose3, type Mat3, type Vec3 } from "@/lib/vision/linalg";

/**
 * Synthetic cameras with known answers, for the tests and the synthetic part of
 * evaluation E4. A scene is a phone held at a plausible height, looking down at
 * a sheet of A4 paper on the floor; its four corners are projected with the true
 * camera and optionally disturbed by tap noise. Recovering the pose from those
 * pixels and comparing it with the truth measures the algorithm, not the photo.
 */

/**
 * The pose of a camera at `centre` looking at `target`, with the world's +Z as
 * up. Camera axes (rows of R) in world coordinates: x to the right, y down the
 * image, z forward. `roll` turns the camera about its viewing axis.
 */
export function lookAtPose(centre: Vec3, target: Vec3, roll = 0): Pose {
  const forward = normalize3(sub3(target, centre));
  const right = normalize3(cross3(forward, [0, 0, 1]));
  const down = cross3(forward, right);
  const base: Mat3 = [...right, ...down, ...forward] as Mat3;
  const c = Math.cos(roll);
  const s = Math.sin(roll);
  const R = mulMat3([c, -s, 0, s, c, 0, 0, 0, 1], base);
  return { R, t: scale3(mulMat3Vec(R, centre), -1) };
}

export type SyntheticScene = {
  width: number;
  height: number;
  K: Mat3;
  pose: Pose;
  /** Sheet corners on the floor, in tap order, metres. */
  world: Point2[];
  /** The same corners in the image, pixels, without noise. */
  image: Point2[];
};

/** Gaussian noise by the Box–Muller transform. */
export function gaussian(random: () => number): number {
  const u = Math.max(random(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
}

export type SceneOptions = {
  width?: number;
  height?: number;
  /** Horizontal distance from the camera to the sheet, metres. */
  distance?: [number, number];
  cameraHeight?: [number, number];
  fovDegrees?: [number, number];
};

const between = (random: () => number, [low, high]: [number, number]) => low + random() * (high - low);

/**
 * A random, realistic scene: by default a 4:3 photo from a 60–75° lens (phone
 * main cameras are 65–75°), the camera 0.9–1.7 m above the floor, the sheet
 * 1–2.5 m ahead and somewhat to the side, turned at any angle, with up to 8° of
 * roll. Scenes where a corner falls outside the photo are redrawn.
 */
export function randomScene(
  random: () => number,
  { width = 1600, height = 1200, distance = [1, 2.5], cameraHeight = [0.9, 1.7], fovDegrees = [60, 75] }: SceneOptions = {},
): SyntheticScene {
  for (;;) {
    const fov = between(random, fovDegrees);
    const K = intrinsics(focalFromFov(fov, width), width, height);
    const ahead = between(random, distance);
    const heading = random() * 2 * Math.PI;
    const sheetCentre: Vec3 = [(random() - 0.5) * 2, (random() - 0.5) * 2, 0];
    const centre: Vec3 = [
      sheetCentre[0] - ahead * Math.cos(heading),
      sheetCentre[1] - ahead * Math.sin(heading),
      between(random, cameraHeight),
    ];
    // Aim near the sheet, not exactly at it, so it is not always in the middle of the photo.
    const target: Vec3 = [sheetCentre[0] + (random() - 0.5) * 0.6, sheetCentre[1] + (random() - 0.5) * 0.6, 0];
    const pose = lookAtPose(centre, target, ((random() - 0.5) * 16 * Math.PI) / 180);

    const angle = random() * 2 * Math.PI;
    const { width: w, length: l } = A4_SHEET;
    const corners: Point2[] = [
      [-l / 2, -w / 2],
      [l / 2, -w / 2],
      [l / 2, w / 2],
      [-l / 2, w / 2],
    ].map(([x, y]) => [
      sheetCentre[0] + Math.cos(angle) * x! - Math.sin(angle) * y!,
      sheetCentre[1] + Math.sin(angle) * x! + Math.cos(angle) * y!,
    ]);
    const image = corners.map((p) => projectPoint(K, pose, [p[0], p[1], 0]));
    const inside = image.every((p) => p !== null && p[0] >= 20 && p[0] <= width - 20 && p[1] >= 20 && p[1] <= height - 20);
    if (!inside) continue;
    return { width, height, K, pose, world: corners, image: image as Point2[] };
  }
}

export function withTapNoise(points: readonly Point2[], sigmaPx: number, random: () => number): Point2[] {
  return points.map((p) => [p[0] + sigmaPx * gaussian(random), p[1] + sigmaPx * gaussian(random)]);
}

/**
 * Renders a photo-like image of a sheet on a floor: a textured mid-grey floor,
 * a near-white quadrilateral with anti-aliased edges (4 × 4 supersampling), and
 * sensor noise. Optional blobs stand in for shadows or a foot over an edge.
 */
export function renderSheet(
  corners: readonly Point2[],
  width: number,
  height: number,
  random: () => number,
  { noise = 0.02, blobs = [] as { centre: Point2; radius: number }[] } = {},
): GrayImage {
  const inside = (x: number, y: number) => {
    let sign = 0;
    for (let i = 0; i < 4; i += 1) {
      const a = corners[i]!;
      const b = corners[(i + 1) % 4]!;
      const cross = (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
      if (cross !== 0) {
        if (sign === 0) sign = Math.sign(cross);
        else if (Math.sign(cross) !== sign) return false;
      }
    }
    return true;
  };
  const data = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let coverage = 0;
      for (let sy = 0; sy < 4; sy += 1) for (let sx = 0; sx < 4; sx += 1) if (inside(x + (sx + 0.5) / 4 - 0.5, y + (sy + 0.5) / 4 - 0.5)) coverage += 1;
      coverage /= 16;
      const floor = 0.38 + 0.04 * Math.sin(x * 0.07) * Math.cos(y * 0.05);
      let value = floor * (1 - coverage) + 0.9 * coverage + noise * gaussian(random);
      for (const blob of blobs) if (Math.hypot(x - blob.centre[0], y - blob.centre[1]) < blob.radius) value = 0.15;
      data[y * width + x] = value;
    }
  }
  return { data, width, height };
}

export type SizeErrorOptions = {
  scenes?: number;
  seed?: number;
  /** Standard deviation of the tap error per coordinate, pixels. */
  sigmaPx?: number;
  /** Relative error of the assumed focal length: 0.15 means 15% too long. */
  focalError?: number;
  /** Refine the DLT pose by Levenberg–Marquardt (the app always does). */
  refine?: boolean;
  /** How far from the sheet's centre the product is dropped, metres. */
  spotDistance?: [number, number];
  productHeight?: number;
  scene?: SceneOptions;
};

/**
 * The quantity a shopper sees, measured on synthetic scenes: a product of known
 * height dropped at a pixel on the floor near the sheet. Its on-screen height
 * with the recovered pose is compared with its on-screen height with the true
 * camera; the relative difference is the size error. A pose that cannot place
 * the product counts as 100% error.
 */
export function measureSizeError({
  scenes = 300,
  seed = 17,
  sigmaPx = 0,
  focalError = 0,
  refine = true,
  spotDistance = [0.5, 1],
  productHeight = 0.45,
  scene: sceneOptions = {},
}: SizeErrorOptions = {}) {
  const random = seededRandom(seed);
  const errors: number[] = [];
  const clear: number[] = [];
  while (errors.length < scenes) {
    const scene = randomScene(random, sceneOptions);
    const angle = random() * 2 * Math.PI;
    const distance = between(random, spotDistance);
    const centre: Point2 = [scene.world.reduce((sum, p) => sum + p[0], 0) / 4, scene.world.reduce((sum, p) => sum + p[1], 0) / 4];
    const spot: Point2 = [centre[0] + Math.cos(angle) * distance, centre[1] + Math.sin(angle) * distance];
    const pixel = projectPoint(scene.K, scene.pose, [spot[0], spot[1], 0]);
    const truth = projectedHeight(scene.K, scene.pose, spot[0], spot[1], productHeight);
    if (pixel === null || truth === null) continue;
    if (pixel[0] < 0 || pixel[0] > scene.width || pixel[1] < 0 || pixel[1] > scene.height) continue;

    const K = intrinsics(scene.K[0] * (1 + focalError), scene.width, scene.height);
    const solution = solveSheet(K, withTapNoise(scene.image, sigmaPx, random), A4_SHEET, { refine });
    const placed = solution === null ? null : floorPointAt(K, solution.pose, pixel);
    const height = solution === null || placed === null ? null : projectedHeight(K, solution.pose, placed[0], placed[1], productHeight);
    const error = height === null ? 1 : Math.abs(height - truth) / truth;
    errors.push(error);
    if (solution !== null && !solution.ambiguous) clear.push(error);
  }
  const sorted = [...errors].sort((a, b) => a - b);
  const quantile = (p: number) => sorted[Math.floor(p * (sorted.length - 1))]!;
  return {
    mean: errors.reduce((sum, e) => sum + e, 0) / errors.length,
    p50: quantile(0.5),
    p90: quantile(0.9),
    count: errors.length,
    /** Share of scenes where the page would ask the shopper to confirm the sheet's orientation. */
    ambiguousShare: 1 - clear.length / errors.length,
    /** Mean error over the scenes that were not flagged. */
    meanWhenClear: clear.length === 0 ? Number.NaN : clear.reduce((sum, e) => sum + e, 0) / clear.length,
  };
}

/* -------------------------------------------------------------------------- */
/* Depth maps, for the paper-free mode                                        */
/* -------------------------------------------------------------------------- */

/** A box standing on the floor: the clutter a real room has, and the table top the floor finder must not mistake for the floor. */
export type DepthBox = { x: number; y: number; width: number; depth: number; height: number };

export type DepthSceneOptions = {
  /** A wall across the room at this Y, or null for an open floor. */
  wallY?: number | null;
  boxes?: DepthBox[];
  /** Relative depth noise, as a fraction of the true distance (a depth model's error is proportional, not absolute). */
  noise?: number;
  random?: () => number;
  /** Fraction of pixels the model returns nothing for. */
  holes?: number;
};

/**
 * An exact depth map of a simple room, seen by a known camera: a floor at
 * Z = 0, optionally a wall, and boxes standing on the floor. Every pixel is
 * ray-cast, so the map is the truth a depth model is trying to estimate, and
 * the floor recovered from it can be compared with the camera that made it.
 */
export function renderDepth(
  K: Mat3,
  pose: Pose,
  width: number,
  height: number,
  { wallY = 3, boxes = [], noise = 0, random = Math.random, holes = 0 }: DepthSceneOptions = {},
): { data: Float32Array; width: number; height: number } {
  const centre = cameraCentre(pose);
  const Kinv = invert3(K);
  const Rt = transpose3(pose.R);
  const forward: Vec3 = [pose.R[6], pose.R[7], pose.R[8]];
  const data = new Float32Array(width * height);

  for (let v = 0; v < height; v += 1) {
    for (let u = 0; u < width; u += 1) {
      const direction = mulMat3Vec(Rt, mulMat3Vec(Kinv, [u + 0.5, v + 0.5, 1]));
      let best = Infinity;

      // Floor Z = 0.
      if (Math.abs(direction[2]) > 1e-12) {
        const s = -centre[2] / direction[2];
        if (s > 0) best = Math.min(best, s);
      }
      // Wall at Y = wallY, facing the camera.
      if (wallY !== null && Math.abs(direction[1]) > 1e-12) {
        const s = (wallY - centre[1]) / direction[1];
        const hit = add3(centre, scale3(direction, s));
        if (s > 0 && hit[2] >= 0) best = Math.min(best, s);
      }
      // Boxes: the usual slab test, in the box's own axes (they are axis-aligned here).
      for (const box of boxes) {
        const low: Vec3 = [box.x - box.width / 2, box.y - box.depth / 2, 0];
        const high: Vec3 = [box.x + box.width / 2, box.y + box.depth / 2, box.height];
        let near = 0;
        let far = Infinity;
        let missed = false;
        for (let axis = 0; axis < 3 && !missed; axis += 1) {
          if (Math.abs(direction[axis]!) < 1e-12) {
            if (centre[axis]! < low[axis]! || centre[axis]! > high[axis]!) missed = true;
            continue;
          }
          const t0 = (low[axis]! - centre[axis]!) / direction[axis]!;
          const t1 = (high[axis]! - centre[axis]!) / direction[axis]!;
          near = Math.max(near, Math.min(t0, t1));
          far = Math.min(far, Math.max(t0, t1));
          if (near > far) missed = true;
        }
        if (!missed && near > 0) best = Math.min(best, near);
      }

      if (!Number.isFinite(best)) continue; // sky: no surface along this ray
      // Depth is measured along the optical axis, as a depth model reports it.
      const point = add3(centre, scale3(direction, best));
      let z = dot3(forward, sub3(point, centre));
      if (noise > 0) z *= 1 + noise * gaussian(random);
      if (holes > 0 && random() < holes) z = 0;
      data[v * width + u] = z;
    }
  }
  return { data, width, height };
}

/* -------------------------------------------------------------------------- */
/* The paper-free method, measured the same way                               */
/* -------------------------------------------------------------------------- */

export type DepthErrorOptions = {
  scenes?: number;
  seed?: number;
  /** Relative depth error of the model, as a fraction of the true distance. */
  noise?: number;
  /** Share of pixels the model returns nothing for. */
  holes?: number;
  /** Depth in metres. When false, the scale comes from the assumed camera height. */
  metric?: boolean;
  /** Relative error in the assumed camera height: 0.1 means the shopper's guess is 10% too high. */
  heightError?: number;
  /** Tables and boxes standing on the floor, which a floor finder must not mistake for it. */
  clutter?: boolean;
  /** Flatness the shop demands of a floor, as a share of the room distance (see judgeFloor). */
  maxRelativeRms?: number;
  /** Depth map resolution: a model's output is small, and so is this. */
  width?: number;
  height?: number;
  productHeight?: number;
  scene?: SceneOptions;
};

/**
 * The paper-free method measured exactly as the paper one is (measureSizeError):
 * the same scenes, the same question — how wrong is the size of a piece drawn on
 * the floor — so the two can be read against each other in evaluation E4.
 *
 * The depth map is the truth a model would be estimating, disturbed by the kind
 * of error a model makes: proportional to distance, plus missing readings. What
 * this measures is therefore the geometry's own contribution, with the model's
 * error as a knob rather than a fixed unknown. A photo the method refuses (no
 * floor, too little floor, not flat enough) is not counted as a size error: the
 * shop shows nothing and offers the sheet of paper instead, so refusals are
 * reported separately.
 */
export function measureDepthSizeError({
  scenes = 200,
  seed = 31,
  noise = 0,
  holes = 0,
  metric = true,
  heightError = 0,
  clutter = false,
  maxRelativeRms,
  width = 320,
  height = 240,
  productHeight = 0.45,
  scene: sceneOptions = {},
}: DepthErrorOptions = {}) {
  const random = seededRandom(seed);
  const errors: number[] = [];
  let refused = 0;
  let attempted = 0;

  while (attempted < scenes) {
    attempted += 1;
    const scene = randomScene(random, { ...sceneOptions, width, height });
    const centre: Point2 = [scene.world.reduce((sum, p) => sum + p[0], 0) / 4, scene.world.reduce((sum, p) => sum + p[1], 0) / 4];
    const boxes: DepthBox[] = clutter
      ? [
          // A table: horizontal, large, and higher than the floor — the trap.
          { x: centre[0] + (random() - 0.5), y: centre[1] + 0.6 + random() * 0.6, width: 0.9 + random(), depth: 0.5 + random() * 0.5, height: 0.4 + random() * 0.35 },
          { x: centre[0] - 1 - random(), y: centre[1] + random(), width: 0.5, depth: 0.5, height: 0.5 + random() },
        ]
      : [];
    const depth = renderDepth(scene.K, scene.pose, width, height, { wallY: centre[1] + 1.2, boxes, noise, holes, random });

    const trueHeight = cameraCentre(scene.pose)[2];
    const floor = floorFromDepth(depth, scene.K, {
      metric,
      cameraHeight: trueHeight * (1 + heightError),
      random,
    });
    if (!judgeFloor(floor, { maxRelativeRms }).ok || floor === null) {
      refused += 1;
      continue;
    }

    // A spot on the floor, in the lower middle of the photo, as a shopper would drop a piece.
    const pixel: Point2 = [width * (0.3 + random() * 0.4), height * (0.65 + random() * 0.25)];
    const truthSpot = floorPointAt(scene.K, scene.pose, pixel);
    const foundSpot = floorPointAt(scene.K, floor.pose, pixel);
    if (truthSpot === null || foundSpot === null) {
      refused += 1;
      continue;
    }
    const truth = projectedHeight(scene.K, scene.pose, truthSpot[0], truthSpot[1], productHeight);
    const drawn = projectedHeight(scene.K, floor.pose, foundSpot[0], foundSpot[1], productHeight);
    if (truth === null || drawn === null) {
      refused += 1;
      continue;
    }
    errors.push(Math.abs(drawn - truth) / truth);
  }

  const sorted = [...errors].sort((a, b) => a - b);
  const quantile = (p: number) => (sorted.length === 0 ? Number.NaN : sorted[Math.floor(p * (sorted.length - 1))]!);
  return {
    mean: errors.length === 0 ? Number.NaN : errors.reduce((sum, e) => sum + e, 0) / errors.length,
    p50: quantile(0.5),
    p90: quantile(0.9),
    count: errors.length,
    /** Share of photos the shop would refuse to place in, and offer the sheet of paper for. */
    refusedShare: refused / attempted,
    /** Share of the accepted photos drawn more than a quarter wrong: the tail that loses a shoppers trust. */
    badlyWrongShare: errors.length === 0 ? Number.NaN : errors.filter((error) => error > 0.25).length / errors.length,
  };
}
