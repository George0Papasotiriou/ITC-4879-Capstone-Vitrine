/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Unit tests for product cutouts from white backgrounds.
 */

import { describe, expect, it } from "vitest";

import { cutoutFromWhite } from "@/lib/vision/cutout";

/** An image filled with `ground`, with rectangles painted on top in order. */
function image(width: number, height: number, ground: [number, number, number], rects: { x: number; y: number; w: number; h: number; rgb: [number, number, number] }[]) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) rgba.set([...ground, 255], i * 4);
  for (const rect of rects) {
    for (let y = rect.y; y < rect.y + rect.h; y += 1) for (let x = rect.x; x < rect.x + rect.w; x += 1) rgba.set([...rect.rgb, 255], (y * width + x) * 4);
  }
  return rgba;
}

const alphaAt = (rgba: Uint8ClampedArray, width: number, x: number, y: number) => rgba[(y * width + x) * 4 + 3];

describe("cutout from a photo on white", () => {
  it("removes the white background and finds the product's bounding box", () => {
    const rgba = image(100, 80, [252, 252, 252], [{ x: 30, y: 10, w: 40, h: 60, rgb: [90, 60, 40] }]);
    const cutout = cutoutFromWhite(rgba, 100, 80);
    expect(cutout.removed).toBe(true);
    expect(alphaAt(cutout.rgba, 100, 2, 2)).toBe(0);
    expect(alphaAt(cutout.rgba, 100, 50, 40)).toBe(255);
    expect(cutout.box).toEqual({ x: 30, y: 10, width: 40, height: 60 });
  });

  it("keeps white parts enclosed by the product, which are lit and so never flat", () => {
    // A dark frame around a white lamp shade, shaded from 252 at its top to 238 at its foot.
    const rgba = image(100, 100, [255, 255, 255], [{ x: 20, y: 20, w: 60, h: 60, rgb: [40, 40, 40] }]);
    for (let y = 25; y < 75; y += 1) {
      const shade = Math.round(252 - ((y - 25) * 14) / 50);
      for (let x = 25; x < 75; x += 1) rgba.set([shade, shade, shade, 255], (y * 100 + x) * 4);
    }
    const cutout = cutoutFromWhite(rgba, 100, 100, { standing: true });
    expect(alphaAt(cutout.rgba, 100, 50, 50)).toBe(255);
    expect(alphaAt(cutout.rgba, 100, 5, 5)).toBe(0);
  });

  it("takes the studio's white seen between a piece's legs for background", () => {
    // A side table: a top, two legs and a foot rail enclosing the studio's own white.
    const rgba = image(100, 100, [254, 254, 254], [
      { x: 20, y: 20, w: 60, h: 6, rgb: [90, 60, 40] },
      { x: 22, y: 26, w: 5, h: 60, rgb: [30, 30, 30] },
      { x: 73, y: 26, w: 5, h: 60, rgb: [30, 30, 30] },
      { x: 22, y: 80, w: 56, h: 4, rgb: [30, 30, 30] },
    ]);
    const cutout = cutoutFromWhite(rgba, 100, 100, { standing: true });
    expect(alphaAt(cutout.rgba, 100, 50, 50)).toBe(0);
    // A rug or a framed print keeps its enclosed white: only a standing piece is seen through.
    expect(alphaAt(cutoutFromWhite(rgba, 100, 100).rgba, 100, 50, 50)).toBe(255);
    expect(alphaAt(cutout.rgba, 100, 24, 50)).toBe(255);
    expect(alphaAt(cutout.rgba, 100, 50, 22)).toBe(255);
  });

  it("turns a studio's deep, soft shadow into a shadow, and stops at a grey product's sharp edge", () => {
    // In the proportions of the Canova sofa's photograph: a grey sofa (rows 10–78, the same grey as the
    // shadow's core) with a dark seam along its foot (row 79), on a shadow whose core (rows 80–87) is
    // mid-grey and fades to white over 10 rows, as an out-of-focus studio shadow does.
    const rgba = image(100, 110, [252, 252, 252], [{ x: 20, y: 10, w: 60, h: 69, rgb: [123, 123, 123] }]);
    for (let x = 10; x < 90; x += 1) rgba.set([60, 60, 60, 255], (79 * 100 + x) * 4);
    for (let y = 80; y < 98; y += 1) {
      const depth = y < 88 ? 1 : Math.max(0, 1 - (y - 87) / 10);
      // Soft at its ends too, fading over 10 columns on each side.
      for (let x = 0; x < 100; x += 1) {
        const across = Math.max(0, Math.min(1, (x - 4) / 10, (95 - x) / 10));
        const grey = Math.round(252 - (252 - 123) * depth * across);
        rgba.set([grey, grey, grey, 255], (y * 100 + x) * 4);
      }
    }
    const cutout = cutoutFromWhite(rgba, 100, 110, { standing: true });
    const core = (84 * 100 + 50) * 4;
    expect([cutout.rgba[core], cutout.rgba[core + 1], cutout.rgba[core + 2]]).toEqual([0, 0, 0]);
    expect(cutout.rgba[core + 3]).toBeGreaterThan(80);
    // The sofa above its seam is untouched — grey and opaque, even its lowest row in the shadow's band.
    for (const row of [40, 78]) {
      expect(alphaAt(cutout.rgba, 100, 50, row)).toBe(255);
      expect(cutout.rgba[(row * 100 + 50) * 4]).toBe(123);
    }
    // The piece ends at its seam; only the one row of shadow touching that sharp edge stays with it.
    expect(cutout.box.y + cutout.box.height).toBeLessThanOrEqual(81);
  });

  it("keeps pale coloured wood that is bright but not grey", () => {
    const rgba = image(60, 60, [250, 250, 250], [{ x: 10, y: 10, w: 40, h: 40, rgb: [255, 236, 200] }]);
    const cutout = cutoutFromWhite(rgba, 60, 60);
    expect(alphaAt(cutout.rgba, 60, 30, 30)).toBe(255);
  });

  it("turns the studio shadow under a product into a translucent shadow outside the bounding box", () => {
    // A dark sofa (rows 20–59) standing on a light grey studio shadow (rows 60–69).
    const rgba = image(100, 90, [252, 252, 252], [
      { x: 10, y: 60, w: 80, h: 10, rgb: [200, 200, 200] },
      { x: 20, y: 20, w: 60, h: 40, rgb: [70, 70, 75] },
    ]);
    const cutout = cutoutFromWhite(rgba, 100, 90);
    const i = (65 * 100 + 50) * 4;
    expect([cutout.rgba[i], cutout.rgba[i + 1], cutout.rgba[i + 2]]).toEqual([0, 0, 0]);
    expect(cutout.rgba[i + 3]).toBeGreaterThan(20);
    expect(cutout.rgba[i + 3]).toBeLessThan(160);
    expect(cutout.box).toEqual({ x: 20, y: 20, width: 60, height: 40 });
  });

  it("keeps the upper part of a light grey product that touches the background", () => {
    const rgba = image(100, 100, [252, 252, 252], [{ x: 20, y: 10, w: 60, h: 80, rgb: [205, 205, 205] }]);
    const cutout = cutoutFromWhite(rgba, 100, 100);
    expect(alphaAt(cutout.rgba, 100, 50, 20)).toBe(255);
    expect(cutout.rgba[(20 * 100 + 50) * 4]).toBe(205);
  });

  it("leaves a photo that is not on white untouched", () => {
    const rgba = image(60, 60, [120, 140, 110], [{ x: 10, y: 10, w: 40, h: 40, rgb: [200, 200, 200] }]);
    const cutout = cutoutFromWhite(rgba, 60, 60);
    expect(cutout.removed).toBe(false);
    expect(cutout.box).toEqual({ x: 0, y: 0, width: 60, height: 60 });
    expect(alphaAt(cutout.rgba, 60, 0, 0)).toBe(255);
  });

  it("does not modify the input", () => {
    const rgba = image(20, 20, [255, 255, 255], [{ x: 5, y: 5, w: 10, h: 10, rgb: [0, 0, 0] }]);
    cutoutFromWhite(rgba, 20, 20);
    expect(alphaAt(rgba, 20, 0, 0)).toBe(255);
  });
});
