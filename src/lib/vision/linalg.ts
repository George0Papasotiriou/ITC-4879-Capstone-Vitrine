/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Small linear algebra: 3-vectors, 3x3 matrices and symmetric eigen-decomposition.
 */

/**
 * Small, exact linear algebra for single-view geometry (A4).
 *
 * The geometry in this folder needs only 3-vectors, 3×3 matrices, and the
 * eigen-decomposition of small symmetric matrices (up to 9×9 for the
 * homography). Writing them here keeps every step inspectable, avoids a
 * numerical library in the browser bundle, and makes the tests about the
 * geometry rather than about a dependency.
 *
 * Matrices are row-major arrays: M[r * n + c].
 */

export type Vec3 = [number, number, number];
export type Mat3 = [number, number, number, number, number, number, number, number, number];

export const identity3 = (): Mat3 => [1, 0, 0, 0, 1, 0, 0, 0, 1];

export function dot3(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross3(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export function norm3(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

export function scale3(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}

export function add3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function sub3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function normalize3(a: Vec3): Vec3 {
  const n = norm3(a);
  if (n === 0) throw new RangeError("Cannot normalise a zero vector");
  return scale3(a, 1 / n);
}

export function mulMat3(a: Mat3, b: Mat3): Mat3 {
  const out = new Array<number>(9).fill(0);
  for (let r = 0; r < 3; r += 1) {
    for (let c = 0; c < 3; c += 1) {
      let sum = 0;
      for (let k = 0; k < 3; k += 1) sum += a[r * 3 + k]! * b[k * 3 + c]!;
      out[r * 3 + c] = sum;
    }
  }
  return out as Mat3;
}

export function mulMat3Vec(m: Mat3, v: Vec3): Vec3 {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

export function transpose3(m: Mat3): Mat3 {
  return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
}

export function det3(m: Mat3): number {
  return m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
}

/** Inverse by the adjugate: exact and fast for 3×3. */
export function invert3(m: Mat3): Mat3 {
  const det = det3(m);
  if (Math.abs(det) < 1e-15) throw new RangeError("Matrix is singular");
  const inv = [
    m[4] * m[8] - m[5] * m[7],
    m[2] * m[7] - m[1] * m[8],
    m[1] * m[5] - m[2] * m[4],
    m[5] * m[6] - m[3] * m[8],
    m[0] * m[8] - m[2] * m[6],
    m[2] * m[3] - m[0] * m[5],
    m[3] * m[7] - m[4] * m[6],
    m[1] * m[6] - m[0] * m[7],
    m[0] * m[4] - m[1] * m[3],
  ];
  return inv.map((value) => value / det) as Mat3;
}

export function columns3(m: Mat3): [Vec3, Vec3, Vec3] {
  return [
    [m[0], m[3], m[6]],
    [m[1], m[4], m[7]],
    [m[2], m[5], m[8]],
  ];
}

export function fromColumns3(a: Vec3, b: Vec3, c: Vec3): Mat3 {
  return [a[0], b[0], c[0], a[1], b[1], c[1], a[2], b[2], c[2]];
}

/**
 * Eigen-decomposition of a symmetric n×n matrix by the cyclic Jacobi method.
 *
 * Repeatedly pick an off-diagonal entry a_pq and rotate rows and columns p, q
 * by the angle that zeroes it:
 *
 *   θ = ½ · atan2(2·a_pq, a_qq − a_pp)
 *
 * Each rotation reduces the sum of squared off-diagonal entries by 2·a_pq², so
 * the matrix converges to a diagonal of eigenvalues, and the product of the
 * rotations holds the eigenvectors as columns. Quadratically convergent,
 * unconditionally stable for symmetric matrices, and simple enough to verify.
 *
 * Returns eigenvalues in ascending order with matching eigenvectors (columns of
 * `vectors`, row-major n×n).
 */
export function symmetricEigen(matrix: readonly number[], n: number, { maxSweeps = 100, tolerance = 1e-14 } = {}) {
  const a = [...matrix];
  const v = new Array<number>(n * n).fill(0);
  for (let i = 0; i < n; i += 1) v[i * n + i] = 1;

  for (let sweep = 0; sweep < maxSweeps; sweep += 1) {
    let off = 0;
    let scale = 0;
    for (let i = 0; i < n; i += 1) {
      for (let j = 0; j < n; j += 1) {
        const value = a[i * n + j]!;
        scale += value * value;
        if (i !== j) off += value * value;
      }
    }
    if (off <= tolerance * tolerance * Math.max(1, scale)) break;

    for (let p = 0; p < n - 1; p += 1) {
      for (let q = p + 1; q < n; q += 1) {
        const apq = a[p * n + q]!;
        if (Math.abs(apq) < 1e-300) continue;
        const theta = 0.5 * Math.atan2(2 * apq, a[q * n + q]! - a[p * n + p]!);
        const c = Math.cos(theta);
        const s = Math.sin(theta);
        for (let k = 0; k < n; k += 1) {
          const akp = a[k * n + p]!;
          const akq = a[k * n + q]!;
          a[k * n + p] = c * akp - s * akq;
          a[k * n + q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k += 1) {
          const apk = a[p * n + k]!;
          const aqk = a[q * n + k]!;
          a[p * n + k] = c * apk - s * aqk;
          a[q * n + k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k += 1) {
          const vkp = v[k * n + p]!;
          const vkq = v[k * n + q]!;
          v[k * n + p] = c * vkp - s * vkq;
          v[k * n + q] = s * vkp + c * vkq;
        }
      }
    }
  }

  const order = [...Array(n).keys()].sort((i, j) => a[i * n + i]! - a[j * n + j]!);
  const values = order.map((i) => a[i * n + i]!);
  const vectors = new Array<number>(n * n).fill(0);
  order.forEach((source, target) => {
    for (let k = 0; k < n; k += 1) vectors[k * n + target] = v[k * n + source]!;
  });
  return { values, vectors };
}

/** Column `index` of a row-major n×n matrix. */
export function column(matrix: readonly number[], n: number, index: number): number[] {
  return Array.from({ length: n }, (_, k) => matrix[k * n + index]!);
}

/**
 * The rotation nearest to a 3×3 matrix in the Frobenius norm: R = U·Vᵀ from
 * the singular value decomposition M = U·Σ·Vᵀ, with the sign of the last
 * singular vector flipped if that would give a reflection (det = −1).
 *
 * The SVD comes from the eigen-decomposition of MᵀM = V·Σ²·Vᵀ, and
 * U = M·V·Σ⁻¹. For the near-rotations produced by pose recovery Σ is close to
 * the identity, so this is well conditioned.
 */
export function nearestRotation(m: Mat3): Mat3 {
  const mtm = mulMat3(transpose3(m), m);
  const { values, vectors } = symmetricEigen(mtm, 3);
  // Descending singular values.
  const order = [2, 1, 0];
  const V: Vec3[] = order.map((i) => column(vectors, 3, i) as Vec3);
  const sigma = order.map((i) => Math.sqrt(Math.max(values[i]!, 0)));
  const U: Vec3[] = V.map((vector, k) => {
    if (sigma[k]! < 1e-12) return [0, 0, 0] as Vec3;
    return scale3(mulMat3Vec(m, vector), 1 / sigma[k]!);
  });
  // A rank-deficient input leaves the last left vector undetermined; complete the basis.
  if (norm3(U[2]!) < 1e-9) U[2] = cross3(U[0]!, U[1]!);
  const Um = fromColumns3(U[0]!, U[1]!, U[2]!);
  const Vm = fromColumns3(V[0]!, V[1]!, V[2]!);
  let R = mulMat3(Um, transpose3(Vm));
  if (det3(R) < 0) {
    const flipped = fromColumns3(U[0]!, U[1]!, scale3(U[2]!, -1));
    R = mulMat3(flipped, transpose3(Vm));
  }
  return R;
}

/**
 * Solves A·x = b for a square n×n system by Gaussian elimination with partial
 * pivoting (swap in the largest remaining entry of each column before
 * eliminating, which keeps round-off bounded). Returns null when A is singular.
 */
export function solveLinear(matrix: readonly number[], rhs: readonly number[], n: number): number[] | null {
  const a = [...matrix];
  const b = [...rhs];
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(a[row * n + col]!) > Math.abs(a[pivot * n + col]!)) pivot = row;
    }
    if (Math.abs(a[pivot * n + col]!) < 1e-14) return null;
    if (pivot !== col) {
      for (let k = 0; k < n; k += 1) [a[col * n + k], a[pivot * n + k]] = [a[pivot * n + k]!, a[col * n + k]!];
      [b[col], b[pivot]] = [b[pivot]!, b[col]!];
    }
    for (let row = col + 1; row < n; row += 1) {
      const factor = a[row * n + col]! / a[col * n + col]!;
      for (let k = col; k < n; k += 1) a[row * n + k]! -= factor * a[col * n + k]!;
      b[row]! -= factor * b[col]!;
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let row = n - 1; row >= 0; row -= 1) {
    let sum = b[row]!;
    for (let k = row + 1; k < n; k += 1) sum -= a[row * n + k]! * x[k]!;
    x[row] = sum / a[row * n + row]!;
  }
  return x;
}

/**
 * Rodrigues' formula: the rotation by angle θ = ‖w‖ about the axis w / θ,
 *
 *   R = I + sin θ · [k]× + (1 − cos θ) · [k]×²
 *
 * where [k]× is the cross-product matrix of the unit axis k. Three numbers with
 * no constraints, which is what an optimiser needs.
 */
export function rotationFromVector(w: Vec3): Mat3 {
  const theta = norm3(w);
  if (theta < 1e-12) return [1, -w[2], w[1], w[2], 1, -w[0], -w[1], w[0], 1];
  const [kx, ky, kz] = scale3(w, 1 / theta);
  const s = Math.sin(theta);
  const c = 1 - Math.cos(theta);
  return [
    1 + c * (kx * kx - 1),
    -s * kz + c * kx * ky,
    s * ky + c * kx * kz,
    s * kz + c * kx * ky,
    1 + c * (ky * ky - 1),
    -s * kx + c * ky * kz,
    -s * ky + c * kx * kz,
    s * kx + c * ky * kz,
    1 + c * (kz * kz - 1),
  ];
}

/** Rotation from yaw (about y), pitch (about x) and roll (about z), in radians: R = R_z · R_x · R_y. */
export function rotationFromEuler(yaw: number, pitch: number, roll: number): Mat3 {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const cr = Math.cos(roll);
  const sr = Math.sin(roll);
  const Ry: Mat3 = [cy, 0, sy, 0, 1, 0, -sy, 0, cy];
  const Rx: Mat3 = [1, 0, 0, 0, cp, -sp, 0, sp, cp];
  const Rz: Mat3 = [cr, -sr, 0, sr, cr, 0, 0, 0, 1];
  return mulMat3(Rz, mulMat3(Rx, Ry));
}

/** The angle of the rotation R₁ᵀ·R₂, in degrees: how far apart two rotations are. */
export function rotationDistanceDegrees(a: Mat3, b: Mat3): number {
  const relative = mulMat3(transpose3(a), b);
  const trace = relative[0] + relative[4] + relative[8];
  return (Math.acos(Math.min(1, Math.max(-1, (trace - 1) / 2))) * 180) / Math.PI;
}
