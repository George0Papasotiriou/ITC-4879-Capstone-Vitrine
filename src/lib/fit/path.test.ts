/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Tests for "will it fit through my door": closed forms against hand-worked values and against brute force.
 */

import { describe, expect, it } from "vitest";

import { cornerLength, longestAroundCorner, rectangleFits, roundCorner, throughDoor, tiltUnder, upStairs, wayIn } from "@/lib/fit/path";

/** A small seeded generator, so the brute-force comparisons are the same on every run. */
function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

/**
 * Brute force for the corner: corridors y ∈ [0, a] (x ≤ b) and x ∈ [0, b] (y ≥ 0), inner corner (0, a). A
 * rectangle L × w at angle θ, pushed into the outer corner (lowest point on y = 0, rightmost on x = b, which
 * only moves it away from the inner wall), must not overlap the quadrant x < 0, y > a. Overlap of two
 * convex shapes is decided by the separating-axis theorem. It turns the corner when it fits at every angle.
 */
function fitsAtAngle(theta: number, a: number, b: number, L: number, w: number): boolean {
  const u = [Math.cos(theta), Math.sin(theta)];
  const v = [-Math.sin(theta), Math.cos(theta)];
  let corners = [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ].map(([i, j]) => [(i! * L * u[0]!) / 2 + (j! * w * v[0]!) / 2, (i! * L * u[1]!) / 2 + (j! * w * v[1]!) / 2]);
  const dx = b - Math.max(...corners.map((corner) => corner[0]!));
  const dy = -Math.min(...corners.map((corner) => corner[1]!));
  corners = corners.map(([x, y]) => [x! + dx, y! + dy]);
  if (Math.min(...corners.map((corner) => corner[0]!)) >= 0) return true;
  if (Math.max(...corners.map((corner) => corner[1]!)) <= a) return true;
  for (const n of [u, v, u.map((x) => -x), v.map((x) => -x)]) {
    const projections = corners.map(([x, y]) => x! * n[0]! + y! * n[1]!);
    const apex = a * n[1]!;
    if (n[0]! >= 0 && n[1]! <= 0 && Math.min(...projections) >= apex) return true;
    if (n[0]! <= 0 && n[1]! >= 0 && Math.max(...projections) <= apex) return true;
  }
  return false;
}
const turnsBruteForce = (a: number, b: number, L: number, w: number, samples = 2000) =>
  Array.from({ length: samples + 1 }, (_, k) => (k / samples) * (Math.PI / 2)).every((theta) => fitsAtAngle(theta, a, b, L, w));

/** Brute force for Carver: turn the rectangle by β and see whether its bounding box fits the opening. */
function rectangleFitsBruteForce(p: number, q: number, a: number, b: number, samples = 20000): boolean {
  for (let k = 0; k <= samples; k += 1) {
    const beta = (k / samples) * (Math.PI / 2);
    const across = p * Math.cos(beta) + q * Math.sin(beta);
    const up = p * Math.sin(beta) + q * Math.cos(beta);
    if ((across <= a && up <= b) || (across <= b && up <= a)) return true;
  }
  return false;
}

describe("round a corridor's corner (docs/adr/055)", () => {
  it("gives the ladder's length for a piece of no width, and 2√2·a − 2w for equal corridors", () => {
    expect(longestAroundCorner(100, 100, 0)).toBeCloseTo(200 * Math.SQRT2, 6);
    expect(longestAroundCorner(90, 120, 0)).toBeCloseTo((90 ** (2 / 3) + 120 ** (2 / 3)) ** 1.5, 6);
    // Equal corridors: by symmetry the tightest angle is 45°.
    expect(longestAroundCorner(100, 100, 40)).toBeCloseTo(2 * Math.SQRT2 * 100 - 80, 6);
    expect(cornerLength(Math.PI / 4, 100, 100, 40)).toBeCloseTo(2 * Math.SQRT2 * 100 - 80, 9);
  });

  it("allows nothing wider than either corridor", () => {
    expect(longestAroundCorner(80, 100, 81)).toBe(0);
    expect(longestAroundCorner(100, 80, 81)).toBe(0);
  });

  it("agrees with a brute-force sweep of every angle on 60 random corners", () => {
    const next = random(55);
    for (let trial = 0; trial < 60; trial += 1) {
      const a = 70 + next() * 80;
      const b = 70 + next() * 80;
      const w = next() * Math.min(a, b) * 0.9;
      const limit = longestAroundCorner(a, b, w);
      // Half a centimetre either side of the limit: the sweep samples angles, so exactly at it is a coin toss.
      expect(turnsBruteForce(a, b, limit - 0.5, w), `a=${a} b=${b} w=${w}`).toBe(true);
      expect(turnsBruteForce(a, b, limit + 0.5, w), `a=${a} b=${b} w=${w}`).toBe(false);
    }
  });
});

