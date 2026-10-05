/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Where a hat, an earring and a necklace sit on a head, whether the face hides an earring, and how an earring swings.
 */

import type { Point2 } from "@/lib/vision/camera";
import { CANONICAL_FACE_MM, LANDMARK } from "@/lib/vision/mirror/face-model";
import { FRONTAL, headAngles, projectCamera, toCamera, type HeadPose, type Intrinsics } from "@/lib/vision/mirror/pose";
import { insidePolygon } from "@/lib/vision/mirror/light";
import { add3, mulMat3, mulMat3Vec, rotationFromEuler, scale3, sub3, type Mat3, type Vec3 } from "@/lib/vision/linalg";

/**
 * docs/adr/065. The face mesh covers the face, not the ears, the crown or
 * the neck, so where pieces hang is set relative to it, in the average
 * face's millimetres (x to the face's left, y up, z out of the face), from
 * adult head proportions:
 *
 * - an earlobe is about 2.5 cm below, 1.5 cm behind and a few millimetres
 *   outside the point where the face's outline meets the ear (landmarks 234
 *   and 454);
 * - a hat's band sits on the upper forehead, a little below the top of the
 *   mesh (landmark 10, near the hairline), and is as wide as the head;
 * - a necklace lies around the base of the neck, about 4 cm below and 4–5 cm
 *   behind the chin (landmark 152), and turns with the body, which follows
 *   the head only part of the way.
 *
 * These are proportions of the head, so they stay in the frame the pose
 * was solved in (the average face's millimetres). A piece's own size is
 * true millimetres and is divided by the face's scale k (iris.ts) to join
 * them: `inPoseFrame`.
 */

/** True millimetres in the frame the pose was solved in, for a face k times the average. */
export const inPoseFrame = (trueMm: number, scale: number): number => trueMm / scale;

const at = (index: number): Vec3 => CANONICAL_FACE_MM[index]!;

export const ANCHORS_MM = {
  rightEarlobe: add3(at(LANDMARK.rightFaceEdge), [-4, -24, -14]),
  leftEarlobe: add3(at(LANDMARK.leftFaceEdge), [4, -24, -14]),
  /** The middle of the hat's band, front to back, at the height it grips. */
  hatBand: [0, at(LANDMARK.foreheadTop)[1] - 12, 0] as Vec3,
  /** From the chin to the front of the neck's base, before the body's turn is applied. */
  neckFromChin: [0, -42, -46] as Vec3,
} as const;

/** The head's width across the ears, in average-face millimetres: what a hat must go round. */
export const HEAD_WIDTH_MM = at(LANDMARK.leftFaceEdge)[0] - at(LANDMARK.rightFaceEdge)[0];

/**
 * Does this ear face away from the camera? Its outward direction (the face
 * model's −x for the right ear, +x for the left) turned into the camera's
 * frame, against the direction from the ear to the camera.
 */
export function earTurnedAway(pose: HeadPose, side: "right" | "left"): boolean {
  const outward = mulMat3Vec(pose.R, [side === "right" ? -1 : 1, 0, 0]);
  const lobe = toCamera(pose, side === "right" ? ANCHORS_MM.rightEarlobe : ANCHORS_MM.leftEarlobe);
  return outward[0] * -lobe[0] + outward[1] * -lobe[1] + outward[2] * -lobe[2] < 0;
}

/**
 * Is an earlobe hidden by the face? Only an ear turned away from the camera
 * can be (the near ear is beside the face, even where the face's outline
 * reaches up to it); it is hidden when its point on screen falls inside the
 * face's outline (the landmarks round the face, as tracked in this frame),
 * because then the face is in front of it. Measured on the picture itself,
 * so it follows the real face's shape rather than a model of a skull. A
 * margin of a few percent of the face's width keeps a lobe right at the
 * outline from flickering in and out.
 */
export function hiddenBehindFace(point: Point2, outline: readonly Point2[], turnedAway: boolean, margin = 0.03): boolean {
  if (!turnedAway || !insidePolygon(point, outline)) return false;
  const xs = outline.map((corner) => corner[0]);
  const width = Math.max(...xs) - Math.min(...xs);
  // Inside, and not only just: its distance to the outline's nearest edge is beyond the margin.
  let nearest = Number.POSITIVE_INFINITY;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i, i += 1) {
    const [ax, ay] = outline[j]!;
    const [bx, by] = outline[i]!;
    const dx = bx - ax;
    const dy = by - ay;
    const length = dx * dx + dy * dy;
    const u = length === 0 ? 0 : Math.max(0, Math.min(1, ((point[0] - ax) * dx + (point[1] - ay) * dy) / length));
    nearest = Math.min(nearest, Math.hypot(point[0] - (ax + u * dx), point[1] - (ay + u * dy)));
  }
  return nearest > margin * width;
}

/**
 * The body's rotation for a necklace: the shoulders follow the head's yaw
 * and roll only part of the way and not its nod (G_body = R_z(½·roll)·R_y(⅖·yaw)).
 */
export function bodyRotation(R: Mat3): Mat3 {
  const { yaw, roll } = headAngles(R);
  const radians = Math.PI / 180;
  return mulMat3(rotationFromEuler(0.4 * yaw * radians, 0, 0.5 * roll * radians), FRONTAL);
}

