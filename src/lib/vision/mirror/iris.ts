/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * A face's true size from its irises: the one part of a face that is nearly the same size on every adult.
 */

import type { Point2 } from "@/lib/vision/camera";
import { IRISES, LANDMARK } from "@/lib/vision/mirror/face-model";
import { toCamera, type HeadPose, type Intrinsics } from "@/lib/vision/mirror/pose";
import { CANONICAL_FACE_MM } from "@/lib/vision/mirror/face-model";
import { add3, scale3, type Vec3 } from "@/lib/vision/linalg";

/**
 * docs/adr/065. The pose is solved against the average face, so it comes out
 * in the average face's millimetres: a larger head simply seems a little
 * closer. To draw a 30 mm earring at 30 mm on this face, the mirror needs
 * this face's own scale.
 *
 * The visible iris is 11.7 mm across on average in adults, with a spread of
 * about ±0.5 mm (horizontal visible iris diameter; Rüfer, Schröder and Erb,
 * Cornea 2005, 7,000 eyes), far tighter than faces, which vary by ±10%. An
 * iris d pixels across at focal length f is therefore at depth
 *
 *   Z_iris = f · 11.7 mm / d.
 *
 * The pose puts the same eye at depth Z_pose in average-face millimetres, so
 * this face is k = Z_iris / Z_pose times the average face: every head point
 * is k·X, and a piece S mm long is drawn S/k model-millimetres long.
 *
 * Turning the head foreshortens an iris across the turn but not along it,
 * so each iris is measured by the longer of its two diameters.
 */

export const IRIS_DIAMETER_MM = 11.7;

/**
 * MediaPipe's rim points sit a little outside the visible iris (an iris
 * seems wider, so nearer, than it is), so measured as they are, adult faces
 * come out smaller than average. E13 measured the
 * uncalibrated ratio over 1,399 of AFLW2000's faces: median 0.914 (half of
 * them between 0.874 and 1.050). It is divided out here, so that the average
 * adult face reads 1 (docs/report/evaluations/e13-mirror.md). AFLW2000's
 * pictures are small and their irises a few pixels across, so part of this
 * may be blur that a webcam would not have; the limits below catch the rest.
 */
export const IRIS_RIM_CALIBRATION = 0.914;

/** How far from the average face a face may be judged: beyond this, the measurement is wrong, not the face. */
export const FACE_SCALE_LIMITS = [0.8, 1.25] as const;

/** An iris's diameter in pixels: the longer of its rim's two diameters. */
export function irisDiameterPx(landmarks: readonly Point2[], iris: (typeof IRISES)[number]): number | null {
  const [right, top, left, bottom] = iris.rim.map((index) => landmarks[index]);
  if (right === undefined || top === undefined || left === undefined || bottom === undefined) return null;
  const across = Math.hypot(right[0] - left[0], right[1] - left[1]);
  const down = Math.hypot(top[0] - bottom[0], top[1] - bottom[1]);
  const diameter = Math.max(across, down);
  return diameter > 1 ? diameter : null;
}

/** The middle of an eye on the average face, between its corners. */
const eyeCentres: Vec3[] = [
  scale3(add3(CANONICAL_FACE_MM[LANDMARK.rightEyeOuter]!, CANONICAL_FACE_MM[LANDMARK.rightEyeInner]!), 0.5),
  scale3(add3(CANONICAL_FACE_MM[LANDMARK.leftEyeOuter]!, CANONICAL_FACE_MM[LANDMARK.leftEyeInner]!), 0.5),
];

/** The eyes' depth by their irises over their depth by the pose, averaged over both eyes, as measured (no calibration, no limits). */
export function irisDepthRatio(landmarks: readonly Point2[], K: Intrinsics, pose: HeadPose): number | null {
  const ratios: number[] = [];
  IRISES.forEach((iris, index) => {
    const diameter = irisDiameterPx(landmarks, iris);
    if (diameter === null) return;
    const poseDepth = toCamera(pose, eyeCentres[index]!)[2];
    if (poseDepth <= 0) return;
    ratios.push((K.f * IRIS_DIAMETER_MM) / diameter / poseDepth);
  });
  return ratios.length === 0 ? null : ratios.reduce((sum, value) => sum + value, 0) / ratios.length;
}

/** k for this frame: the iris depth ratio with MediaPipe's rim calibrated out; null when unmeasurable or outside the believable range. */
export function faceScale(landmarks: readonly Point2[], K: Intrinsics, pose: HeadPose): number | null {
  const ratio = irisDepthRatio(landmarks, K, pose);
  if (ratio === null) return null;
  const k = ratio / IRIS_RIM_CALIBRATION;
  return k >= FACE_SCALE_LIMITS[0] && k <= FACE_SCALE_LIMITS[1] ? k : null;
}
