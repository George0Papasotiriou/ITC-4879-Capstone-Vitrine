/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Camera pose from a depth map: the floor plane, the scale and the metrics that say whether to trust it.
 */

import {
  fitPlaneRansac,
  refitPlane,
  type Plane,
  type Pose,
} from "@/lib/vision/camera";
import {
  cross3,
  dot3,
  fromColumns3,
  invert3,
  mulMat3Vec,
  norm3,
  normalize3,
  scale3,
  sub3,
  type Mat3,
  type Vec3,
} from "@/lib/vision/linalg";

/**
 * Placing a piece WITHOUT the sheet of paper (docs/PLAN.md 2.6 A4, "automatic
 * mode"). The sheet exists to give the photograph a known size; without it the
 * size has to come from somewhere else, and that somewhere is a depth map: a
 * distance for every pixel, estimated on the shopper's own device.
 *
 * What this module does with that depth map is ordinary geometry, and it is the
 * part that decides whether a sofa is drawn at the right size:
 *
 *   1. Back-project a grid of pixels to 3D points in camera coordinates.
 *   2. Find the floor among them (RANSAC with a gravity prior, camera.ts), and
 *      prefer the LOWEST strong horizontal plane, because a table top is
 *      horizontal too and the floor is the one underneath it.
 *   3. Turn that plane into the same kind of pose the paper method produces, so
 *      everything downstream — dragging, the grid, the true-scale product — is
 *      unchanged.
 *   4. Report how well it went, in quantities a person can act on: how much of
 *      the picture is floor, how flat that floor is, how high the camera is.
 *
 * COORDINATES. As in camera.ts the floor is the world plane Z = 0 in metres.
 * Here the origin is the point on the floor directly under the camera, +Y is
 * the way the camera is facing (its optical axis flattened onto the floor), +X
 * is to the right and +Z is up.
 *
 * SCALE. A metric depth model answers in metres and the geometry is metric with
 * it. A relative model answers up to one unknown factor; then the factor is
 * fixed by how high the camera was held, which the shopper can correct with a
 * slider. Which of the two is in use is the model's business (depth-model.ts),
 * not this module's: it is told.
 */

export type DepthMap = {
  /** Distance along the optical axis for each pixel, row by row. Zero or negative means "no reading". */
  data: ArrayLike<number>;
  width: number;
  height: number;
};

export type FloorFromDepthOptions = {
  /** Sample every nth pixel in each direction. 2048/8 ≈ 65k points, plenty for a plane. */
  stride?: number;
  /** Depth already in metres. When false, `cameraHeight` fixes the scale. */
  metric?: boolean;
  /** Height the camera is assumed to have been held at, metres (used when `metric` is false). */
  cameraHeight?: number;
  /**
   * How far the floor's normal may lean from the camera's own up direction.
   * Much wider than the 25° the paper method's RANSAC uses: someone photographing
   * the floor in front of them tilts the phone steeply, and the synthetic
   * evaluation refused a quarter of perfectly good photos at 50°.
   */
  maxTiltDegrees?: number;
  /** Plausible camera heights, metres: outside this the answer is refused. */
  heightRange?: [number, number];
  random?: () => number;
};

export type FloorFromDepth = {
  pose: Pose;
  /** Height of the camera above the floor, metres, after scaling. */
  cameraHeight: number;
  /** Factor applied to the depth map to make it metric (1 when it already was). */
  scale: number;
  /** Share of the sampled points lying on the floor plane. */
  floorShare: number;
  /** Share of the sampled points in the lower third of the photo that lie on the floor. */
  coverage: number;
  /** Root-mean-square distance of the floor points from the fitted plane, metres. */
  planeRms: number;
  /**
   * The same scatter as a share of how far away the room is. A depth model's
   * error grows with distance, so this is the quantity that says "flat" or
   * "not flat" in a corridor and in a small bedroom alike.
   */
  planeRmsRelative: number;
  /** How far the camera was tilted from level, degrees: 0 looking at the horizon, 90 straight down. */
  tiltDegrees: number;
  /** The floor plane in camera coordinates, before scaling. */
  plane: Plane;
  /** Sampled points on the floor, in image coordinates: drawn as the "floor found" overlay. */
  floorPixels: [number, number][];
};

