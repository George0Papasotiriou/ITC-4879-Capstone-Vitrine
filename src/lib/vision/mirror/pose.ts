/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The head's pose from face landmarks: a weak-perspective start and a robust Levenberg–Marquardt refinement (perspective-n-point).
 */

import type { Point2 } from "@/lib/vision/camera";
import { add3, cross3, mulMat3, mulMat3Vec, norm3, normalize3, rotationFromVector, scale3, solveLinear, sub3, type Mat3, type Vec3 } from "@/lib/vision/linalg";

/**
 * docs/adr/065 — a student-designed algorithm (rubric row 31).
 *
 * THE PROBLEM (perspective-n-point). The landmarker finds where n points of
 * a face are in the picture, u_i. The average face (face-model.ts) says
 * where the same points are on a head, X_i, in millimetres. The pose is the
 * rotation R and translation t that carry the head into the camera's frame:
 *
 *   u_i ≈ π(K·(R·X_i + t)),   π(x, y, z) = (x/z, y/z)
 *
 * with K the camera's intrinsics (focal length f, centre c). We look for the
 * R and t that make the reprojection error Σ‖u_i − π(…)‖² smallest.
 *
 * 1. A START WITHOUT A GUESS (weak perspective). A face is small beside its
 *    distance, so every point is at nearly the same depth Z̄ and the camera
 *    nearly scales: x̃_i ≈ s·r₁·X̃_i, ỹ_i ≈ s·r₂·X̃_i (tildes: centred on the
 *    centroid; x, y: image points in normalised coordinates (u − c)/f; r₁, r₂
 *    the first two rows of R; s = 1/Z̄). Both rows come from one linear
 *    least-squares problem, (Σ X̃X̃ᵀ)·a = Σ x̃X̃, then are made orthonormal
 *    by the symmetric rule (r₁ ± r₂ are orthogonal when both are unit), and
 *    r₃ = r₁ × r₂. This is the scaled-orthographic step of POSIT
 *    (DeMenthon and Davis, 1995), without its iterations.
 *
 * 2. REFINEMENT (Levenberg–Marquardt on the full perspective model). The
 *    unknowns are a small rotation ω (applied as R ← exp([ω]×)·R, Rodrigues)
 *    and a step in t: six numbers. For a point P = R·X + t the projection's
 *    derivatives are
 *
 *      ∂π/∂P = [[1/Z, 0, −X/Z²], [0, 1/Z, −Y/Z²]],
 *      ∂P/∂ω = −[R·X]×,   ∂P/∂t = I,
 *
 *    and each step solves (JᵀWJ + λ·diag(JᵀWJ))·δ = −JᵀW·r: Gauss–Newton when
 *    λ is small, gradient descent when it is large; λ shrinks after a step
 *    that lowered the error and grows after one that did not.
 *
 * 3. ROBUSTNESS (Huber weights, re-estimated each iteration). A face is not
 *    the average face, and a landmark can be off. Each point's residual is
 *    compared with k = 1.345·σ, σ the median absolute residual × 1.4826 (a
 *    standard deviation that one wild point cannot inflate); points beyond k
 *    count with weight k/|r| instead of 1, so they pull linearly rather than
 *    quadratically.
 *
 * Frames: the camera looks along +z with x right and y down (the picture's
 * axes). The face model has y up and z out of the face, so a face looking
 * straight at the camera has R = FRONTAL = diag(1, −1, −1).
 */

export type Intrinsics = { f: number; cx: number; cy: number };
export type HeadPose = { R: Mat3; t: Vec3 };
export type PoseSolution = HeadPose & { rmsPx: number; iterations: number };

/** A face looking straight into the camera: the model's y (up) and z (out of the face) point against the camera's y (down) and z (forward). */
export const FRONTAL: Mat3 = [1, 0, 0, 0, -1, 0, 0, 0, -1];

/**
 * Most webcams and phones' front cameras see about 60–70° across their long
 * side. A wrong guess changes how far away the face seems, not where it is
 * in the picture, and every piece is drawn through the same camera, so they
 * stay on the face either way (ADR-065).
 */
export const DEFAULT_FIELD_OF_VIEW = 63;

/** Intrinsics for a frame: square pixels, the centre in the middle, the field of view across the long side. */
export function frameIntrinsics(width: number, height: number, fieldOfViewDegrees = DEFAULT_FIELD_OF_VIEW): Intrinsics {
  const long = Math.max(width, height);
  return { f: long / 2 / Math.tan((fieldOfViewDegrees * Math.PI) / 360), cx: width / 2, cy: height / 2 };
}

/** A head point (millimetres, model frame) in the camera's frame. */
export const toCamera = ({ R, t }: HeadPose, X: Vec3): Vec3 => add3(mulMat3Vec(R, X), t);

