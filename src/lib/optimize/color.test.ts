/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Unit tests for colour space conversion and colour harmony.
 */

import { describe, expect, it } from "vitest";

import {
  COLOR_SWATCHES,
  harmony,
  hexToRgb,
  hueDifference,
  labToLch,
  NEUTRAL_CHROMA,
  paletteHarmony,
  rgbToLab,
  swatch,
} from "@/lib/optimize/color";
import { COLORS } from "@/lib/search/vocabulary";

describe("sRGB to CIELAB", () => {
  // Reference values from the CIE formulas with a D65 white (Bruce Lindbloom's calculator).
  it.each([
    ["#ffffff", 100, 0, 0],
    ["#000000", 0, 0, 0],
    ["#ff0000", 53.2408, 80.0925, 67.2032],
    ["#00ff00", 87.7347, -86.1827, 83.1793],
    ["#0000ff", 32.297, 79.1875, -107.8602],
    ["#808080", 53.585, 0, 0],
  ])("%s", (hex, L, a, b) => {
    const lab = rgbToLab(hexToRgb(hex));
    expect(lab.L).toBeCloseTo(L, 1);
    expect(lab.a).toBeCloseTo(a, 1);
    expect(lab.b).toBeCloseTo(b, 1);
  });

  it("rejects malformed hex", () => {
    expect(() => hexToRgb("#fff")).toThrow(RangeError);
    expect(() => hexToRgb("red")).toThrow(RangeError);
  });
});

describe("LCh and hue angles", () => {
  it("puts red near 40° and blue near 306°", () => {
    expect(labToLch(rgbToLab(hexToRgb("#ff0000"))).h).toBeCloseTo(40, 0);
    expect(labToLch(rgbToLab(hexToRgb("#0000ff"))).h).toBeCloseTo(306.3, 0);
  });

  it("measures the shorter way round the hue circle", () => {
    expect(hueDifference(10, 350)).toBe(20);
    expect(hueDifference(0, 180)).toBe(180);
    expect(hueDifference(90, 90)).toBe(0);
  });
});

describe("harmony", () => {
  const vivid = (h: number, C = 60) => ({ L: 50, C, h });

  it("treats neutrals as compatible with anything", () => {
    expect(harmony({ L: 90, C: 2, h: 0 }, vivid(120))).toBe(0.5);
  });

  it("rewards analogous and complementary hues, analogous most", () => {
    expect(harmony(vivid(40), vivid(60))).toBe(1);
    expect(harmony(vivid(40), vivid(220))).toBe(0.8);
  });

  it("penalises clashing hues more when both colours are vivid", () => {
    const loud = harmony(vivid(40, 70), vivid(130, 70));
    const muted = harmony(vivid(40, 22), vivid(130, 22));
    expect(loud).toBe(-1);
    expect(muted).toBeLessThan(0);
    expect(muted).toBeGreaterThan(loud);
  });

  it("is symmetric and bounded", () => {
    for (let h1 = 0; h1 < 360; h1 += 37) {
      for (let h2 = 0; h2 < 360; h2 += 41) {
        const x = harmony(vivid(h1, 40), vivid(h2, 65));
        expect(x).toBe(harmony(vivid(h2, 65), vivid(h1, 40)));
        expect(x).toBeGreaterThanOrEqual(-1);
        expect(x).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("catalogue palettes", () => {
  it("has a swatch for every colour the vocabulary knows", () => {
    expect(Object.keys(COLOR_SWATCHES).sort()).toEqual(Object.keys(COLORS).sort());
  });

  it("classifies the neutral swatches as neutral and the named colours as chromatic", () => {
    for (const id of ["black", "white", "grey", "silver"]) expect(swatch(id)!.C, id).toBeLessThan(NEUTRAL_CHROMA);
    for (const id of ["red", "blue", "green", "yellow", "orange"]) expect(swatch(id)!.C, id).toBeGreaterThan(NEUTRAL_CHROMA);
  });

  it("scores a grey sofa with a blue rug above a red chair with a green lamp", () => {
    expect(paletteHarmony(["grey"], ["blue"])).toBeGreaterThan(paletteHarmony(["red"], ["green"]));
  });

  it("is neutral about products with unknown colours", () => {
    expect(paletteHarmony([], ["red"])).toBe(0);
    expect(paletteHarmony(["unknown-id"], ["red"])).toBe(0);
  });

  it("averages over every pairing of colours", () => {
    const mixed = paletteHarmony(["red", "grey"], ["blue"]);
    expect(mixed).toBeCloseTo((harmony(swatch("red")!, swatch("blue")!) + 0.5) / 2, 10);
  });
});
