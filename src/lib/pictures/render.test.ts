/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Tests for the drawn showroom's geometry: its floor seen in perspective and the true size of what stands on it.
 */

import { describe, expect, it } from "vitest";

import { SCENE_STYLE_IDS } from "@/lib/pictures/pictures";
import { floorRows, rugOnShowroomFloor, showroomGeometry, showroomSvg } from "@/lib/pictures/render";

describe("the drawn showroom (docs/adr/053)", () => {
  it("draws anything as tall as the eye up to the horizon: the camera's own size rule", () => {
    // Seen from eye height, a standing object exactly that tall reaches eye level wherever it stands.
    const { baseY, horizon, pxPerCm, floorY } = showroomGeometry(1200);
    expect(floorY).toBeLessThan(baseY);
    expect(horizon).toBeLessThan(floorY);
    expect(baseY - 140 * pxPerCm).toBeCloseTo(horizon, 6);
  });

  it("lays floor rows at equal steps of depth: closer together towards the wall, never past it", () => {
    const { floorY, horizon } = showroomGeometry(1200);
    const rows = floorRows(floorY, 1200, horizon, 9);
    expect(rows).toHaveLength(8);
    // Depth is 1 / (y − horizon); equal steps of depth are equal steps of that quantity.
    const depths = [1200, ...rows, floorY].map((y) => 1 / (y - horizon));
    const steps = depths.slice(1).map((depth, k) => depth - depths[k]!);
    for (const step of steps) expect(step).toBeCloseTo(steps[0]!, 9);
    // On the picture the rows crowd towards the wall, and all of them lie on the floor.
    const gaps = [1200, ...rows, floorY].slice(1).map((y, k, all) => (k === 0 ? 1200 : all[k - 1]!) - y);
    for (let k = 1; k < gaps.length; k += 1) expect(gaps[k]!).toBeLessThan(gaps[k - 1]!);
    for (const y of rows) expect(y).toBeGreaterThan(floorY);
    expect(floorRows(floorY, 1200, horizon, 0)).toEqual([]);
  });

  it("lays a rug on the floor in the same perspective as the floor, and never through the wall", () => {
    const { floorY, horizon } = showroomGeometry(1200);
    const [nearLeft, nearRight, farRight, farLeft] = rugOnShowroomFloor(1600, 1200, 183, 122);
    // Near edge lower and wider than the far edge, both on the floor, centred.
    expect(nearLeft[1]).toBeCloseTo(nearRight[1], 9);
    expect(farLeft[1]).toBeCloseTo(farRight[1], 9);
    expect(nearLeft[1]).toBeGreaterThan(farLeft[1]);
    expect(farLeft[1]).toBeGreaterThan(floorY);
    expect((nearLeft[0] + nearRight[0]) / 2).toBeCloseTo(800, 9);
    // Width on the picture falls as 1/depth, and so does the height above the horizon: the two ratios agree.
    const widths = (nearRight[0] - nearLeft[0]) / (farRight[0] - farLeft[0]);
    const heights = (nearLeft[1] - horizon) / (farLeft[1] - horizon);
    expect(widths).toBeCloseTo(heights, 9);
    // The sides meet at the vanishing point on the horizon, like the floor's own planks.
    const slope = (farLeft[0] - nearLeft[0]) / (farLeft[1] - nearLeft[1]);
    expect(nearLeft[0] + slope * (horizon - nearLeft[1])).toBeCloseTo(800, 6);
    // A very deep rug is moved forward rather than drawn under the wall.
    const deep = rugOnShowroomFloor(1600, 1200, 400, 300);
    expect(deep[2][1]).toBeGreaterThan(floorY);
  });

  it("draws each style in its own colours, with a lamp only in the dark and moody room", () => {
    for (const style of SCENE_STYLE_IDS) {
      const svg = showroomSvg(style, 1600, 1200);
      expect(svg, style).not.toMatch(/NaN|undefined|Infinity/);
      expect(svg.includes('id="lamp"'), style).toBe(style === "dark-moody");
    }
    expect(showroomSvg("mediterranean", 1600, 1200)).toContain("#bd7650");
    // Tiles cross the floor in rows; planks only run away from the eye.
    expect(showroomSvg("mediterranean", 1600, 1200)).toMatch(/<line x1="0" y1="\d/);
    expect(showroomSvg("scandinavian", 1600, 1200)).not.toMatch(/<line x1="0" y1="\d/);
  });
});
