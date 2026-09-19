/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Single-view camera geometry: intrinsics, homography, pose from an A4 sheet and floor projection.
 */

import {
  add3,
  columns3,
  cross3,
  dot3,
  fromColumns3,
  identity3,
  invert3,
  mulMat3,
  mulMat3Vec,
  nearestRotation,
  norm3,
  rotationFromVector,
  solveLinear,
  scale3,
  sub3,
  symmetricEigen,
  transpose3,
  column,
  type Mat3,
  type Vec3,
} from "@/lib/vision/linalg";

/**
 * Place in my room, geometry first (A4, docs/PLAN.md 2.6).
 *
 * From one photograph and four taps on a sheet of A4 paper lying on the floor,
 * recover where the camera was, so a product can be drawn into the photograph
 * at its true size. Three steps: intrinsics, homography, pose.
 *
 * COORDINATES. The floor is the world plane Z = 0, measured in metres, with the
 * sheet's first tapped corner at the origin and its edges along X and Y. A world
 * point X maps to camera coordinates x = R·X + t and to pixels by the pinhole
 * model: p ≃ K·x (equal up to scale; divide by the third coordinate).
 */

/* -------------------------------------------------------------------------- */
/* 1. Intrinsics                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Field of view across the longer image side when EXIF has no 35 mm focal
 * length: 69° is a 26 mm-equivalent lens, the main camera of most current
 * phones (2·atan(18 / 26)). The plan's first guess was 65°; phones moved wider.
 */
export const DEFAULT_FOV_DEGREES = 69;

/**
 * Focal length in pixels from the 35 mm-equivalent focal length in EXIF.
 *
 * A 35 mm film frame is 36 mm wide. A lens of focal length f35 on it sees the
 * same angle as this camera, so the ratio of focal length to frame width is the
 * same: f_px / W = f35 / 36, with W the longer image side in pixels.
 *
 *   f_px = f35 / 36 · W
 */
export function focalFrom35mm(focal35: number, width: number, height: number): number {
  if (!(focal35 > 0)) throw new RangeError("35 mm focal length must be positive");
  return (focal35 / 36) * Math.max(width, height);
}

/**
 * Focal length from the field of view across an image side of `side` pixels,
 * for photos without EXIF: half the side subtends half the angle, so
 * tan(fov/2) = (side/2) / f.
 */
export function focalFromFov(fovDegrees: number, side: number): number {
  const half = (fovDegrees * Math.PI) / 360;
  if (!(half > 0 && half < Math.PI / 2)) throw new RangeError("Field of view must be between 0 and 180 degrees");
  return side / 2 / Math.tan(half);
}

/** K = [[f, 0, cx], [0, f, cy], [0, 0, 1]], principal point at the image centre, square pixels. */
export function intrinsics(focal: number, width: number, height: number): Mat3 {
  return [focal, 0, width / 2, 0, focal, height / 2, 0, 0, 1];
}

/** Vertical field of view for a matched rendering camera: 2·atan(H / 2f), in degrees. */
export function verticalFovDegrees(focal: number, height: number): number {
  return (2 * Math.atan(height / (2 * focal)) * 180) / Math.PI;
}

/* -------------------------------------------------------------------------- */
/* 2. Homography by the normalised Direct Linear Transform                    */
/* -------------------------------------------------------------------------- */

export type Point2 = [number, number];

/**
 * A homography H maps points of one plane to another in homogeneous
 * coordinates: p' ≃ H·p. Here it maps floor coordinates (metres) to pixels.
 *
 * DLT (Hartley & Zisserman, §4.1). Writing h for the nine entries of H, each
 * correspondence (x, y) → (u, v) gives two linear equations, from
 * p' × (H·p) = 0:
 *
 *   [ -x  -y  -1   0   0   0   u·x  u·y  u ] · h = 0
 *   [  0   0   0  -x  -y  -1   v·x  v·y  v ] · h = 0
 *
 * Four correspondences give eight equations for eight degrees of freedom (H is
 * defined up to scale). With n points, stack them into A (2n × 9) and take the
 * h with ‖h‖ = 1 that minimises ‖A·h‖: the eigenvector of AᵀA with the
 * smallest eigenvalue.
 *
 * NORMALISATION (§4.4). Pixel coordinates are in the thousands and metre
 * coordinates below one, so AᵀA mixes entries of wildly different size and the
 * solution is badly conditioned. First translate each point set so its centroid
 * is at the origin and scale it so the mean distance from the origin is √2
 * (transforms T and T'), solve for H̃ between the normalised points, then undo:
 *
 *   H = T'⁻¹ · H̃ · T
 */
