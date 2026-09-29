/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Tests for light harmonisation and for the colour difference that measures it.
 */

import { describe, expect, it } from "vitest";

import { deltaE2000 } from "@/lib/vision/delta-e";
import { applyMatrix, estimateLight, harmonizeMatrix, shadowFor, toLinear, toSrgb } from "@/lib/vision/harmonize";

/** A room photo made of one colour, optionally brighter towards one side. */
function room(width: number, height: number, colour: (x: number, y: number) => [number, number, number]): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = colour(x, y);
      pixels.set([r, g, b, 255], (y * width + x) * 4);
    }
  }
  return pixels;
}

describe("deltaE2000", () => {
  // Sharma, Wu and Dalal (2005), Table 1: pairs and their published differences.
  const pairs: [[number, number, number], [number, number, number], number][] = [
    [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
    [[50, 3.1571, -77.2803], [50, 0, -82.7485], 2.8615],
    [[50, 2.8361, -74.02], [50, 0, -82.7485], 3.4412],
    [[50, -1.3802, -84.2814], [50, 0, -82.7485], 1.0],
    [[50, 0, 0], [50, -1, 2], 2.3669],
    [[50, 2.5, 0], [73, 25, -18], 27.1492],
    [[60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644],
    [[2.0776, 0.0795, -1.135], [0.9033, -0.0636, -0.5514], 0.9082],
  ];

  it("gives the published differences", () => {
    for (const [[L1, a1, b1], [L2, a2, b2], expected] of pairs) {
      expect(deltaE2000({ L: L1, a: a1, b: b1 }, { L: L2, a: a2, b: b2 })).toBeCloseTo(expected, 4);
    }
  });

  it("is zero for a colour and itself, and the same either way round", () => {
    const colour = { L: 40, a: 12, b: -30 };
    expect(deltaE2000(colour, colour)).toBe(0);
    expect(deltaE2000(colour, { L: 55, a: 2, b: 8 })).toBeCloseTo(deltaE2000({ L: 55, a: 2, b: 8 }, colour), 10);
  });
});

/** A room: a wall above, a floor below, each its own colour. */
const wallAndFloor = (wall: [number, number, number], floor: [number, number, number]) => room(80, 60, (_, y) => (y < 20 ? wall : floor));

describe("estimateLight", () => {
  it("leaves a neutral, brightly lit room almost as it is", () => {
    const light = estimateLight(wallAndFloor([250, 250, 250], [150, 150, 150]), 80, 60, [40, 45], 15);
    expect(light.tint.map((gain) => Math.round(gain * 100) / 100)).toEqual([1, 1, 1]);
    expect(light.exposure).toBeGreaterThan(0.9);
    expect(light.towardsLight).toBeNull();
  });

  it("reads a warm lamp's light from the whitest surfaces, within the limit", () => {
    // A white wall under a warm lamp looks peach; the floor is darker still.
    const light = estimateLight(wallAndFloor([245, 205, 160], [160, 110, 70]), 80, 60, [40, 45], 15);
    expect(light.tint[0]).toBeGreaterThan(1.05);
    expect(light.tint[2]).toBeLessThan(0.95);
    expect(light.tint[2]).toBeGreaterThanOrEqual(0.85);
    expect(light.tint[0]).toBeLessThanOrEqual(1.15);
  });

  it("is not fooled by a brown wooden floor under white light", () => {
    // Gray world, the first version, read this room as warm (docs/adr/042): the floor is two thirds of it.
    const light = estimateLight(wallAndFloor([240, 240, 240], [150, 95, 55]), 80, 60, [40, 45], 15);
    for (const gain of light.tint) expect(gain).toBeCloseTo(1, 2);
  });

  it("darkens the piece in a dim room, and leaves clipped highlights out of the colour", () => {
    const dim = estimateLight(wallAndFloor([120, 120, 120], [60, 60, 60]), 80, 60, [40, 45], 15);
    expect(dim.exposure).toBeLessThan(0.3);
    expect(dim.exposure).toBeGreaterThanOrEqual(0.25);
    // A blown-out window (white, clipped) beside a warm wall: brightness from the window, colour from the wall.
    const window = estimateLight(room(80, 60, (x, y) => (y < 20 ? (x < 8 ? [255, 255, 255] : [240, 200, 160]) : [90, 70, 50])), 80, 60, [40, 45], 15);
    expect(window.tint[0]).toBeGreaterThan(1.05);
  });

  it("finds which side the light comes from, and casts the shadow the other way", () => {
    // Light from the left: brightness falls from left to right across the floor.
    const light = estimateLight(room(100, 80, (x) => { const v = Math.round(230 - x * 1.6); return [v, v, v]; }), 100, 80, [50, 50], 25);
    expect(light.towardsLight![0]).toBeLessThan(-0.9);
    expect(light.strength).toBeGreaterThan(0.2);
    const shadow = shadowFor(light, 200);
    expect(shadow.dx).toBeGreaterThan(0);
    expect(shadow.opacity).toBeGreaterThan(0.2);
  });
});

describe("applyMatrix", () => {
  it("changes nothing with unit gains, and leaves transparent pixels and alpha alone", () => {
    const pixels = new Uint8ClampedArray([10, 128, 250, 255, 99, 99, 99, 0, 200, 150, 100, 128]);
    const copy = Uint8ClampedArray.from(pixels);
    applyMatrix(pixels, [1, 1, 1]);
    expect([...pixels]).toEqual([...copy]);
    applyMatrix(pixels, [0.5, 0.5, 0.5]);
    expect(pixels[7]).toBe(0);
    expect([pixels[4], pixels[5], pixels[6]]).toEqual([99, 99, 99]);
    expect(pixels[11]).toBe(128);
    expect(pixels[8]).toBeLessThan(200);
  });

  it("works in linear light: halving the light is not halving the number", () => {
    const pixels = new Uint8ClampedArray([200, 200, 200, 255]);
    applyMatrix(pixels, harmonizeMatrix({ tint: [1, 1, 1], exposure: 0.5, towardsLight: null, strength: 0 }));
    expect(pixels[0]).toBe(toSrgb(toLinear(200) * 0.5));
    expect(pixels[0]).toBeGreaterThan(100);
  });
});
