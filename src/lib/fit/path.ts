/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Will it fit through my door? A piece's box carried along the way into a home: doors, corridor corners and stairs.
 */

import { z } from "zod";

/**
 * docs/adr/055. The question a furniture shop gets most after "when will it
 * arrive": will it get *into* the room — through the front door, round the
 * corridor's corner, up the stairs. The piece is its catalogue box, W × D × H
 * centimetres, a rigid block. The way in is a list of steps, in order:
 *
 * DOOR (width × height). The box goes straight through in one of its three
 * orientations: the dimension along the way of travel is free, the other two
 * must fit the opening. Two dimensions p ≥ q fit an opening a ≥ b either
 * square on (p ≤ a, q ≤ b) or turned in the doorway's plane, which Carver's
 * condition (1956) decides exactly:
 *     p > a, q ≤ b and b ≥ (2pqa + (p² − q²)·√(p² + q² − a²)) / (p² + q²).
 * A thin wall is assumed; a deep frame behaves like a short corridor.
 *
 * TURN (a corridor `from` wide meeting one `to` wide at a right angle, under a
 * ceiling). Seen from above, the piece is a rectangle of length L and width w,
 * carried flat. At angle θ to the first corridor, the longest rectangle of
 * width w that fits against the two outer walls and touches the inner corner
 * is
 *     L(θ) = a / cos θ + b / sin θ − w / (sin θ · cos θ),
 * and the piece turns the corner if and only if L ≤ min over θ ∈ (0, π/2) of
 * L(θ) — "the moving-the-sofa problem" (with w = 0, the ladder's
 * (a^⅔ + b^⅔)^(3/2)). L(θ) is unimodal on (0, π/2), so its minimum is found
 * by golden-section search, without derivatives.
 *
 * Movers also stand a piece up: any of the box's three dimensions may be the
 * one that points up, if it fits under the ceiling, and a long piece may be
 * tilted, its long axis raised by φ, which shortens its plan to L·cos φ + t·sin φ
 * (t the up dimension) while its height grows to L·sin φ + t·cos φ, up to the
 * ceiling. The walls are vertical, so the plan's footprint is all that counts
 * against them, and the height only against the ceiling.
 *
 * STAIRS (width, headroom): a straight flight is a corridor; the piece must fit
 * its width and, carried at the stair's pitch, its headroom. A landing that
 * turns is a TURN step of its own.
 *
 * Every step answers whether it fits, how (which side up, and the tilt), and by
 * how many centimetres — spare, or too much — so the shopper knows what to
 * measure again. A piece fits the way in when it fits every step.
 */


export type Box = { w: number; d: number; h: number };

const cm = (min: number, max: number) => z.number().int().min(min).max(max);

/** One step of the way in, in whole centimetres, within what homes have. */
export const stepSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("door"), width: cm(40, 400), height: cm(120, 400) }),
  z.object({ kind: z.literal("turn"), from: cm(40, 600), to: cm(40, 600), ceiling: cm(150, 600) }),
  z.object({ kind: z.literal("stairs"), width: cm(40, 400), headroom: cm(120, 600) }),
]);
export type Step = z.infer<typeof stepSchema>;

/** A way in has at most this many steps: a front door, a hall, stairs, a landing, a corridor and a room door. */
export const MAX_STEPS = 8;

/** How the piece goes through: which of its dimensions points up, and the tilt of its long axis, in degrees. */
export type Carry = { up: keyof Box; tiltDegrees: number; diagonal: boolean };

export type StepResult = {
  step: Step;
  fits: boolean;
  carry: Carry | null;
  marginCm: number;
  /** For a turn: the piece seen from above as carried (cm), and the angle where the corner is tightest (radians). */
  plan?: { length: number; width: number; theta: number };
};

export type WayInResult = { fits: boolean; steps: StepResult[]; firstFailure: number | null };

const AXES: readonly (keyof Box)[] = ["w", "d", "h"];

/** The two dimensions of `box` other than `axis`, the longer first. */
function others(box: Box, axis: keyof Box): [number, number] {
  const [p, q] = AXES.filter((other) => other !== axis).map((other) => box[other]) as [number, number];
  return p >= q ? [p, q] : [q, p];
}

/**
 * Whether a rectangle p × q fits inside a rectangle a × b, turned however is
 * best (Carver's condition). Order does not matter; sizes in the same unit.
 */
export function rectangleFits(p0: number, q0: number, a0: number, b0: number): boolean {
  const [p, q] = p0 >= q0 ? [p0, q0] : [q0, p0];
  const [a, b] = a0 >= b0 ? [a0, b0] : [b0, a0];
  if (p <= a && q <= b) return true;
  if (q > b || p <= a) return false;
  // Turned: p > a, and the diagonal placement needs the opening's short side to be at least this.
  const diagonal = p * p + q * q;
  if (diagonal < a * a) return true;
  const needed = (2 * p * q * a + (p * p - q * q) * Math.sqrt(diagonal - a * a)) / diagonal;
  return b >= needed;
}