export function normalisingTransform(points: readonly Point2[]): Mat3 {
  const n = points.length;
  const cx = points.reduce((sum, p) => sum + p[0], 0) / n;
  const cy = points.reduce((sum, p) => sum + p[1], 0) / n;
  const meanDistance = points.reduce((sum, p) => sum + Math.hypot(p[0] - cx, p[1] - cy), 0) / n;
  if (meanDistance < 1e-12) throw new RangeError("Points are coincident");
  const s = Math.SQRT2 / meanDistance;
  return [s, 0, -s * cx, 0, s, -s * cy, 0, 0, 1];
}

function applyTransform(m: Mat3, p: Point2): Point2 {
  const w = m[6] * p[0] + m[7] * p[1] + m[8];
  return [(m[0] * p[0] + m[1] * p[1] + m[2]) / w, (m[3] * p[0] + m[4] * p[1] + m[5]) / w];
}

export const applyHomography = applyTransform;

/** Twice the signed area of a triangle; zero when the three points are collinear. */
function area2(a: Point2, b: Point2, c: Point2): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

/**
 * `normalise: false` exists only so the tests and evaluation can show what the
 * normalisation buys; the app always normalises.
 */
export function homographyDLT(source: readonly Point2[], target: readonly Point2[], { normalise = true } = {}): Mat3 {
  if (source.length !== target.length || source.length < 4) {
    throw new RangeError("A homography needs at least four matching point pairs");
  }
  // Three collinear points among four make the system degenerate.
  if (source.length === 4) {
    const [a, b, c, d] = source as [Point2, Point2, Point2, Point2];
    const scaleSq = Math.max(...source.map((p) => p[0] * p[0] + p[1] * p[1]), 1e-12);
    const minArea = Math.min(Math.abs(area2(a, b, c)), Math.abs(area2(a, b, d)), Math.abs(area2(a, c, d)), Math.abs(area2(b, c, d)));
    if (minArea < 1e-9 * scaleSq) throw new RangeError("Three of the four points are collinear");
  }

  const T = normalise ? normalisingTransform(source) : identity3();
  const Tp = normalise ? normalisingTransform(target) : identity3();
  const src = source.map((p) => applyTransform(T, p));
  const dst = target.map((p) => applyTransform(Tp, p));

  // AᵀA accumulated directly (9 × 9), without forming A.
  const ata = new Array<number>(81).fill(0);
  const addRow = (row: number[]) => {
    for (let i = 0; i < 9; i += 1) for (let j = 0; j < 9; j += 1) ata[i * 9 + j]! += row[i]! * row[j]!;
  };
  src.forEach(([x, y], k) => {
    const [u, v] = dst[k]!;
    addRow([-x, -y, -1, 0, 0, 0, u * x, u * y, u]);
    addRow([0, 0, 0, -x, -y, -1, v * x, v * y, v]);
  });

  const { vectors } = symmetricEigen(ata, 9);
  const h = column(vectors, 9, 0) as Mat3;
  const H = mulMat3(invert3(Tp), mulMat3(h, T));
  const w = H[8];
  return (Math.abs(w) > 1e-15 ? H.map((value) => value / w) : H) as Mat3;
}

/** Root-mean-square distance, in pixels, between mapped source points and their targets. */
export function reprojectionError(H: Mat3, source: readonly Point2[], target: readonly Point2[]): number {
  let total = 0;
  source.forEach((p, k) => {
    const q = applyTransform(H, p);
    total += (q[0] - target[k]![0]) ** 2 + (q[1] - target[k]![1]) ** 2;
  });
  return Math.sqrt(total / source.length);
}

/* -------------------------------------------------------------------------- */
/* 3. Camera pose from the floor homography                                   */
/* -------------------------------------------------------------------------- */