type Sample = { point: Vec3; u: number; v: number };

/** Back-projects a grid of pixels, keeping where each came from. p = z · K⁻¹·(u, v, 1) / (K⁻¹·(u, v, 1))_z. */
export function sampleDepth(depth: DepthMap, K: Mat3, stride: number): Sample[] {
  const Kinv = invert3(K);
  const out: Sample[] = [];
  for (let v = 0; v < depth.height; v += stride) {
    for (let u = 0; u < depth.width; u += stride) {
      const z = depth.data[v * depth.width + u];
      if (z === undefined || !(z > 0) || !Number.isFinite(z)) continue;
      const ray = mulMat3Vec(Kinv, [u, v, 1]);
      out.push({ point: scale3(ray, z / ray[2]), u, v });
    }
  }
  return out;
}

/**
 * The camera's own up direction in camera coordinates. Image y grows downwards,
 * so for a level camera "up" is −y; this is what the gravity prior compares a
 * candidate floor against, and the tilt is measured from it.
 */
const CAMERA_UP: Vec3 = [0, -1, 0];

/**
 * A pose from a floor plane in camera coordinates.
 *
 * The plane is n·x + d = 0 with ‖n‖ = 1, so the camera (at the origin) is |d|
 * from it and the normal pointing back at the camera is sign(d)·n — call it u.
 * The world's axes, written in camera coordinates, are then
 *
 *   z_world = u                                    (up, out of the floor)
 *   y_world = normalize(z_cam − (z_cam·u) u)       (where the camera looks, flattened)
 *   x_world = y_world × z_world                    (to the right)
 *
 * A world point maps to camera coordinates by x = R·X + t with R = [x_w y_w z_w]
 * as columns. The world origin is the floor point under the camera, which in
 * camera coordinates is −|d|·u, and that is t.
 *
 * Null when the camera is on the floor (no height) or when the plane is seen
 * exactly edge-on, which no photograph of a floor is.
 */
export function poseFromFloorPlane(plane: Plane, { scale = 1 } = {}): { pose: Pose; height: number } | null {
  const sign = plane.d >= 0 ? 1 : -1;
  const up = normalize3(scale3(plane.normal, sign));
  const height = Math.abs(plane.d) * scale;
  if (!(height > 1e-6) || !Number.isFinite(height)) return null;

  const optical: Vec3 = [0, 0, 1];
  let forward = sub3(optical, scale3(up, dot3(optical, up)));
  if (norm3(forward) < 1e-6) {
    // Straight down: the optical axis has no direction along the floor, so the
    // top of the photo decides which way is "forward" instead.
    forward = sub3(CAMERA_UP, scale3(up, dot3(CAMERA_UP, up)));
    if (norm3(forward) < 1e-6) return null;
  }
  forward = normalize3(forward);
  const right = cross3(forward, up);
  return { pose: { R: fromColumns3(right, forward, up), t: scale3(up, -height) }, height };
}

/** Angle between two unit vectors, degrees. */
function angleDegrees(a: Vec3, b: Vec3): number {
  return (Math.acos(Math.min(1, Math.max(-1, dot3(a, b)))) * 180) / Math.PI;
}

/**
 * The floor in a depth map, and the camera pose that follows from it.
 *
 * Why the lowest plane rather than the biggest: RANSAC returns the plane with
 * the most points, and in a photo of a dining room that can be the table. So up
 * to three horizontal planes are fitted, each on the points the previous ones
 * did not claim, and the lowest one that still has a substantial share of the
 * points wins. Ceilings are excluded by the same test that excludes walls: the
 * normal that points back at the camera must point roughly upwards, which a
 * ceiling's does not.
 *
 * Returns null when there is no usable depth, no horizontal plane, or the
 * resulting camera height is not plausible for a person holding a phone.
 */
