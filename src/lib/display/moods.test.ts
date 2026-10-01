/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Tests for the shop window's light: colour temperatures as colours, the sun's direction, and the ease between moods.
 */

import { describe, expect, it } from "vitest";

import { blendMoods, kelvinToLinearRgb, MOODS, planckianXy, sunDirection, TEMPLATE_MOODS } from "@/lib/display/moods";
import { THEMES } from "@/lib/display/themes";

describe("colour temperature", () => {
  it("lies on the Planckian locus as published (CIE 1931 x, y)", () => {
    // Reference chromaticities of a black body (Wyszecki & Stiles): 2856 K is illuminant A, 0.4476, 0.4074.
    const a = planckianXy(2856);
    // The fit is good to about 0.0005 in x and y, far below what an eye can tell apart.
    expect(a.x).toBeCloseTo(0.4476, 2);
    expect(a.y).toBeCloseTo(0.4074, 2);
    const k5000 = planckianXy(5000);
    expect(k5000.x).toBeCloseTo(0.3451, 2);
    expect(k5000.y).toBeCloseTo(0.3516, 2);
  });

  it("6500 K is close to white, warm light is red-heavy and cool light blue-heavy", () => {
    const daylight = kelvinToLinearRgb(6500);
    for (const channel of [daylight.r, daylight.g, daylight.b]) expect(channel).toBeGreaterThan(0.88);
    const candle = kelvinToLinearRgb(2400);
    expect(candle.r).toBe(1);
    expect(candle.b).toBeLessThan(0.25);
    const sky = kelvinToLinearRgb(9000);
    expect(sky.b).toBe(1);
    expect(sky.r).toBeLessThan(0.95);
  });

  it("gets steadily warmer as the temperature falls", () => {
    let previous = Infinity;
    for (let kelvin = 2000; kelvin <= 10_000; kelvin += 250) {
      const { r, b } = kelvinToLinearRgb(kelvin);
      const warmth = r / Math.max(b, 1e-6);
      expect(warmth).toBeLessThan(previous);
      previous = warmth;
    }
  });
});

describe("moods", () => {
  it("every theme and every room has a mood", () => {
    for (const theme of THEMES) expect(MOODS[theme.mood]).toBeDefined();
    for (const mood of Object.values(TEMPLATE_MOODS)) expect(MOODS[mood]).toBeDefined();
  });

  it("the sun comes in through the window on the left, downwards", () => {
    for (const mood of Object.values(MOODS)) {
      const d = sunDirection(mood);
      expect(Math.hypot(d.x, d.y, d.z)).toBeCloseTo(1, 9);
      expect(d.x).toBeGreaterThan(0);
      expect(d.y).toBeLessThan(0);
    }
    // A low sun throws a longer shadow than a high one.
    expect(Math.abs(sunDirection(MOODS.dawn).y)).toBeLessThan(Math.abs(sunDirection(MOODS.noon).y));
  });

  it("eases from one mood to the next: the ends are the moods, lamps fade in", () => {
    const start = blendMoods(MOODS.afternoon, MOODS.dusk, 0);
    const end = blendMoods(MOODS.afternoon, MOODS.dusk, 1);
    expect(start.sun.elevationDeg).toBeCloseTo(MOODS.afternoon.sun.elevationDeg, 9);
    expect(end.sun.kelvin).toBeCloseTo(MOODS.dusk.sun.kelvin, 6);
    expect(start.lamps).toBeNull();
    expect(blendMoods(MOODS.afternoon, MOODS.dusk, 0.5).lamps!.intensity).toBeCloseTo(MOODS.dusk.lamps!.intensity / 2, 9);
    // Halfway in mireds: between the two temperatures, nearer the warmer.
    const half = blendMoods(MOODS.noon, MOODS.dusk, 0.5).sun.kelvin;
    expect(half).toBeGreaterThan(MOODS.dusk.sun.kelvin);
    expect(half).toBeLessThan((MOODS.dusk.sun.kelvin + MOODS.noon.sun.kelvin) / 2);
  });
});