export type Pose = { R: Mat3; t: Vec3 };

/**
 * For points on the plane Z = 0 the projection drops the third column of R:
 *
 *   p ≃ K · [r₁ r₂ r₃ t] · (X, Y, 0, 1)ᵀ = K · [r₁ r₂ t] · (X, Y, 1)ᵀ
 *
 * so the homography is H ≃ K·[r₁ r₂ t], and M = K⁻¹·H = λ⁻¹·[r₁ r₂ t] for an
 * unknown scale. Rotation columns have unit length, which fixes the scale:
 *
 *   λ = 1 / ‖K⁻¹h₁‖,  r₁ = λ·K⁻¹h₁,  r₂ = λ·K⁻¹h₂,  r₃ = r₁ × r₂,  t = λ·K⁻¹h₃
 *
 * With real taps ‖K⁻¹h₁‖ and ‖K⁻¹h₂‖ differ slightly; their mean is used, which
 * spreads the error over both axes instead of loading it onto one.
 *
 * H is only known up to sign as well. The floor is in front of the camera, so
 * the sign is chosen to make the sheet's origin have positive depth (t_z > 0).
 *
 * Finally [r₁ r₂ r₃] is not exactly a rotation when the taps are noisy; the
 * nearest true rotation (SVD) replaces it. Because the sheet's size is known in
 * metres, t comes out in metres: the pose is metric, and so is everything drawn
 * with it.
 */
export function poseFromHomography(K: Mat3, H: Mat3): Pose {
  const M = mulMat3(invert3(K), H);
  const [m1, m2, m3] = columns3(M);
  let lambda = 2 / (norm3(m1) + norm3(m2));
  if (m3[2] * lambda < 0) lambda = -lambda;

  const r1 = scale3(m1, lambda);
  const r2 = scale3(m2, lambda);
  const r3 = cross3(r1, r2);
  const R = nearestRotation(fromColumns3(r1, r2, r3));
  return { R, t: scale3(m3, lambda) };
}

/**
 * Maximum-likelihood refinement of the pose (planar PnP by Levenberg–Marquardt).
 *
 * The DLT homography has eight degrees of freedom and fits four taps exactly,
 * noise included; it never uses what we know about the camera. A camera with
 * known K looking at a known rectangle has only six (rotation and position), so
 * the eight tap coordinates over-determine it and the noise can be averaged out.
 * If tap errors are independent and Gaussian, the most likely pose is the one
 * that minimises the squared reprojection error
 *
 *   E(R, t) = Σᵢ ‖ π(K·(R·Xᵢ + t)) − pᵢ ‖²
 *
 * Parameters: a rotation vector w applied on top of the current rotation,
 * R = Rodrigues(w)·R₀, plus t. Each step linearises the residuals r with the
 * Jacobian J (central differences) and solves
 *
 *   (JᵀJ + μ·diag(JᵀJ)) · δ = −Jᵀr
 *
 * Small μ is a Gauss–Newton step, large μ a short gradient step; μ shrinks after
 * a step that lowers E and grows after one that does not. The DLT pose is an
 * excellent starting point, so a few iterations suffice.
 */