/** A door: the best orientation, and how much room is left on the tighter side (negative when it does not fit). */
export function throughDoor(box: Box, width: number, height: number): StepResult {
  const step: Step = { kind: "door", width, height };
  let best: StepResult = { step, fits: false, carry: null, marginCm: -Infinity };
  for (const along of AXES) {
    // `along` goes through the doorway; the other two face it, and can be turned either way up.
    const [p, q] = others(box, along);
    for (const [across, up] of [
      [p, q],
      [q, p],
    ] as const) {
      const margin = Math.min(width - across, height - up);
      if (margin > best.marginCm) {
        const upAxis = AXES.find((axis) => axis !== along && box[axis] === up) ?? "h";
        best = { step, fits: margin >= 0, carry: { up: upAxis, tiltDegrees: 0, diagonal: false }, marginCm: margin };
      }
    }
    if (!best.fits && rectangleFits(p, q, width, height)) {
      const upAxis = AXES.find((axis) => axis !== along && box[axis] === q) ?? "h";
      best = { step, fits: true, carry: { up: upAxis, tiltDegrees: 0, diagonal: true }, marginCm: 0 };
    }
  }
  return best;
}

/** L(θ): the longest piece of width w at angle θ that fits a corner of corridors a and b. */
export function cornerLength(theta: number, a: number, b: number, w: number): number {
  const s = Math.sin(theta);
  const c = Math.cos(theta);
  return a / c + b / s - w / (s * c);
}

/**
 * The longest piece of width w (seen from above) that can be carried round a
 * right-angled corner from a corridor a wide into one b wide: min over θ of
 * L(θ), by golden-section search on (0, π/2). Zero when w is wider than
 * either corridor, so nothing of that width gets in.
 */
export function longestAroundCorner(a: number, b: number, w: number, tolerance = 1e-9): number {
  return tightestTurn(a, b, w, tolerance).length;
}

/**
 * Where a piece L long and w wide lies at angle θ when carried round the corner,
 * pushed into the outer corner — its lowest point on the outer wall y = 0, its
 * rightmost on the outer wall x = b — which takes it as far from the inner
 * corner (0, a) as it can go. Corridors: y ∈ [0, a] for x ≤ b, then x ∈ [0, b]
 * for y ≥ 0. For the plan drawing of a turn.
 */
export function pushedIntoCorner(theta: number, b: number, L: number, w: number): [number, number][] {
  const u = [Math.cos(theta), Math.sin(theta)] as const;
  const v = [-Math.sin(theta), Math.cos(theta)] as const;
  const corners = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([i, j]) => [(i! * L * u[0]) / 2 + (j! * w * v[0]) / 2, (i! * L * u[1]) / 2 + (j! * w * v[1]) / 2] as [number, number]);
  const dx = b - Math.max(...corners.map((corner) => corner[0]));
  const dy = -Math.min(...corners.map((corner) => corner[1]));
  return corners.map(([x, y]) => [x + dx, y + dy]);
}

/** The tightest moment of the turn: min over θ of L(θ), and the angle where it happens. */
export function tightestTurn(a: number, b: number, w: number, tolerance = 1e-9): { length: number; theta: number } {
  if (w > a || w > b) return { length: 0, theta: Math.PI / 4 };
  const ratio = (Math.sqrt(5) - 1) / 2;
  let lo = 1e-6;
  let hi = Math.PI / 2 - 1e-6;
  let x1 = hi - ratio * (hi - lo);
  let x2 = lo + ratio * (hi - lo);
  let f1 = cornerLength(x1, a, b, w);
  let f2 = cornerLength(x2, a, b, w);
  while (hi - lo > tolerance) {
    if (f1 <= f2) {
      hi = x2;
      x2 = x1;
      f2 = f1;
      x1 = hi - ratio * (hi - lo);
      f1 = cornerLength(x1, a, b, w);
    } else {
      lo = x1;
      x1 = x2;
      f1 = f2;
      x2 = lo + ratio * (hi - lo);
      f2 = cornerLength(x2, a, b, w);
    }
  }
  return f1 <= f2 ? { length: Math.max(0, f1), theta: x1 } : { length: Math.max(0, f2), theta: x2 };
}