/** Where a camera-frame point appears in the picture; null behind the camera. */
export function projectCamera(K: Intrinsics, P: Vec3): Point2 | null {
  if (P[2] <= 1e-6) return null;
  return [K.cx + (K.f * P[0]) / P[2], K.cy + (K.f * P[1]) / P[2]];
}

export const project = (K: Intrinsics, pose: HeadPose, X: Vec3): Point2 | null => projectCamera(K, toCamera(pose, X));

/** 1. The weak-perspective start (see above). Null with fewer than four points or a degenerate set. */
export function weakPerspectivePose(image: readonly Point2[], model: readonly Vec3[], K: Intrinsics): HeadPose | null {
  const n = Math.min(image.length, model.length);
  if (n < 4) return null;
  const xs = image.slice(0, n).map(([u, v]) => [(u - K.cx) / K.f, (v - K.cy) / K.f] as const);
  const meanImage = xs.reduce((sum, [x, y]) => [sum[0] + x / n, sum[1] + y / n] as [number, number], [0, 0] as [number, number]);
  const meanModel = model.slice(0, n).reduce((sum, X) => add3(sum, scale3(X, 1 / n)), [0, 0, 0] as Vec3);

  // Normal equations of the two least-squares problems: A·a = bx, A·b = by.
  const A = new Array<number>(9).fill(0);
  const bx = [0, 0, 0];
  const by = [0, 0, 0];
  for (let i = 0; i < n; i += 1) {
    const X = sub3(model[i]!, meanModel);
    const x = xs[i]![0] - meanImage[0];
    const y = xs[i]![1] - meanImage[1];
    for (let r = 0; r < 3; r += 1) {
      for (let c = 0; c < 3; c += 1) A[r * 3 + c]! += X[r]! * X[c]!;
      bx[r]! += x * X[r]!;
      by[r]! += y * X[r]!;
    }
  }
  const a = solveLinear(A, bx, 3);
  const b = solveLinear(A, by, 3);
  if (a === null || b === null) return null;
  const sa = norm3(a as Vec3);
  const sb = norm3(b as Vec3);
  if (sa < 1e-12 || sb < 1e-12) return null;
  const r1 = scale3(a as Vec3, 1 / sa);
  const r2 = scale3(b as Vec3, 1 / sb);
  // The symmetric orthogonalisation: (r₁ + r₂) ⟂ (r₁ − r₂) for unit vectors.
  const sum = add3(r1, r2);
  const difference = sub3(r1, r2);
  if (norm3(sum) < 1e-9 || norm3(difference) < 1e-9) return null;
  const c = normalize3(sum);
  const d = normalize3(difference);
  const row1 = scale3(add3(c, d), Math.SQRT1_2);
  const row2 = scale3(sub3(c, d), Math.SQRT1_2);
  const row3 = cross3(row1, row2);
  const R: Mat3 = [...row1, ...row2, ...row3];
  // The centroid sits at depth 1/s, on the ray through the image centroid.
  const depth = 2 / (sa + sb);
  const centre = mulMat3Vec(R, meanModel);
  return { R, t: [depth * meanImage[0] - centre[0], depth * meanImage[1] - centre[1], depth - centre[2]] };
}

export type RefineOptions = { maxIterations?: number; robust?: boolean };