describe("through a door: Carver's condition", () => {
  it("fits square on, turned, or not at all, as hand-worked", () => {
    expect(rectangleFits(70, 60, 80, 200)).toBe(true);
    // A 100 × 10 bar in a 90 × 90 opening: only on the diagonal.
    expect(rectangleFits(100, 10, 90, 90)).toBe(true);
    // A 130 × 10 bar is longer than that opening's diagonal (127).
    expect(rectangleFits(130, 10, 90, 90)).toBe(false);
    expect(rectangleFits(95, 85, 80, 200)).toBe(false);
  });

  it("agrees with turning the rectangle by brute force on 300 random cases", () => {
    const next = random(1956);
    let turned = 0;
    for (let trial = 0; trial < 300; trial += 1) {
      const a = 40 + next() * 80;
      const b = 40 + next() * 80;
      const p = 20 + next() * 140;
      const q = 5 + next() * 60;
      const exact = rectangleFits(p, q, a, b);
      // Away from the boundary (a 1% margin each way), the two must agree.
      if (rectangleFits(p * 1.01, q * 1.01, a, b) !== rectangleFits(p * 0.99, q * 0.99, a, b)) continue;
      expect(exact, `${p}×${q} in ${a}×${b}`).toBe(rectangleFitsBruteForce(p, q, a, b));
      if (exact && Math.max(p, q) > Math.max(a, b)) turned += 1;
    }
    // The random cases include some that only fit turned, so that branch is really tested.
    expect(turned).toBeGreaterThan(0);
  });

  it("finds the side to carry a wardrobe through a door, and says what a sofa misses it by", () => {
    const wardrobe = throughDoor({ w: 70, d: 60, h: 180 }, 80, 200);
    // Its 60 cm side across the doorway leaves 20 cm, more than its 70 cm side would (10 cm).
    expect(wardrobe).toMatchObject({ fits: true, marginCm: 20 });
    // The Canova's smallest side is 93 × 102: 13 cm too wide for an 80 cm door.
    const sofa = throughDoor({ w: 233, d: 102, h: 93 }, 80, 200);
    expect(sofa).toMatchObject({ fits: false, marginCm: -13 });
  });
});

describe("tilting under the ceiling", () => {
  it("stands a piece on its end when the ceiling allows, and keeps it flat when a tilt only makes it longer", () => {
    expect(tiltUnder(200, 50, 250).plan).toBeCloseTo(50, 9);
    expect(tiltUnder(200, 50, 120)).toEqual({ phi: 0, plan: 200 });
    expect(tiltUnder(200, 50, 40).plan).toBe(Infinity);
  });

  it("raises a long thin piece until its top meets the ceiling, which shortens its plan", () => {
    const { phi, plan } = tiltUnder(200, 20, 150);
    expect(200 * Math.sin(phi) + 20 * Math.cos(phi)).toBeCloseTo(150, 6);
    expect(plan).toBeCloseTo(200 * Math.cos(phi) + 20 * Math.sin(phi), 9);
    expect(plan).toBeLessThan(165);
    expect(plan).toBeGreaterThan(155);
  });

  it("turns a corner tilted that it could not turn flat", () => {
    // A 230 × 40 × 15 headboard round a 75/75 corner under a 210 cm ceiling: on its 40 cm edge it is 15 cm
    // wide in plan, so the corner takes 2√2·75 − 30 ≈ 182 cm; flat it is 230, tilted about 54° it is about 167.
    const flat = longestAroundCorner(75, 75, 40);
    expect(230).toBeGreaterThan(flat);
    const result = roundCorner({ w: 230, d: 40, h: 15 }, 75, 75, 210);
    expect(result.fits).toBe(true);
    expect(result.carry?.tiltDegrees).toBeGreaterThan(0);
  });
});

describe("the whole way in", () => {
  it("reports every step, and the first that fails", () => {
    const result = wayIn({ w: 233, d: 102, h: 93 }, [
      { kind: "door", width: 110, height: 210 },
      { kind: "turn", from: 120, to: 110, ceiling: 250 },
      { kind: "door", width: 80, height: 200 },
    ]);
    expect(result.fits).toBe(false);
    expect(result.firstFailure).toBe(2);
    expect(result.steps.map((step) => step.fits)).toEqual([true, true, false]);
    expect(result.steps[2]!.marginCm).toBe(-13);
  });

  it("carries a piece up a straight flight when it fits the width and the headroom", () => {
    expect(upStairs({ w: 90, d: 45, h: 75 }, 95, 200)).toMatchObject({ fits: true });
    expect(upStairs({ w: 120, d: 100, h: 100 }, 90, 200)).toMatchObject({ fits: false, marginCm: -10 });
  });
});