/** The base of the neck in the camera's frame: the chin, as tracked, plus the neck's offset turned with the body. */
export function neckPoint(pose: HeadPose): Vec3 {
  const chin = toCamera(pose, at(LANDMARK.chin));
  return add3(chin, mulMat3Vec(bodyRotation(pose.R), ANCHORS_MM.neckFromChin));
}

/** A necklace's chain goes round the back of the neck, above the front of its base: the top of its photograph sits this much higher (mm). */
export const NECKLACE_RISE_MM = 30;

/* -------------------------------------------------------------------------- */
/* Cards: a piece's photograph as a flat card in front of the camera          */
/* -------------------------------------------------------------------------- */

/** A card's corners in the camera's frame (millimetres): top left, top right, bottom right, bottom left of the photograph. */
export type Card = [Vec3, Vec3, Vec3, Vec3];

/** A card hanging from `top` (the middle of its top edge), `width` × `height` mm, rotated by `angle` in the picture's plane (radians, clockwise). */
export function hangingCard(top: Vec3, width: number, height: number, angle: number): Card {
  const s = Math.sin(angle);
  const c = Math.cos(angle);
  // Down the card is along (−sin, cos) on screen; across it is (cos, sin).
  const across: Vec3 = [c * width, s * width, 0];
  const down: Vec3 = [-s * height, c * height, 0];
  const left = sub3(top, scale3(across, 0.5));
  const right = add3(top, scale3(across, 0.5));
  return [left, right, add3(right, down), add3(left, down)];
}

/**
 * A hat's card: upright in the head's own frame, centred on the band and
 * resting on it (its bottom edge is the band), turning and nodding with the
 * head. `w` and `h` in the pose's frame; a hat fits the head, so its width
 * is a multiple of HEAD_WIDTH_MM rather than a size in true millimetres.
 */
export function hatCard(pose: HeadPose, w: number, h: number): Card {
  const band = ANCHORS_MM.hatBand;
  const corners: Vec3[] = [
    [band[0] - w / 2, band[1] + h, band[2]],
    [band[0] + w / 2, band[1] + h, band[2]],
    [band[0] + w / 2, band[1], band[2]],
    [band[0] - w / 2, band[1], band[2]],
  ];
  return corners.map((corner) => toCamera(pose, corner)) as Card;
}

/** A card's corners in the picture. Null when any corner is behind the camera. */
export function projectCard(K: Intrinsics, card: Card): [Point2, Point2, Point2, Point2] | null {
  const points = card.map((corner) => projectCamera(K, corner));
  return points.every((point): point is Point2 => point !== null) ? (points as [Point2, Point2, Point2, Point2]) : null;
}

/* -------------------------------------------------------------------------- */
/* An earring that swings                                                     */
/* -------------------------------------------------------------------------- */

/**
 * An earring hangs from its hook as a pendulum of length ℓ (half its drop,
 * its centre of mass). In the frame of the earlobe, which accelerates by a
 * when the head moves, the bob feels gravity minus a, so its angle θ from
 * hanging straight down (positive to the right on screen) obeys
 *
 *   θ'' = −((g − a_y)·sin θ + a_x·cos θ) / ℓ − c·θ'
 *
 * (y down; c the damping). A head turned quickly to the right makes the
 * earring lag to the left and then swing back, as a real one does.
 * Integrated by semi-implicit Euler in steps of at most 4 ms.
 */
export class Pendulum {
  angle = 0;
  velocity = 0;

  constructor(
    private readonly lengthM: number,
    private readonly damping = 3,
  ) {}

  /** Advance by `dt` seconds while the pivot accelerates by (ax, ay) m/s² (screen axes, y down). */
  step(dt: number, ax: number, ay: number): number {
    const g = 9.81;
    const total = Math.min(Math.max(dt, 0), 0.1);
    const steps = Math.max(1, Math.ceil(total / 0.004));
    const h = total / steps;
    for (let i = 0; i < steps; i += 1) {
      const acceleration = -((g - ay) * Math.sin(this.angle) + ax * Math.cos(this.angle)) / this.lengthM - this.damping * this.velocity;
      this.velocity += h * acceleration;
      this.angle += h * this.velocity;
    }
    // A real earring cannot swing over its own hook.
    this.angle = Math.max(-1.2, Math.min(1.2, this.angle));
    return this.angle;
  }

  reset(): void {
    this.angle = 0;
    this.velocity = 0;
  }
}

/**
 * The acceleration of a tracked point, m/s², from its last three positions
 * in the camera's frame (millimetres) and the times between them, by the
 * second difference; capped, because one misplaced frame must not fling an
 * earring off.
 */
export function accelerationOf(points: readonly [Vec3, Vec3, Vec3], dt1: number, dt2: number, cap = 25): [number, number] {
  if (dt1 <= 0 || dt2 <= 0) return [0, 0];
  const v1 = scale3(sub3(points[1], points[0]), 1 / dt1);
  const v2 = scale3(sub3(points[2], points[1]), 1 / dt2);
  const a = scale3(sub3(v2, v1), 2 / (dt1 + dt2) / 1000);
  const clamp = (value: number) => Math.max(-cap, Math.min(cap, value));
  return [clamp(a[0]), clamp(a[1])];
}
