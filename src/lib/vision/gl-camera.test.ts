/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Tests for drawing a scan with the recovered camera: WebGL's matrices land every point where the vision code does.
 */

import { describe, expect, it } from "vitest";

import { boxCorners, focalFromFov, intrinsics, projectPoint, upSign, type Pose } from "@/lib/vision/camera";
import { glPixel, pieceMatrix, projectionFromIntrinsics, transform4, viewMatrix } from "@/lib/vision/gl-camera";
import type { Mat3, Vec3 } from "@/lib/vision/linalg";

const W = 1600;
const H = 1200;

/** A camera at `eye` looking at `target`, in the vision convention (x right, y down, z forward). */
function lookAt(eye: Vec3, target: Vec3, worldUp: Vec3): Pose {
  const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = (a: Vec3): Vec3 => {
    const length = Math.hypot(...a);
    return [a[0] / length, a[1] / length, a[2] / length];
  };
  const forward = norm(sub(target, eye));
  const right = norm(cross(forward, worldUp));
  const down = cross(forward, right);
  const R: Mat3 = [...right, ...down, ...forward] as Mat3;
  const t: Vec3 = [-(R[0] * eye[0] + R[1] * eye[1] + R[2] * eye[2]), -(R[3] * eye[0] + R[4] * eye[1] + R[5] * eye[2]), -(R[6] * eye[0] + R[7] * eye[1] + R[8] * eye[2])];
  return { R, t };
}

const K = intrinsics(focalFromFov(69, Math.max(W, H)), W, H);
// Two rooms: up is +z in one and −z in the other, as the sheet's labelling can make it.
const ROOMS: { name: string; pose: Pose }[] = [
  { name: "up is +z", pose: lookAt([0.4, -2.6, 1.45], [0.1, 0.3, 0.3], [0, 0, 1]) },
  { name: "up is −z", pose: lookAt([-0.3, 2.2, -1.3], [0.2, -0.2, -0.4], [0, 0, -1]) },
];

describe("the recovered camera as WebGL's", () => {
  for (const { name, pose } of ROOMS) {
    it(`draws every point where the vision code projects it (${name})`, () => {
      const view = viewMatrix(pose);
      const projection = projectionFromIntrinsics(K, W, H);
      const points: Vec3[] = [
        [0, 0, 0],
        [0.6, 0.4, 0],
        [-0.5, 0.8, upSign(pose) * 0.9],
        [0.2, -0.1, upSign(pose) * 1.6],
      ];
      for (const point of points) {
        const vision = projectPoint(K, pose, point)!;
        const gl = glPixel(view, projection, point, W, H)!;
        expect(gl[0]).toBeCloseTo(vision[0], 6);
        expect(gl[1]).toBeCloseTo(vision[1], 6);
      }
    });

    it(`puts a scan's bounding box exactly on the planner's box, turned and moved (${name})`, () => {
      const up = upSign(pose);
      const placement = { x: 0.3, y: 0.5, rotation: 0.7, width: 1.3, depth: 0.9, height: 0.75 };
      const matrix = pieceMatrix(placement, up);
      // The glTF box: centred on its footprint, standing on y = 0, front along +z.
      const gltf: Vec3[] = [];
      for (const x of [-placement.width / 2, placement.width / 2]) for (const y of [0, placement.height]) for (const z of [-placement.depth / 2, placement.depth / 2]) gltf.push([x, y, z]);
      const placed = gltf.map((point) => transform4(matrix, point).slice(0, 3).map((value) => Math.round(value * 1e6) / 1e6).join(","));
      const expected = boxCorners(placement, up).map((point) => point.map((value) => Math.round(value * 1e6) / 1e6).join(","));
      expect(new Set(placed)).toEqual(new Set(expected));
    });
  }

  it("turns the piece's front, glTF +z, to the planner's front, −y before turning", () => {
    for (const up of [1, -1] as const) {
      const front = transform4(pieceMatrix({ x: 0, y: 0, rotation: 0 }, up), [0, 0, 1], 0);
      expect(front.slice(0, 3)).toEqual([0, -1, 0]);
      const top = transform4(pieceMatrix({ x: 0, y: 0, rotation: 0 }, up), [0, 1, 0], 0);
      expect(top.slice(0, 3).map((value) => value + 0)).toEqual([0, 0, up]);
    }
  });

  it("never mirrors the scan: the placement is a rotation for either up", () => {
    for (const up of [1, -1] as const) {
      const m = pieceMatrix({ x: 0, y: 0, rotation: 1.1 }, up);
      // Determinant of the upper-left 3×3 (column-major).
      const det = m[0]! * (m[5]! * m[10]! - m[9]! * m[6]!) - m[4]! * (m[1]! * m[10]! - m[9]! * m[2]!) + m[8]! * (m[1]! * m[6]! - m[5]! * m[2]!);
      expect(det).toBeCloseTo(1, 12);
    }
  });

  it("knows a point behind the camera has no pixel", () => {
    const { pose } = ROOMS[0]!;
    expect(glPixel(viewMatrix(pose), projectionFromIntrinsics(K, W, H), [0.4, -6, 1.45], W, H)).toBeNull();
  });
});
