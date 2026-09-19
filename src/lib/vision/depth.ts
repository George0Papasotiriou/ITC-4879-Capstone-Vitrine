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
 *   2. Fit the room's big planes (RANSAC, camera.ts), keep the ones close to
 *      level, and prefer the LOWEST strong one among those parallel to the most
 *      level, because a table top is horizontal too and the floor is the one
 *      underneath it.
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
  /**
   * The focal length, in this map's pixels, that its distances assume — set by
   * a metric model that cannot be told which lens took the photo. Absent when
   * the distances are true for any lens (the drawn sample room, a test scene).
   *
   * WHY IT MATTERS. A single-image metric model judges distance mostly by how
   * big familiar things look, and it learned what "big" means from one camera:
   * Depth Anything V2 Metric Indoor was fine-tuned on Hypersim, rendered at 60°
   * and resized so that lens is about 598 px on its 518 px input. Shown a photo
   * from any other lens, it answers as if that camera had taken it, so every
   * distance is off by the ratio of the two focal lengths — a phone's 69° main
   * camera makes the room look 1.6 times deeper than it is, and a sofa placed
   * in it 37% too small. Undoing that is Metric3D's "canonical camera"
   * transformation (Yin et al., ICCV 2023): multiply each distance by
   * f_photo / f_model. `sampleDepth` does it, so everything downstream sees the
   * room at its true depth for the lens in K.
   */
  focal?: number;
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
  /** Factor applied for the photo's lens, f_photo / f_model (1 when the map did not say; see `DepthMap.focal`). */
  lensFactor: number;
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
  /** The floor plane in camera coordinates, after the lens factor and before scaling. */
  plane: Plane;
  /** Sampled points on the floor, in image coordinates: drawn as the "floor found" overlay. */
  floorPixels: [number, number][];
};

type Sample = { point: Vec3; u: number; v: number };

/**
 * How much a map's distances must be stretched for the lens in K: f_photo /
 * f_model when the map says which lens its distances assume, 1 otherwise.
 */
export function lensFactor(depth: DepthMap, K: Mat3): number {
  return depth.focal === undefined || !(depth.focal > 0) ? 1 : K[0] / depth.focal;
}

/**
 * Back-projects a grid of pixels, keeping where each came from.
 * p = z · λ · K⁻¹·(u, v, 1) / (K⁻¹·(u, v, 1))_z, with λ the lens factor above.
 */