/** 2 and 3. Levenberg–Marquardt from a start, with Huber weights when `robust`. */
export function refinePose(image: readonly Point2[], model: readonly Vec3[], K: Intrinsics, start: HeadPose, { maxIterations = 30, robust = true }: RefineOptions = {}): PoseSolution {
  const n = Math.min(image.length, model.length);
  const observed = image.slice(0, n).map(([u, v]) => [(u - K.cx) / K.f, (v - K.cy) / K.f] as const);

  // The residuals of a pose, in normalised image units; null when a point falls behind the camera.
  const residuals = (pose: HeadPose): number[] | null => {
    const r = new Array<number>(2 * n);
    for (let i = 0; i < n; i += 1) {
      const P = toCamera(pose, model[i]!);
      if (P[2] <= 1e-6) return null;
      r[2 * i] = P[0] / P[2] - observed[i]![0];
      r[2 * i + 1] = P[1] / P[2] - observed[i]![1];
    }
    return r;
  };
  const cost = (r: readonly number[], w: readonly number[]) => {
    let total = 0;
    for (let i = 0; i < n; i += 1) total += w[i]! * (r[2 * i]! ** 2 + r[2 * i + 1]! ** 2);
    return total;
  };
  const huber = (r: readonly number[]): number[] => {
    const sizes = Array.from({ length: n }, (_, i) => Math.hypot(r[2 * i]!, r[2 * i + 1]!));
    if (!robust) return sizes.map(() => 1);
    const sorted = [...sizes].sort((p, q) => p - q);
    const sigma = 1.4826 * sorted[Math.floor(n / 2)]!;
    const k = 1.345 * Math.max(sigma, 1e-9);
    return sizes.map((size) => (size <= k ? 1 : k / size));
  };

  let pose: HeadPose = start;
  let r = residuals(pose);
  if (r === null) return { ...start, rmsPx: Number.POSITIVE_INFINITY, iterations: 0 };
  let lambda = 1e-3;
  let iterations = 0;
  for (; iterations < maxIterations; iterations += 1) {
    const w = huber(r);
    const current = cost(r, w);
    // JᵀWJ (6×6) and JᵀW·r (6), point by point.
    const H = new Array<number>(36).fill(0);
    const g = new Array<number>(6).fill(0);
    for (let i = 0; i < n; i += 1) {
      const RX = mulMat3Vec(pose.R, model[i]!);
      const P = add3(RX, pose.t);
      const iz = 1 / P[2];
      const du = [iz, 0, -P[0] * iz * iz];
      const dv = [0, iz, -P[1] * iz * iz];
      // ∂P/∂ω = −[RX]× = [[0, z, −y], [−z, 0, x], [y, −x, 0]] for RX = (x, y, z); ∂P/∂t = I.
      const dP = [
        [0, RX[2], -RX[1], 1, 0, 0],
        [-RX[2], 0, RX[0], 0, 1, 0],
        [RX[1], -RX[0], 0, 0, 0, 1],
      ];
      const ju = [0, 1, 2, 3, 4, 5].map((k) => du[0]! * dP[0]![k]! + du[1]! * dP[1]![k]! + du[2]! * dP[2]![k]!);
      const jv = [0, 1, 2, 3, 4, 5].map((k) => dv[0]! * dP[0]![k]! + dv[1]! * dP[1]![k]! + dv[2]! * dP[2]![k]!);
      for (let a = 0; a < 6; a += 1) {
        g[a]! += w[i]! * (ju[a]! * r[2 * i]! + jv[a]! * r[2 * i + 1]!);
        for (let b = 0; b < 6; b += 1) H[a * 6 + b]! += w[i]! * (ju[a]! * ju[b]! + jv[a]! * jv[b]!);
      }
    }
    let accepted = false;
    for (let attempt = 0; attempt < 8 && !accepted; attempt += 1) {
      const damped = H.map((value, index) => (index % 7 === 0 ? value * (1 + lambda) + 1e-12 : value));
      const step = solveLinear(damped, g.map((value) => -value), 6);
      if (step === null) {
        lambda *= 10;
        continue;
      }
      const candidate: HeadPose = {
        R: mulMat3(rotationFromVector([step[0]!, step[1]!, step[2]!]), pose.R),
        t: add3(pose.t, [step[3]!, step[4]!, step[5]!]),
      };
      const next = residuals(candidate);
      if (next !== null && cost(next, w) < current) {
        pose = candidate;
        r = next;
        lambda = Math.max(lambda / 10, 1e-9);
        accepted = true;
        if (Math.hypot(...step) < 1e-10) iterations = maxIterations;
      } else {
        lambda *= 10;
      }
    }
    if (!accepted) break;
  }
  let squared = 0;
  for (let i = 0; i < n; i += 1) squared += r[2 * i]! ** 2 + r[2 * i + 1]! ** 2;
  return { ...pose, rmsPx: Math.sqrt(squared / n) * K.f, iterations: Math.min(iterations + 1, maxIterations) };
}

/**
 * The pose for a frame. While tracking, the last frame's pose is a better
 * start than the weak-perspective one; if it ends badly (the face jumped),
 * the weak-perspective start is tried too and the better of the two kept.
 */
export function solveHeadPose(image: readonly Point2[], model: readonly Vec3[], K: Intrinsics, previous?: HeadPose | null, options: RefineOptions = {}): PoseSolution | null {
  const fresh = (): PoseSolution | null => {
    const start = weakPerspectivePose(image, model, K);
    return start === null ? null : refinePose(image, model, K, start, options);
  };
  if (previous === undefined || previous === null) return fresh();
  const tracked = refinePose(image, model, K, previous, options);
  if (tracked.rmsPx < 6) return tracked;
  const started = fresh();
  return started !== null && started.rmsPx < tracked.rmsPx ? started : tracked;
}

/**
 * The head's turn in degrees, about the camera's own axes, relative to
 * looking straight at it: G = R·FRONTAL = R_z(roll)·R_x(pitch)·R_y(yaw).
 * Yaw turns the face towards the picture's left (positive) or right;
 * pitch tips it down (positive) or up; roll tilts it clockwise on screen.
 */
export function headAngles(R: Mat3): { yaw: number; pitch: number; roll: number } {
  const G = mulMat3(R, FRONTAL);
  const degrees = (radians: number) => (radians * 180) / Math.PI;
  return {
    yaw: degrees(Math.atan2(-G[6], G[8])),
    pitch: degrees(Math.asin(Math.min(1, Math.max(-1, G[7])))),
    roll: degrees(Math.atan2(-G[1], G[4])),
  };
}