/**
 * A tilt that shortens the plan: a piece L long and t thick, its long axis
 * raised by φ, covers L·cos φ + t·sin φ of floor and stands L·sin φ + t·cos φ
 * high. The highest tilt the ceiling allows, and the plan length it gives.
 * The plan length first grows with φ (the thickness swings out), so a tilt is
 * only used when it ends shorter than carrying the piece flat.
 */
export function tiltUnder(L: number, t: number, ceiling: number): { phi: number; plan: number } {
  if (t > ceiling) return { phi: 0, plan: Infinity };
  // Height L·sin φ + t·cos φ = R·sin(φ + α) and plan L·cos φ + t·sin φ = R·cos(φ − α), with R = √(L² + t²)
  // and α = atan2(t, L). The height rises to R at φ = π/2 − α and falls to L at π/2, so the angles under the
  // ceiling are [0, φ₁] and, when L itself fits under it, [φ₂, π/2], with φ₁ = asin(C/R) − α and
  // φ₂ = π − asin(C/R) − α. The plan has a single peak (at φ = α), so on each interval its least value is at
  // an end: the shortest plan is the least of the plan at 0, φ₁, φ₂ and π/2, where those are allowed.
  const R = Math.hypot(L, t);
  const alpha = Math.atan2(t, L);
  const plan = (phi: number) => L * Math.cos(phi) + t * Math.sin(phi);
  const height = (phi: number) => L * Math.sin(phi) + t * Math.cos(phi);
  const reach = ceiling >= R ? Math.PI / 2 : Math.asin(ceiling / R);
  const candidates = [0, reach - alpha, Math.PI - reach - alpha, Math.PI / 2].filter((phi) => phi >= 0 && phi <= Math.PI / 2 + 1e-12 && height(phi) <= ceiling + 1e-9);
  let best = { phi: 0, plan: L };
  for (const phi of candidates) if (plan(phi) < best.plan - 1e-9) best = { phi, plan: plan(phi) };
  return best;
}

/** A corridor's corner: every side the piece may be carried up, flat or tilted; the best one. */
export function roundCorner(box: Box, from: number, to: number, ceiling: number): StepResult {
  const step: Step = { kind: "turn", from, to, ceiling };
  let best: StepResult = { step, fits: false, carry: null, marginCm: -Infinity };
  for (const up of AXES) {
    const t = box[up];
    if (t > ceiling) continue;
    const [L, w] = others(box, up);
    // The thinner of the two plan sides may also be the one tilted up, the longer then lying across.
    for (const [length, width] of [
      [L, w],
      [w, L],
    ] as const) {
      const tightest = tightestTurn(from, to, width);
      const limit = tightest.length;
      const { phi, plan } = tiltUnder(length, t, ceiling);
      const margin = limit - plan;
      if (margin > best.marginCm) {
        best = {
          step,
          fits: margin >= 0,
          carry: { up, tiltDegrees: Math.round((phi * 180) / Math.PI), diagonal: false },
          marginCm: margin,
          plan: { length: plan, width, theta: tightest.theta },
        };
      }
    }
  }
  return best;
}

/**
 * A straight flight of stairs: as wide as the piece's narrowest carried side,
 * and with headroom for its height measured square to the pitch — a flight
 * keeps the piece parallel to the steps, so what must clear the headroom is
 * its thickness, plus a hand's breadth for the hands under it.
 */
export function upStairs(box: Box, width: number, headroom: number, handsCm = 5): StepResult {
  const step: Step = { kind: "stairs", width, headroom };
  let best: StepResult = { step, fits: false, carry: null, marginCm: -Infinity };
  for (const along of AXES) {
    const [p, q] = others(box, along);
    for (const [across, up] of [
      [p, q],
      [q, p],
    ] as const) {
      const margin = Math.min(width - across, headroom - (up + handsCm));
      if (margin > best.marginCm) {
        const upAxis = AXES.find((axis) => axis !== along && box[axis] === up) ?? "h";
        best = { step, fits: margin >= 0, carry: { up: upAxis, tiltDegrees: 0, diagonal: false }, marginCm: margin };
      }
    }
  }
  return best;
}

/** The whole way in, step by step; margins rounded to whole centimetres for the page. */
export function wayIn(box: Box, steps: readonly Step[]): WayInResult {
  const results = steps.map((step) => {
    const result =
      step.kind === "door"
        ? throughDoor(box, step.width, step.height)
        : step.kind === "turn"
          ? roundCorner(box, step.from, step.to, step.ceiling)
          : upStairs(box, step.width, step.headroom);
    return { ...result, marginCm: Number.isFinite(result.marginCm) ? Math.floor(result.marginCm) : -9999 };
  });
  const firstFailure = results.findIndex((result) => !result.fits);
  return { fits: firstFailure === -1, steps: results, firstFailure: firstFailure === -1 ? null : firstFailure };
}