export function refinePose(
  K: Mat3,
  world: readonly Point2[],
  image: readonly Point2[],
  initial: Pose,
  { iterations = 20 } = {},
): { pose: Pose; rmsBefore: number; rmsAfter: number } {
  const residuals = (pose: Pose): number[] | null => {
    const out: number[] = [];
    for (let i = 0; i < world.length; i += 1) {
      const p = projectPoint(K, pose, [world[i]![0], world[i]![1], 0]);
      if (p === null) return null;
      out.push(p[0] - image[i]![0], p[1] - image[i]![1]);
    }
    return out;
  };
  const energy = (r: number[]) => r.reduce((sum, value) => sum + value * value, 0);
  const apply = (pose: Pose, delta: readonly number[]): Pose => ({
    R: mulMat3(rotationFromVector([delta[0]!, delta[1]!, delta[2]!]), pose.R),
    t: [pose.t[0] + delta[3]!, pose.t[1] + delta[4]!, pose.t[2] + delta[5]!],
  });

  let pose = initial;
  let r = residuals(pose);
  if (r === null) return { pose: initial, rmsBefore: Infinity, rmsAfter: Infinity };
  const rmsBefore = Math.sqrt(energy(r) / world.length);
  let mu = 1e-3;

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const current = r;
    // Jacobian by central differences: 1e-6 rad and 1e-6 m are far below any meaningful change.
    const h = 1e-6;
    const J: number[][] = [];
    for (let k = 0; k < 6; k += 1) {
      const step = [0, 0, 0, 0, 0, 0];
      step[k] = h;
      const plus = residuals(apply(pose, step));
      step[k] = -h;
      const minus = residuals(apply(pose, step));
      if (plus === null || minus === null) return { pose, rmsBefore, rmsAfter: Math.sqrt(energy(current) / world.length) };
      J.push(plus.map((value, i) => (value - minus[i]!) / (2 * h)));
    }
    const JtJ = new Array<number>(36).fill(0);
    const Jtr = new Array<number>(6).fill(0);
    for (let a = 0; a < 6; a += 1) {
      for (let b = 0; b < 6; b += 1) JtJ[a * 6 + b] = J[a]!.reduce((sum, value, i) => sum + value * J[b]![i]!, 0);
      Jtr[a] = J[a]!.reduce((sum, value, i) => sum + value * current[i]!, 0);
    }

    let improved = false;
    for (let attempt = 0; attempt < 10 && !improved; attempt += 1) {
      const damped = JtJ.map((value, index) => (index % 7 === 0 ? value * (1 + mu) + 1e-12 : value));
      const delta = solveLinear(damped, Jtr.map((value) => -value), 6);
      if (delta === null) {
        mu *= 10;
        continue;
      }
      const candidate = apply(pose, delta);
      const next = residuals(candidate);
      if (next !== null && energy(next) < energy(current)) {
        pose = { R: nearestRotation(candidate.R), t: candidate.t };
        r = residuals(pose) ?? next;
        mu = Math.max(mu / 10, 1e-9);
        improved = true;
      } else {
        mu *= 10;
      }
    }
    if (!improved || energy(current) - energy(r) < 1e-12 * Math.max(1, energy(current))) break;
  }
  return { pose, rmsBefore, rmsAfter: Math.sqrt(energy(r) / world.length) };
}

/* -------------------------------------------------------------------------- */
/* Using the pose                                                             */
/* -------------------------------------------------------------------------- */

export function projectPoint(K: Mat3, { R, t }: Pose, X: Vec3): Point2 | null {
  const camera = add3(mulMat3Vec(R, X), t);
  if (camera[2] <= 1e-9) return null; // behind the camera
  const p = mulMat3Vec(K, camera);
  return [p[0] / p[2], p[1] / p[2]];
}

/** The camera's position in world coordinates: C = −Rᵀ·t. */
export function cameraCentre({ R, t }: Pose): Vec3 {
  return scale3(mulMat3Vec(transpose3(R), t), -1);
}

/**
 * The floor point under a pixel, for dragging a product: cast the ray from the
 * camera centre C through the pixel, d = Rᵀ·K⁻¹·(u, v, 1), and intersect it with
 * Z = 0 at C + s·d, s = −C_z / d_z. Null when the ray points away from the floor
 * (at or above the horizon).
 */
export function floorPointAt(K: Mat3, pose: Pose, pixel: Point2): [number, number] | null {
  const C = cameraCentre(pose);
  const d = mulMat3Vec(transpose3(pose.R), mulMat3Vec(invert3(K), [pixel[0], pixel[1], 1]));
  if (Math.abs(d[2]) < 1e-12) return null;
  const s = -C[2] / d[2];
  if (s <= 0) return null;
  const X = add3(C, scale3(d, s));
  return [X[0], X[1]];
}

/**
 * Which way is up. The floor normal is ±Z; up is the side the camera is on,
 * so the sign of the camera centre's Z decides it.
 */
export function upSign(pose: Pose): 1 | -1 {
  return cameraCentre(pose)[2] >= 0 ? 1 : -1;
}

export type Placement = {
  /** Floor position of the product's footprint centre, metres. */
  x: number;
  y: number;
  /** Rotation about the vertical axis, radians. */
  rotation: number;
  /** Product size in metres: width, depth, height. */
  width: number;
  depth: number;
  height: number;
};

