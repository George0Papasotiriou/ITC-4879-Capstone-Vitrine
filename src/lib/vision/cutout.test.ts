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

  it("keeps white parts enclosed by the product", () => {
    // A dark frame around a white lamp shade.
    const rgba = image(100, 100, [255, 255, 255], [
      { x: 20, y: 20, w: 60, h: 60, rgb: [40, 40, 40] },
      { x: 25, y: 25, w: 50, h: 50, rgb: [255, 255, 255] },
    ]);
    const cutout = cutoutFromWhite(rgba, 100, 100);
    expect(alphaAt(cutout.rgba, 100, 50, 50)).toBe(255);
    expect(alphaAt(cutout.rgba, 100, 5, 5)).toBe(0);
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