export function floorFromDepth(depth: DepthMap, K: Mat3, options: FloorFromDepthOptions = {}): FloorFromDepth | null {
  const {
    stride = Math.max(2, Math.round(Math.max(depth.width, depth.height) / 256)),
    metric = true,
    cameraHeight = 1.4,
    maxTiltDegrees = 70,
    heightRange = [0.3, 3],
    random = Math.random,
  } = options;

  const samples = sampleDepth(depth, K, stride);
  if (samples.length < 64) return null;

  // Inlier distance: 1.5% of the median depth, so a small room is judged more
  // tightly than a long corridor and neither depends on the units.
  const depths = samples.map((sample) => sample.point[2]).sort((a, b) => a - b);
  const median = depths[Math.floor(depths.length / 2)]!;
  const threshold = Math.max(1e-6, 0.015 * median);

  type Candidate = { plane: Plane; inliers: Sample[]; distance: number };
  const candidates: Candidate[] = [];
  let remaining = samples;
  // Five rounds, not three: a wall, a ceiling and two tables can each take a
  // round before the floor is reached, and a floor missed is a sofa drawn at a
  // table's scale.
  for (let round = 0; round < 5 && remaining.length >= 64; round += 1) {
    const fit = fitPlaneRansac(
      remaining.map((sample) => sample.point),
      { threshold, random, expectedNormal: CAMERA_UP, maxAngleDegrees: maxTiltDegrees },
    );
    if (fit === null) break;
    const inlierSet = new Set(fit.inliers);
    const inliers = remaining.filter((_, index) => inlierSet.has(index));
    remaining = remaining.filter((_, index) => !inlierSet.has(index));
    // The normal pointing back at the camera must point upwards: a ceiling's points down.
    const up = scale3(fit.plane.normal, fit.plane.d >= 0 ? 1 : -1);
    if (angleDegrees(up, CAMERA_UP) <= maxTiltDegrees) {
      candidates.push({ plane: fit.plane, inliers, distance: Math.abs(fit.plane.d) });
    }
  }
  if (candidates.length === 0) return null;

  // The floor is the lowest plane that still holds a real share of the picture.
  const strongest = Math.max(...candidates.map((candidate) => candidate.inliers.length));
  const floor = candidates
    .filter((candidate) => candidate.inliers.length >= Math.max(0.3 * strongest, 0.04 * samples.length))
    .sort((a, b) => b.distance - a.distance)[0];
  if (floor === undefined) return null;

  /*
   * Which points belong to the floor. RANSAC used a tight band, chosen for a
   * clean depth map; a real model is noisier, and with a tight band most of the
   * floor would be counted as "not floor" — the synthetic evaluation then
   * refused three quarters of perfectly good photos for showing "too little
   * floor", while the plane itself was right to a few centimetres.
   *
   * So the band grows to fit the scatter it finds: take the points within it,
   * measure their scatter, widen to three times that, repeat. For Gaussian
   * noise this settles at about three standard deviations after two passes. It
   * stays well inside the 40 cm that separates a floor from a table top, so a
   * wider band does not start swallowing the furniture, and the plane is refitted
   * on the points it ends up with.
   */
  let plane = refitPlane(floor.inliers.map((sample) => sample.point));
  let band = threshold;
  let onFloor = floor.inliers;
  for (let pass = 0; pass < 3; pass += 1) {
    onFloor = samples.filter((sample) => Math.abs(dot3(plane.normal, sample.point) + plane.d) <= band);
    if (onFloor.length < 32) return null;
    plane = refitPlane(onFloor.map((sample) => sample.point));
    const scatter = Math.sqrt(
      onFloor.reduce((sum, sample) => sum + (dot3(plane.normal, sample.point) + plane.d) ** 2, 0) / onFloor.length,
    );
    const wider = Math.max(threshold, 3 * scatter);
    if (wider <= band * 1.05) break;
    band = wider;
  }
  onFloor = samples.filter((sample) => Math.abs(dot3(plane.normal, sample.point) + plane.d) <= band);
  if (onFloor.length < 32) return null;

  const rawHeight = Math.abs(plane.d);
  const scale = metric ? 1 : cameraHeight / Math.max(rawHeight, 1e-9);
  const solved = poseFromFloorPlane(plane, { scale });
  if (solved === null) return null;
  if (solved.height < heightRange[0] || solved.height > heightRange[1]) return null;

  const residuals = onFloor.map((sample) => dot3(plane.normal, sample.point) + plane.d);
  const planeRms = Math.sqrt(residuals.reduce((sum, value) => sum + value * value, 0) / residuals.length) * scale;
  const lower = samples.filter((sample) => sample.v >= (2 * depth.height) / 3);
  const lowerFloor = onFloor.filter((sample) => sample.v >= (2 * depth.height) / 3);
  const up = scale3(plane.normal, plane.d >= 0 ? 1 : -1);

  return {
    pose: solved.pose,
    cameraHeight: solved.height,
    scale,
    floorShare: onFloor.length / samples.length,
    coverage: lower.length === 0 ? 0 : lowerFloor.length / lower.length,
    planeRms,
    planeRmsRelative: planeRms / Math.max(1e-9, median * scale),
    tiltDegrees: angleDegrees(normalize3(up), CAMERA_UP),
    plane,
    floorPixels: onFloor.map((sample) => [sample.u, sample.v]),
  };
}