/** The eight corners of the product's bounding box in world coordinates: four on the floor, then four on top. */
export function boxCorners(placement: Placement, up: 1 | -1): Vec3[] {
  const { x, y, rotation, width, depth, height } = placement;
  const c = Math.cos(rotation);
  const s = Math.sin(rotation);
  const footprint: [number, number][] = [
    [-width / 2, -depth / 2],
    [width / 2, -depth / 2],
    [width / 2, depth / 2],
    [-width / 2, depth / 2],
  ];
  const floor = footprint.map(([dx, dy]) => [x + c * dx - s * dy, y + s * dx + c * dy, 0] as Vec3);
  return [...floor, ...floor.map((p) => [p[0], p[1], up * height] as Vec3)];
}

/**
 * The on-screen height, in pixels, of a vertical segment of `height` metres
 * standing on the floor at (x, y). The quantity evaluation E4 compares: a
 * correct pose makes a 40 cm box exactly as tall as a real 40 cm box at the
 * same spot.
 */
export function projectedHeight(K: Mat3, pose: Pose, x: number, y: number, height: number): number | null {
  const bottom = projectPoint(K, pose, [x, y, 0]);
  const top = projectPoint(K, pose, [x, y, upSign(pose) * height]);
  if (bottom === null || top === null) return null;
  return Math.hypot(top[0] - bottom[0], top[1] - bottom[1]);
}

/* -------------------------------------------------------------------------- */
/* Tap order                                                                  */
/* -------------------------------------------------------------------------- */

export type Sheet = { width: number; length: number };

export const A4_SHEET: Sheet = { width: 0.21, length: 0.297 };

/**
 * Four taps in any order → the same four points in a fixed order: counter-
 * clockwise around their centroid as seen on screen, starting from the corner
 * lowest in the photo (nearest the camera). Returns null for a quadrilateral
 * that is not convex, which no photo of a flat rectangle can produce.
 */
export function orderTaps(taps: readonly Point2[]): [Point2, Point2, Point2, Point2] | null {
  if (taps.length !== 4) throw new RangeError("Tap exactly four corners");
  const cx = taps.reduce((sum, p) => sum + p[0], 0) / 4;
  const cy = taps.reduce((sum, p) => sum + p[1], 0) / 4;
  // Screen y grows downwards; atan2 on (−dy) gives the usual counter-clockwise angle.
  const sorted = [...taps].sort((a, b) => Math.atan2(-(a[1] - cy), a[0] - cx) - Math.atan2(-(b[1] - cy), b[0] - cx));
  const start = sorted.reduce((best, p, i) => (p[1] > sorted[best]![1] ? i : best), 0);
  const image = [0, 1, 2, 3].map((k) => sorted[(start + k) % 4]!) as [Point2, Point2, Point2, Point2];
  const turns = [0, 1, 2, 3].map((i) => area2(image[i]!, image[(i + 1) % 4]!, image[(i + 2) % 4]!));
  const convex = turns.every((turn) => turn > 0) || turns.every((turn) => turn < 0);
  return convex ? image : null;
}

/** The sheet's corners on the floor, with its long side along the first image edge or the second. */
export function sheetWorld(sheet: Sheet, longSideFirst: boolean): Point2[] {
  const a = longSideFirst ? sheet.length : sheet.width;
  const b = longSideFirst ? sheet.width : sheet.length;
  return [
    [0, 0],
    [a, 0],
    [a, b],
    [0, b],
  ];
}

export type SheetSolution = {
  /** Taps in the order matched to `world`. */
  image: Point2[];
  world: Point2[];
  pose: Pose;
  /** Root-mean-square reprojection error of the refined pose, pixels: how well a real camera explains the taps. */
  rms: number;
  /** The same error for the plain DLT pose, kept for evaluation. */
  rmsDlt: number;
  /**
   * True when the other labelling of the sheet's sides fits almost as well
   * (less than twice the error). Small or distant sheets can be read either way;
   * the page then offers to turn the sheet, and the drawn grid shows which is right.
   */
  ambiguous: boolean;
  /** The solution with the sheet's sides the other way round. */
  alternative: Omit<SheetSolution, "alternative" | "ambiguous"> | null;
};

