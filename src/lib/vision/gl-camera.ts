/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The recovered camera as a WebGL camera, and a 3D scan's place in the room: so a real model can be drawn into the photograph.
 */

import type { Pose, Placement } from "@/lib/vision/camera";
import type { Mat3, Vec3 } from "@/lib/vision/linalg";

/**
 * docs/adr/052. The room planner recovers the camera of the shopper's
 * photograph from a sheet of paper (camera.ts): intrinsics K and a pose (R, t)
 * in the vision convention, where a world point X lands in the camera at
 * x = R·X + t, the camera looks along +z with +y pointing down, and the pixel
 * is (f·x/z + cx, f·y/z + cy). The world is the floor: z = 0, with "up" on
 * the camera's side (upSign).
 *
 * To draw a 3D scan with that very camera, WebGL needs two 4×4 matrices:
 *
 * VIEW. OpenGL's camera looks along −z with +y up, so the camera axes are
 * flipped by D = diag(1, −1, −1):  V = D·[R | t].
 *
 * PROJECTION from the intrinsics, for an image W × H with the origin at its
 * top-left corner, between the near and far planes n and f:
 *
 *        | 2fx/W    0        1 − 2cx/W        0          |
 *   P =  | 0        2fy/H    2cy/H − 1        0          |
 *        | 0        0       −(f + n)/(f − n)  −2fn/(f − n)|
 *        | 0        0       −1                0          |
 *
 * so that a point at depth z in front of the camera lands at normalised x
 * (fx·x/z + cx)·2/W − 1, the pixel the vision code computes, and likewise y
 * with the image's downward rows (a test checks every corner to a pixel).
 *
 * THE PIECE. A glTF scan is y-up with its front facing +z, centred on its
 * footprint and standing on y = 0 (display/engine/pieces.ts). The planner's
 * box (camera.ts, Placement) has its width along x, its depth along y and its
 * front looking along −y before it turns, then turns by θ about the vertical
 * and stands at (x, y). So glTF x → world x, glTF up → world up (s = upSign),
 * glTF front +z → world −y; for this to stay a rotation, not a mirror, when
 * up is −z, x follows the sign too:
 *
 *        | s  0  0 |
 *   M =  | 0  0 −1 |        then  world = T(x, y, 0) · Rz(θ) · M · glTF.
 *        | 0  s  0 |
 *
 * det M = s·s = 1 for both signs, so the scan is never drawn mirrored.
 *
 * Matrices here are returned column-major, the order WebGL and three.js store.
 */

/** A 4×4 matrix, column-major (WebGL's order). */
export type Mat4 = number[];

/** Writes a matrix given row by row into column-major order. */
export function fromRows(rows: readonly (readonly number[])[]): Mat4 {
  const out: number[] = [];
  for (let column = 0; column < 4; column += 1) for (let row = 0; row < 4; row += 1) out.push(rows[row]![column]!);
  return out;
}

/** World → OpenGL camera: V = D·[R | t], D = diag(1, −1, −1). */
export function viewMatrix({ R, t }: Pose): Mat4 {
  return fromRows([
    [R[0], R[1], R[2], t[0]],
    [-R[3], -R[4], -R[5], -t[1]],
    [-R[6], -R[7], -R[8], -t[2]],
    [0, 0, 0, 1],
  ]);
}

/** OpenGL projection from intrinsics K, for a W × H image with its origin at the top-left. */
export function projectionFromIntrinsics(K: Mat3, width: number, height: number, near = 0.05, far = 60): Mat4 {
  const [fx, , cx, , fy, cy] = K;
  return fromRows([
    [(2 * fx) / width, 0, 1 - (2 * cx) / width, 0],
    [0, (2 * fy) / height, (2 * cy) / height - 1, 0],
    [0, 0, -(far + near) / (far - near), (-2 * far * near) / (far - near)],
    [0, 0, -1, 0],
  ]);
}

/** glTF piece → world: T(x, y, 0) · Rz(θ) · M (see above). */
export function pieceMatrix(placement: Pick<Placement, "x" | "y" | "rotation">, up: 1 | -1): Mat4 {
  const c = Math.cos(placement.rotation);
  const s = Math.sin(placement.rotation);
  // Rz(θ) · M, multiplied out: the columns are where glTF's x, y and z axes go.
  return fromRows([
    [c * up, 0, s, placement.x],
    [s * up, 0, -c, placement.y],
    [0, up, 0, 0],
    [0, 0, 0, 1],
  ]);
}

/** A column-major 4×4 matrix times (x, y, z, w). */
export function transform4(m: Mat4, [x, y, z]: Vec3, w = 1): [number, number, number, number] {
  return [
    m[0]! * x + m[4]! * y + m[8]! * z + m[12]! * w,
    m[1]! * x + m[5]! * y + m[9]! * z + m[13]! * w,
    m[2]! * x + m[6]! * y + m[10]! * z + m[14]! * w,
    m[3]! * x + m[7]! * y + m[11]! * z + m[15]! * w,
  ];
}

/** Where WebGL would draw a world point, in image pixels (top-left origin); null behind the camera. */
export function glPixel(view: Mat4, projection: Mat4, point: Vec3, width: number, height: number): [number, number] | null {
  const eye = transform4(view, point);
  if (eye[2] >= 0) return null; // OpenGL's camera looks along −z.
  const clip = transform4(projection, [eye[0], eye[1], eye[2]], eye[3]);
  const ndcX = clip[0] / clip[3];
  const ndcY = clip[1] / clip[3];
  return [((ndcX + 1) / 2) * width, ((1 - ndcY) / 2) * height];
}