/**
 * Whether the answer is worth showing. These are the thresholds the page uses to
 * decide between "ready", "this looks unreliable, here is why" and "use the
 * sheet of paper instead"; they are here, next to the geometry, so the test and
 * the interface cannot drift apart.
 */
export type FloorVerdict = { ok: boolean; reason: "no_floor" | "little_floor" | "rough_floor" | "steep" | null };

export type JudgeFloorOptions = {
  /** Smallest share of the photo's lower third that must be floor. */
  minCoverage?: number;
  /** Largest scatter about the plane, as a share of how far away the room is. */
  maxRelativeRms?: number;
  /** Largest scatter in metres, whatever the room's size. */
  maxRms?: number;
  /** Steepest downward view still worth placing in. */
  maxTiltDegrees?: number;
};

/**
 * The relative-flatness threshold, chosen by measurement rather than taste
 * (evaluation E4, section 7): tighter refuses most photos from a model with the
 * 5% error current metric models have, looser accepts floors that are not flat
 * and draws pieces at plainly wrong sizes.
 */
export const MAX_RELATIVE_RMS = 0.12;

export function judgeFloor(floor: FloorFromDepth | null, options: JudgeFloorOptions = {}): FloorVerdict {
  const { minCoverage = 0.25, maxRelativeRms = MAX_RELATIVE_RMS, maxRms = 0.3, maxTiltDegrees = 80 } = options;
  if (floor === null) return { ok: false, reason: "no_floor" };
  if (floor.coverage < minCoverage) return { ok: false, reason: "little_floor" };
  /*
   * A real floor is flat, but "flat" has to be measured against the room's own
   * size: a depth model's error grows with distance, so the same 6 cm of
   * scatter is noise across a 4 m living room and a wrong plane in a 1 m
   * close-up. Judging on an absolute 8 cm refused most photos from a model with
   * ordinary 5% error (evaluation E4, section 7). So the test is relative, with
   * an absolute ceiling for the case where the plane is simply not the floor.
   */
  if (floor.planeRmsRelative > maxRelativeRms || floor.planeRms > maxRms) return { ok: false, reason: "rough_floor" };
  if (floor.tiltDegrees > maxTiltDegrees) return { ok: false, reason: "steep" };
  return { ok: true, reason: null };
}

/**
 * Where to stand the piece before the shopper drags it: on the floor, straight
 * ahead, far enough away to be seen whole. In the paper method the sheet answers
 * this question — the shopper put it where the piece would go.
 *
 * Two things set the distance. A photo taken steeply downwards sees less far, so
 * the spot comes closer; and a three-metre sofa has to stand further back than a
 * side table or it fills the frame and its ends are cut off. The second is just
 * the pinhole model read backwards: a piece of width w seen at distance d spans
 * 2·atan(w / 2d), and that is kept to 70% of what the photo covers.
 */
export function defaultSpot(
  floor: FloorFromDepth,
  { width = 0, focal, imageWidth, distance = 2 }: { width?: number; focal?: number; imageWidth?: number; distance?: number } = {},
): { x: number; y: number } {
  const ahead = distance * Math.cos((floor.tiltDegrees * Math.PI) / 180);
  let fits = 0;
  if (focal !== undefined && imageWidth !== undefined && width > 0) {
    const halfAngle = 0.7 * Math.atan(imageWidth / (2 * focal));
    fits = width / 2 / Math.tan(halfAngle);
  }
  return { x: 0, y: Math.max(0.6, ahead, fits) };
}