/**
 * The whole tap method: order the taps, then for both ways of labelling the
 * sheet's sides compute the DLT homography, the pose, and its refinement; keep
 * the labelling with the smaller reprojection error. Null when the taps cannot
 * be a rectangle on the floor.
 *
 * Why try both labellings: measuring edges on screen is unreliable, because
 * perspective shortens the edges that point away from the camera. With K known,
 * though, the photographed quadrilateral fixes the floor's orientation and so
 * the rectangle's true aspect ratio. Calling a 297 × 210 mm sheet 210 × 297
 * describes a rectangle no camera with this K could have photographed, and the
 * refined pose cannot fit the taps well.
 *
 * Measured on synthetic scenes (1 px tap noise, product 0.5–1 m from the
 * sheet): mean size error 13% with the DLT pose alone, 1.5% after refinement.
 */
export function solveSheet(K: Mat3, taps: readonly Point2[], sheet: Sheet = A4_SHEET, { refine = true } = {}): SheetSolution | null {
  const image = orderTaps(taps);
  if (image === null) return null;
  const candidates: Omit<SheetSolution, "alternative" | "ambiguous">[] = [];
  for (const longSideFirst of [true, false]) {
    const world = sheetWorld(sheet, longSideFirst);
    let H: Mat3;
    try {
      H = homographyDLT(world, image);
    } catch {
      return null;
    }
    const initial = poseFromHomography(K, H);
    const refined = refinePose(K, world, image, initial, { iterations: refine ? 20 : 0 });
    candidates.push({ image, world, pose: refined.pose, rms: refined.rmsAfter, rmsDlt: refined.rmsBefore });
  }
  candidates.sort((a, b) => a.rms - b.rms);
  const [best, other] = candidates as [Omit<SheetSolution, "alternative" | "ambiguous">, Omit<SheetSolution, "alternative" | "ambiguous">];
  if (!Number.isFinite(best.rms)) return null;
  const alternative = Number.isFinite(other.rms) ? other : null;
  // Exact taps fit the right labelling perfectly; allow a floor of 0.05 px so noise-free cases are never ambiguous.
  const ambiguous = alternative !== null && alternative.rms < 2 * Math.max(best.rms, 0.05);
  return { ...best, ambiguous, alternative };
}

/* -------------------------------------------------------------------------- */
/* Floor plane from 3D points (automatic mode): RANSAC                         */
/* -------------------------------------------------------------------------- */

export type Plane = { normal: Vec3; d: number };

/**
 * RANSAC (Fischler & Bolles, 1981) for the floor plane in a point cloud from a
 * depth map, where most points belong to walls, furniture and noise.
 *
 * Repeat: pick three random points, form the plane through them, count the
 * points within `threshold` of it. Keep the plane with the most inliers. The
 * number of trials needed to pick one all-inlier sample with probability p,
 * when a fraction w of the points are inliers, is
 *
 *   N = log(1 − p) / log(1 − w³)
 *
 * and is updated as better planes raise the best known w. Finally the plane is
 * refitted to all its inliers by least squares: through their centroid, with the
 * normal along the direction of least variance (the smallest eigenvector of
 * their covariance).
 *
 * RANSAC finds the biggest plane, which in a photo facing a wall can be the
 * wall. With `expectedNormal` (the camera's down direction, from the phone's
 * motion sensors or simply the image's down axis for an upright photo), planes
 * tilted more than `maxAngleDegrees` from it are never considered.
 *
 * SPEED. A depth map gives some 65,000 points, and counting all of them for
 * each of up to 2,000 trials is 130 million distance tests per plane — two
 * seconds on a phone's main thread for the six planes of a room. So each trial
 * is scored on a fixed random subset of `scoreSample` points, and only the
 * winner is counted in full. The share of inliers read off 4,096 points has a
 * binomial standard error of √(w(1 − w)/n) ≤ 0.8%, far below the difference
 * between a floor and anything that competes with it.
 */
