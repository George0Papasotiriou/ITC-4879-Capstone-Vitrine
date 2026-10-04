/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Unit tests for reading a piece's colours from its studio photograph, band by band.
 */

import { describe, expect, it } from "vitest";

import { lookOfPhoto, paletteFromLook, swatches } from "@/lib/catalog/model/look";
import { difference } from "@/lib/catalog/model/words";
import type { Rgb } from "@/lib/vision/palette";

/** A studio photograph drawn in code: a white ground, and coloured rectangles (x0, y0, x1, y1 as shares of the frame). */
function photo(shapes: { box: [number, number, number, number]; colour: Rgb }[], size = 200): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(size * size * 4).fill(255);
  for (const { box, colour } of shapes) {
    for (let y = Math.round(box[1] * size); y < Math.round(box[3] * size); y += 1) {
      for (let x = Math.round(box[0] * size); x < Math.round(box[2] * size); x += 1) {
        const i = (y * size + x) * 4;
        rgba[i] = colour.r;
        rgba[i + 1] = colour.g;
        rgba[i + 2] = colour.b;
      }
    }
  }
  return rgba;
}

const AQUA: Rgb = { r: 120, g: 196, b: 222 };
const BLACK: Rgb = { r: 30, g: 30, b: 32 };
const CREAM: Rgb = { r: 236, g: 226, b: 206 };
const GREEN: Rgb = { r: 110, g: 150, b: 130 };

describe("lookOfPhoto", () => {
  it("reads a chair as its fabric in the middle and its legs at the bottom", () => {
    // An aqua seat and back on four black legs.
    const chair = photo([
      { box: [0.25, 0.1, 0.75, 0.65], colour: AQUA },
      ...[0.27, 0.42, 0.55, 0.7].map((x) => ({ box: [x, 0.65, x + 0.04, 0.9] as [number, number, number, number], colour: BLACK })),
    ]);
    const look = lookOfPhoto(chair, 200, 200)!;
    const palette = paletteFromLook(look, "CHAIR")!;
    expect(palette.source).toBe("photo");
    expect(difference(palette.main, AQUA)).toBeLessThan(3);
    expect(difference(palette.second!, BLACK)).toBeLessThan(3);
  });

  it("reads a lamp as its shade at the top and its base below", () => {
    const lamp = photo([
      { box: [0.3, 0.1, 0.7, 0.4], colour: CREAM },
      { box: [0.47, 0.4, 0.53, 0.55], colour: BLACK },
      { box: [0.38, 0.55, 0.62, 0.9], colour: GREEN },
    ]);
    const palette = paletteFromLook(lookOfPhoto(lamp, 200, 200)!, "LAMP")!;
    expect(difference(palette.main, CREAM)).toBeLessThan(3);
    expect(difference(palette.second!, GREEN)).toBeLessThan(6);
  });

  it("gives a one-colour piece no second colour", () => {
    const ottoman = photo([{ box: [0.2, 0.3, 0.8, 0.8], colour: AQUA }]);
    const palette = paletteFromLook(lookOfPhoto(ottoman, 200, 200)!, "OTTOMAN")!;
    expect(palette.second).toBeNull();
  });

  it("does not read a room photograph, which has no white ground", () => {
    const room = photo([{ box: [0, 0, 1, 1], colour: GREEN }]);
    expect(lookOfPhoto(room, 200, 200)).toBeNull();
  });
});

describe("swatches", () => {
  it("takes each colour from the middle of its brightness, past shadow and shine", () => {
    // A blue cloth: half in shadow, a little in highlight.
    const pixels: Rgb[] = [];
    for (let i = 0; i < 400; i += 1) pixels.push({ r: 40, g: 70, b: 140 });
    for (let i = 0; i < 500; i += 1) pixels.push({ r: 60, g: 100, b: 190 });
    for (let i = 0; i < 100; i += 1) pixels.push({ r: 230, g: 236, b: 250 });
    const [main] = swatches(pixels, 2);
    expect(main!.colour.b).toBeGreaterThan(150);
    expect(main!.colour.r).toBeLessThan(120);
  });
});
