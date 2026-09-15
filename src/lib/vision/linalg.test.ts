/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Unit tests for the small linear algebra library.
 */

import { describe, expect, it } from "vitest";

import { seededRandom } from "@/lib/reco/simulate";
import {
  column,
  cross3,
  det3,
  identity3,
  invert3,
  mulMat3,
  nearestRotation,
  rotationDistanceDegrees,
  rotationFromEuler,
  symmetricEigen,
  transpose3,
  type Mat3,
} from "@/lib/vision/linalg";

const random = seededRandom(7);
const randomMatrix = (): Mat3 => Array.from({ length: 9 }, () => random() * 2 - 1) as Mat3;

function expectMatrixClose(actual: readonly number[], expected: readonly number[], digits = 9) {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((value, index) => expect(value).toBeCloseTo(expected[index]!, digits));
}

describe("3×3 matrices", () => {
  it("inverts: M·M⁻¹ = I for random matrices", () => {
    for (let trial = 0; trial < 50; trial += 1) {
      const m = randomMatrix();
      if (Math.abs(det3(m)) < 1e-3) continue;
      expectMatrixClose(mulMat3(m, invert3(m)), identity3(), 8);
    }
  });

  it("refuses to invert a singular matrix", () => {
    expect(() => invert3([1, 2, 3, 2, 4, 6, 0, 1, 1])).toThrow(RangeError);
  });

  it("follows the right-hand rule for the cross product", () => {
    expect(cross3([1, 0, 0], [0, 1, 0])).toEqual([0, 0, 1]);
  });
});

describe("Jacobi eigen-decomposition of symmetric matrices", () => {
  it.each([3, 5, 9])("satisfies A·v = λ·v with orthonormal vectors for %i×%i", (n) => {
    for (let trial = 0; trial < 20; trial += 1) {
      const a = new Array<number>(n * n).fill(0);
      for (let i = 0; i < n; i += 1) {
        for (let j = i; j < n; j += 1) {
          const value = random() * 10 - 5;
          a[i * n + j] = value;
          a[j * n + i] = value;
        }
      }
      const { values, vectors } = symmetricEigen(a, n);
      for (let k = 1; k < n; k += 1) expect(values[k]!).toBeGreaterThanOrEqual(values[k - 1]!);
      for (let k = 0; k < n; k += 1) {
        const v = column(vectors, n, k);
        for (let i = 0; i < n; i += 1) {
          const av = v.reduce((sum, vj, j) => sum + a[i * n + j]! * vj, 0);
          expect(av).toBeCloseTo(values[k]! * v[i]!, 9);
        }
        for (let other = 0; other < n; other += 1) {
          const w = column(vectors, n, other);
          expect(v.reduce((sum, vi, i) => sum + vi * w[i]!, 0)).toBeCloseTo(k === other ? 1 : 0, 9);
        }
      }
    }
  });

  it("finds the known spectrum of a simple matrix", () => {
    // [[2, 1], [1, 2]] has eigenvalues 1 and 3.
    const { values } = symmetricEigen([2, 1, 1, 2], 2);
    expect(values[0]).toBeCloseTo(1, 12);
    expect(values[1]).toBeCloseTo(3, 12);
  });
});

describe("nearest rotation (SVD re-orthonormalisation)", () => {
  it("leaves an exact rotation unchanged", () => {
    const R = rotationFromEuler(0.4, -1.1, 0.2);
    expectMatrixClose(nearestRotation(R), R, 10);
  });

  it("turns a noisy rotation into a proper rotation close to the original", () => {
    for (let trial = 0; trial < 100; trial += 1) {
      const R = rotationFromEuler(random() * 6, random() * 3 - 1.5, random() * 6);
      const noisy = R.map((value) => value + (random() - 0.5) * 0.02) as Mat3;
      const fixed = nearestRotation(noisy);
      expectMatrixClose(mulMat3(transpose3(fixed), fixed), identity3(), 9);
      expect(det3(fixed)).toBeCloseTo(1, 9);
      expect(rotationDistanceDegrees(R, fixed)).toBeLessThan(1.5);
    }
  });

  it("never returns a reflection", () => {
    const reflection: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, -1];
    expect(det3(nearestRotation(reflection))).toBeCloseTo(1, 9);
  });

  it("completes the basis when the third column is missing", () => {
    const R = rotationFromEuler(0.3, 0.5, -0.7);
    const flat = [R[0], R[1], 0, R[3], R[4], 0, R[6], R[7], 0] as Mat3;
    const fixed = nearestRotation(flat);
    expect(det3(fixed)).toBeCloseTo(1, 9);
    expect(rotationDistanceDegrees(R, fixed)).toBeLessThan(1e-6);
  });
});
