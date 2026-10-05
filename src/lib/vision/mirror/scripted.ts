/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * A scripted face: the average face posed and projected as a real one would be seen, for tests and for machines without a camera.
 */

import type { Point2 } from "@/lib/vision/camera";
import { mulMat3, rotationFromEuler, type Vec3 } from "@/lib/vision/linalg";
import { CANONICAL_FACE_MM, IRISES, LANDMARK } from "@/lib/vision/mirror/face-model";
import { IRIS_DIAMETER_MM, IRIS_RIM_CALIBRATION } from "@/lib/vision/mirror/iris";
import { FRONTAL, frameIntrinsics, project, type HeadPose } from "@/lib/vision/mirror/pose";

export type ScriptedFace = { yaw: number; pitch: number; roll: number; distanceMm: number; size: number };

/**
 * The average face, posed and projected exactly as a real one would be seen,
 * with irises 11.7 mm across (made as large as MediaPipe's rim would mark
 * them, so the measured scale is the face's `size`).
 */
export function scriptedLandmarks(face: ScriptedFace, width: number, height: number): Point2[] {
  const K = frameIntrinsics(width, height);
  const radians = Math.PI / 180;
  const pose: HeadPose = { R: mulMat3(rotationFromEuler(face.yaw * radians, face.pitch * radians, face.roll * radians), FRONTAL), t: [0, 0, face.distanceMm / face.size] };
  const points: Point2[] = CANONICAL_FACE_MM.map((X) => project(K, pose, X) ?? [0, 0]);
  // The irises are a fixed size in true millimetres, so on a face drawn at 1/size they are 1/size as large.
  const r = IRIS_DIAMETER_MM / IRIS_RIM_CALIBRATION / 2 / face.size;
  IRISES.forEach((iris, index) => {
    const [outer, inner] = index === 0 ? [LANDMARK.rightEyeOuter, LANDMARK.rightEyeInner] : [LANDMARK.leftEyeOuter, LANDMARK.leftEyeInner];
    const centre: Vec3 = CANONICAL_FACE_MM[outer]!.map((value, axis) => (value + CANONICAL_FACE_MM[inner]![axis]!) / 2) as Vec3;
    const rim: Vec3[] = [
      [centre[0] + r, centre[1], centre[2]],
      [centre[0], centre[1] + r, centre[2]],
      [centre[0] - r, centre[1], centre[2]],
      [centre[0], centre[1] - r, centre[2]],
    ];
    points[iris.centre] = project(K, pose, centre) ?? [0, 0];
    iris.rim.forEach((landmark, k) => (points[landmark] = project(K, pose, rim[k]!) ?? [0, 0]));
  });
  return points;
}