export function sampleDepth(depth: DepthMap, K: Mat3, stride: number): Sample[] {
  const Kinv = invert3(K);
  const lens = lensFactor(depth, K);
  const out: Sample[] = [];
  for (let v = 0; v < depth.height; v += stride) {
    for (let u = 0; u < depth.width; u += stride) {
      const z = depth.data[v * depth.width + u];
      if (z === undefined || !(z > 0) || !Number.isFinite(z)) continue;
      const ray = mulMat3Vec(Kinv, [u, v, 1]);
      out.push({ point: scale3(ray, (z * lens) / ray[2]), u, v });
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
 * How far apart two planes' normals may be and still count as the same
 * direction: a table top and the floor under it, each fitted to a noisy depth
 * map. A wall is 90° from the floor; the steepest plane the tilt limit lets
 * through a level photo is still 60° or more away from it.
 */
const PARALLEL_DEGREES = 20;

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

  type Candidate = { plane: Plane; inliers: Sample[]; distance: number; up: Vec3; tilt: number };
  const candidates: Candidate[] = [];
  /** Every plane fitted, candidate or not: the walls among them keep their points out of the floor below. */
  const fitted: { plane: Plane; up: Vec3 }[] = [];
  let remaining = samples;
  /*
   * The room's big planes, one after another, each on the points the previous
   * ones did not claim — walls included, on purpose. An earlier version told
   * RANSAC to consider only planes within the tilt limit, to reach the floor
   * sooner. Forbidden the back wall, it returned the steepest plane it was
   * allowed instead: a band of wall points cut at exactly the limit, which held
   * more points than a strip of floor and took round after round (evaluation E4,
   * web photos: the floor was never reached in the wardrobe and bookcase photos).
   * Fitted freely, a wall comes out as a wall and is simply not a candidate.
   * Six rounds: two walls, a ceiling and two table tops can each take one before
   * the floor, and a floor missed is a sofa drawn at a table's scale.
   */
  for (let round = 0; round < 6 && remaining.length >= 64; round += 1) {
    const fit = fitPlaneRansac(remaining.map((sample) => sample.point), { threshold, random });
    if (fit === null) break;
    const inlierSet = new Set(fit.inliers);
    const inliers = remaining.filter((_, index) => inlierSet.has(index));
    remaining = remaining.filter((_, index) => !inlierSet.has(index));
    // The normal pointing back at the camera must point upwards: a ceiling's points down.
    const up = scale3(fit.plane.normal, fit.plane.d >= 0 ? 1 : -1);
    const tilt = angleDegrees(up, CAMERA_UP);
    fitted.push({ plane: fit.plane, up });
    if (tilt <= maxTiltDegrees) {
      candidates.push({ plane: fit.plane, inliers, distance: Math.abs(fit.plane.d), up, tilt });
    }
  }
  if (candidates.length === 0) return null;

  /*
   * The floor is the lowest plane that still holds a real share of the picture —
   * but only among the horizontal ones, and "horizontal" is decided by the planes
   * themselves, not by the tilt limit alone. A photo taken slightly upwards sees
   * the back wall within the limit (pitched up 20°, the wall reads as a floor
   * tilted 70°), and a monocular model often leans walls towards the camera,
   * which does the same. That wall is two or three metres away, further than
   * the floor is below the camera, so "lowest" alone would pick it.
   *
   * Every horizontal surface in a room is parallel to the floor, so the candidate
   * closest to level fixes which way is up, and only planes parallel to it — the
   * floor and table tops, never a wall — compete to be the lowest.
   */
  // "A real share" is judged among the horizontal planes only: a strip of floor under a
  // wall that fills the photo is small next to the wall, and it is still the floor.
  const minimum = 0.04 * samples.length;
  const level = candidates.filter((candidate) => candidate.inliers.length >= minimum).sort((a, b) => a.tilt - b.tilt)[0];
  if (level === undefined) return null;
  const horizontal = candidates.filter((candidate) => angleDegrees(candidate.up, level.up) <= PARALLEL_DEGREES);
  const strongest = Math.max(...horizontal.map((candidate) => candidate.inliers.length));
  const floor = horizontal
    .filter((candidate) => candidate.inliers.length >= Math.max(0.3 * strongest, minimum))
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
   *
   * Where a wall meets the floor, the foot of the wall lies inside that band. A
   * point nearer to a wall than to the floor is the wall's, and stays out: left
   * in, a few rows of wall tilted the floor enough to put the camera 7% too high
   * when the wall leans (the unit test with a wall leaning back by 25°).
   */
  const walls = fitted.filter((other) => angleDegrees(other.up, level.up) > PARALLEL_DEGREES).map((other) => other.plane);
  const distanceTo = (surface: Plane, point: Vec3) => Math.abs(dot3(surface.normal, point) + surface.d);
  const within = (surface: Plane, width: number) => (sample: Sample) => {
    const own = distanceTo(surface, sample.point);
    return own <= width && walls.every((wall) => distanceTo(wall, sample.point) >= own);
  };
  let plane = refitPlane(floor.inliers.map((sample) => sample.point));
  let band = threshold;
  let onFloor = floor.inliers;
  for (let pass = 0; pass < 3; pass += 1) {
    onFloor = samples.filter(within(plane, band));
    if (onFloor.length < 32) return null;
    plane = refitPlane(onFloor.map((sample) => sample.point));
    const scatter = Math.sqrt(
      onFloor.reduce((sum, sample) => sum + (dot3(plane.normal, sample.point) + plane.d) ** 2, 0) / onFloor.length,
    );
    const wider = Math.max(threshold, 3 * scatter);
    if (wider <= band * 1.05) break;
    band = wider;
  }
  onFloor = samples.filter(within(plane, band));
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
    lensFactor: lensFactor(depth, K),
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
