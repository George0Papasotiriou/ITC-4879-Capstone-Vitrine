/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Steadying the tracked head: the One-Euro filter, and rotations smoothed as unit quaternions.
 */

import type { Mat3, Vec3 } from "@/lib/vision/linalg";

/**
 * docs/adr/065. Landmarks found afresh in every frame shake by a pixel or
 * two, and a piece drawn from them shakes with them. Smoothing hides the
 * shaking but makes the piece lag when the head moves. The One-Euro filter
 * (Casiez, Roussel and Vogel, CHI 2012) does both: a low-pass filter whose
 * cut-off rises with the speed of the signal,
 *
 *   f_c = f_min + β·|ẋ̂|,      α = 1 / (1 + τ/T_e),  τ = 1 / (2π·f_c),
 *   x̂_k = α·x_k + (1 − α)·x̂_{k−1}
 *
 * (T_e the time since the last sample, ẋ̂ the speed, itself low-passed at a
 * fixed cut-off). Still, it filters hard and the shaking goes; moving, it
 * filters little and the piece keeps up.
 */

export type OneEuroOptions = {
  /** Cut-off at rest, hertz: lower is steadier and slower. */
  minCutoff: number;
  /** How fast the cut-off rises with speed: higher follows quick moves more closely. */
  beta: number;
  /** Cut-off for the speed itself, hertz. */
  derivativeCutoff?: number;
};

const smoothingFactor = (cutoff: number, dt: number) => 1 / (1 + 1 / (2 * Math.PI * cutoff * dt));

export class OneEuroFilter {
  private value: number | null = null;
  private speed = 0;
  private time: number | null = null;

  constructor(private readonly options: OneEuroOptions) {}

  /** The filtered value of a sample taken at `seconds`. */
  filter(sample: number, seconds: number): number {
    if (this.value === null || this.time === null || !Number.isFinite(this.value)) {
      this.value = sample;
      this.time = seconds;
      this.speed = 0;
      return sample;
    }
    const dt = Math.max(seconds - this.time, 1e-4);
    this.time = seconds;
    const rawSpeed = (sample - this.value) / dt;
    this.speed += smoothingFactor(this.options.derivativeCutoff ?? 1, dt) * (rawSpeed - this.speed);
    const cutoff = this.options.minCutoff + this.options.beta * Math.abs(this.speed);
    this.value += smoothingFactor(cutoff, dt) * (sample - this.value);
    return this.value;
  }

  reset(): void {
    this.value = null;
    this.time = null;
    this.speed = 0;
  }
}

/* -------------------------------------------------------------------------- */
/* Rotations as unit quaternions                                              */
/* -------------------------------------------------------------------------- */

export type Quaternion = [number, number, number, number]; // w, x, y, z

/**
 * A rotation matrix as a unit quaternion (Shepperd's method: divide by the
 * largest of the four candidate terms, so the square root never comes near
 * zero).
 */
export function quaternionFromMatrix(m: Mat3): Quaternion {
  const [m00, m01, m02, m10, m11, m12, m20, m21, m22] = m;
  const trace = m00 + m11 + m22;
  let q: Quaternion;
  if (trace > 0) {
    const s = 2 * Math.sqrt(1 + trace);
    q = [s / 4, (m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s];
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    q = [(m21 - m12) / s, s / 4, (m01 + m10) / s, (m02 + m20) / s];
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    q = [(m02 - m20) / s, (m01 + m10) / s, s / 4, (m12 + m21) / s];
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
    q = [(m10 - m01) / s, (m02 + m20) / s, (m12 + m21) / s, s / 4];
  }
  return normalizeQuaternion(q);
}

export function normalizeQuaternion(q: Quaternion): Quaternion {
  const n = Math.hypot(q[0], q[1], q[2], q[3]);
  return n === 0 ? [1, 0, 0, 0] : [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}

export function matrixFromQuaternion(q: Quaternion): Mat3 {
  const [w, x, y, z] = normalizeQuaternion(q);
  return [
    1 - 2 * (y * y + z * z),
    2 * (x * y - w * z),
    2 * (x * z + w * y),
    2 * (x * y + w * z),
    1 - 2 * (x * x + z * z),
    2 * (y * z - w * x),
    2 * (x * z - w * y),
    2 * (y * z + w * x),
    1 - 2 * (x * x + y * y),
  ];
}

/**
 * A head pose smoothed over time: the translation component by component,
 * the rotation as a quaternion's four components, renormalised. q and −q are
 * the same rotation, so each new quaternion is first turned to the same side
 * as the last smoothed one; otherwise a filter would average a rotation with
 * its own negative and pass through nonsense.
 */
export class PoseSmoother {
  private readonly rotation: OneEuroFilter[];
  private readonly translation: OneEuroFilter[];
  private last: Quaternion | null = null;

  /**
   * The rotation's parameters were chosen by E13 on a synthetic head (still
   * for 4 s, then turning ±30° at 0.5 Hz, landmarks shaken by 1.5 px): the
   * least error while turning among settings that cut the still jitter to a
   * third. Quaternion components move about a unit per second when the head
   * turns briskly, hence the large β.
   */
  constructor(rotationOptions: OneEuroOptions = { minCutoff: 0.5, beta: 32 }, translationOptions: OneEuroOptions = { minCutoff: 1.2, beta: 0.02 }) {
    this.rotation = Array.from({ length: 4 }, () => new OneEuroFilter(rotationOptions));
    this.translation = Array.from({ length: 3 }, () => new OneEuroFilter(translationOptions));
  }

  smooth(pose: { R: Mat3; t: Vec3 }, seconds: number): { R: Mat3; t: Vec3 } {
    let q = quaternionFromMatrix(pose.R);
    if (this.last !== null && q[0] * this.last[0] + q[1] * this.last[1] + q[2] * this.last[2] + q[3] * this.last[3] < 0) q = [-q[0], -q[1], -q[2], -q[3]];
    const smoothed = normalizeQuaternion(q.map((value, index) => this.rotation[index]!.filter(value, seconds)) as Quaternion);
    this.last = smoothed;
    return {
      R: matrixFromQuaternion(smoothed),
      t: pose.t.map((value, index) => this.translation[index]!.filter(value, seconds)) as Vec3,
    };
  }

  reset(): void {
    this.last = null;
    for (const filter of [...this.rotation, ...this.translation]) filter.reset();
  }
}