export function fitPlaneRansac(
  points: readonly Vec3[],
  {
    threshold,
    confidence = 0.99,
    maxIterations = 2_000,
    random = Math.random,
    expectedNormal,
    maxAngleDegrees = 25,
    scoreSample = 4_096,
  }: {
    threshold: number;
    confidence?: number;
    maxIterations?: number;
    random?: () => number;
    expectedNormal?: Vec3;
    maxAngleDegrees?: number;
    scoreSample?: number;
  },
): { plane: Plane; inliers: number[]; iterations: number } | null {
  if (points.length < 3) return null;
  const minCosine = Math.cos((maxAngleDegrees * Math.PI) / 180);
  // The scoring subset: a partial Fisher–Yates shuffle, so every point is equally likely.
  let scored: readonly Vec3[] = points;
  if (points.length > scoreSample) {
    const order = Array.from(points.keys());
    for (let i = 0; i < scoreSample; i += 1) {
      const j = i + Math.floor(random() * (order.length - i));
      [order[i], order[j]] = [order[j]!, order[i]!];
    }
    scored = order.slice(0, scoreSample).map((index) => points[index]!);
  }
  let best: { plane: Plane; count: number } | null = null;
  let needed = maxIterations;
  let iterations = 0;

  while (iterations < Math.min(needed, maxIterations)) {
    iterations += 1;
    const i = Math.floor(random() * scored.length);
    const j = Math.floor(random() * scored.length);
    const k = Math.floor(random() * scored.length);
    if (i === j || j === k || i === k) continue;
    const a = scored[i]!;
    const normalRaw = cross3(sub3(scored[j]!, a), sub3(scored[k]!, a));
    const length = norm3(normalRaw);
    if (length < 1e-12) continue;
    const normal = scale3(normalRaw, 1 / length);
    // Gravity prior: a candidate tilted too far from the expected floor normal is a wall or a table edge, not the floor.
    if (expectedNormal !== undefined && Math.abs(dot3(normal, expectedNormal)) < minCosine) continue;
    const d = -dot3(normal, a);

    let count = 0;
    for (const p of scored) if (Math.abs(dot3(normal, p) + d) <= threshold) count += 1;
    if (best === null || count > best.count) {
      best = { plane: { normal, d }, count };
      const w = count / scored.length;
      needed = w >= 1 ? 1 : Math.ceil(Math.log(1 - confidence) / Math.log(1 - w ** 3));
    }
  }
  if (best === null || best.count < 3) return null;

  // The winner, counted on every point, then refitted to them all by least squares.
  const inliersOf = (plane: Plane) => {
    const found: number[] = [];
    points.forEach((p, index) => {
      if (Math.abs(dot3(plane.normal, p) + plane.d) <= threshold) found.push(index);
    });
    return found;
  };
  const first = inliersOf(best.plane);
  if (first.length < 3) return null;
  const plane = refitPlane(first.map((index) => points[index]!));
  return { plane, inliers: inliersOf(plane), iterations };
}

/** Least-squares plane: centroid and the covariance eigenvector with the smallest eigenvalue. */
export function refitPlane(points: readonly Vec3[]): Plane {
  const n = points.length;
  const centroid = scale3(points.reduce((sum, p) => add3(sum, p), [0, 0, 0] as Vec3), 1 / n);
  const cov = new Array<number>(9).fill(0);
  for (const p of points) {
    const q = sub3(p, centroid);
    for (let r = 0; r < 3; r += 1) for (let c = 0; c < 3; c += 1) cov[r * 3 + c]! += q[r]! * q[c]!;
  }
  const { vectors } = symmetricEigen(cov, 3);
  const normal = column(vectors, 3, 0) as Vec3;
  return { normal, d: -dot3(normal, centroid) };
}

/** Back-projects a depth map (metres along the optical axis) to camera-space points, every `stride` pixels. */
export function backProject(depth: ArrayLike<number>, width: number, height: number, K: Mat3, stride = 4): Vec3[] {
  const Kinv = invert3(K);
  const points: Vec3[] = [];
  for (let v = 0; v < height; v += stride) {
    for (let u = 0; u < width; u += stride) {
      const z = depth[v * width + u]!;
      if (!(z > 0)) continue;
      const ray = mulMat3Vec(Kinv, [u, v, 1]);
      points.push(scale3(ray, z / ray[2]));
    }
  }
  return points;
}
