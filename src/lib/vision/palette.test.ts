/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Tests for reading a photograph's colours: naming, clustering, and what is worth searching for.
 */

import { describe, expect, it } from "vitest";

import { cluster, nameColour, palette, pixelsFrom, searchableColours, withoutBackground, type Rgb } from "@/lib/vision/palette";

const repeat = (pixel: Rgb, times: number): Rgb[] => Array.from({ length: times }, () => pixel);

describe("naming a colour", () => {
  it("uses the shop's own words", () => {
    expect(nameColour({ r: 12, g: 12, b: 14 })).toBe("black");
    expect(nameColour({ r: 250, g: 250, b: 248 })).toBe("white");
    expect(nameColour({ r: 140, g: 142, b: 146 })).toBe("grey");
    expect(nameColour({ r: 120, g: 82, b: 56 })).toBe("brown");
    expect(nameColour({ r: 224, g: 212, b: 190 })).toBe("beige");
    expect(nameColour({ r: 40, g: 60, b: 100 })).toBe("blue");
    expect(nameColour({ r: 92, g: 126, b: 80 })).toBe("green");
    expect(nameColour({ r: 190, g: 108, b: 58 })).toBe("orange");
  });

  it("puts a colour between two words with the nearer one", () => {
    // A warm off-white is beige rather than white once it leaves the grey axis.
    expect(nameColour({ r: 228, g: 216, b: 194 })).toBe("beige");
    // Charcoal is grey, not black.
    expect(nameColour({ r: 96, g: 100, b: 106 })).toBe("grey");
  });

  it("keeps a pale colour's hue instead of calling it a metal", () => {
    // Sage: pale, barely coloured, and green to anyone looking at it. In plain
    // RGB distance it sits nearer the silver anchors than the green ones.
    expect(nameColour({ r: 169, g: 181, b: 164 })).toBe("green");
    // Ink: dark and barely coloured, but blue rather than black.
    expect(nameColour({ r: 43, g: 50, b: 66 })).toBe("blue");
  });

  it("uses a neutral word when there is no hue left", () => {
    expect(nameColour({ r: 176, g: 178, b: 180 })).toBe("silver");
    expect(nameColour({ r: 60, g: 60, b: 60 })).toBe("black");
  });
});

describe("clustering", () => {
  it("gives the same answer every time", () => {
    const pixels = [...repeat({ r: 10, g: 10, b: 10 }, 60), ...repeat({ r: 240, g: 240, b: 240 }, 40)];
    const first = cluster(pixels, 2);
    const second = cluster(pixels, 2);
    expect(first).toEqual(second);
  });

  it("finds the parts of the picture, biggest first", () => {
    const pixels = [...repeat({ r: 20, g: 20, b: 24 }, 70), ...repeat({ r: 230, g: 220, b: 200 }, 30)];
    const found = cluster(pixels, 2);
    expect(found).toHaveLength(2);
    expect(found[0]!.share).toBeCloseTo(0.7, 1);
    expect(nameColour(found[0]!.centre)).toBe("black");
    expect(nameColour(found[1]!.centre)).toBe("beige");
  });

  it("says nothing about an empty picture", () => {
    expect(cluster([], 3)).toEqual([]);
    expect(palette([])).toEqual([]);
  });
});

describe("the palette of a photograph", () => {
  it("names the colours and how much of the picture they cover", () => {
    const pixels = [
      ...repeat({ r: 226, g: 214, b: 193 }, 50), // beige wall
      ...repeat({ r: 120, g: 84, b: 58 }, 30), // brown table
      ...repeat({ r: 40, g: 58, b: 96 }, 20), // blue cushion
    ];
    const found = palette(pixels, { k: 3 });
    expect(found.map((entry) => entry.color)).toEqual(["beige", "brown", "blue"]);
    expect(found[0]!.share).toBeCloseTo(0.5, 1);
  });

  it("drops a speck that is not a colour in the picture", () => {
    const pixels = [...repeat({ r: 226, g: 214, b: 193 }, 98), ...repeat({ r: 200, g: 40, b: 40 }, 2)];
    expect(palette(pixels, { k: 3 }).map((entry) => entry.color)).toEqual(["beige"]);
  });

  it("adds up a colour the clustering found twice", () => {
    const pixels = [...repeat({ r: 120, g: 84, b: 58 }, 50), ...repeat({ r: 128, g: 90, b: 62 }, 50)];
    const found = palette(pixels, { k: 2 });
    expect(found).toHaveLength(1);
    expect(found[0]!.color).toBe("brown");
    expect(found[0]!.share).toBeCloseTo(1, 2);
  });
});

describe("pixels from bytes", () => {
  it("reads RGB and RGBA, and skips what is transparent", () => {
    const rgb = new Uint8Array([10, 20, 30, 40, 50, 60]);
    expect(pixelsFrom(rgb, 3, 1)).toEqual([{ r: 10, g: 20, b: 30 }, { r: 40, g: 50, b: 60 }]);

    const rgba = new Uint8Array([10, 20, 30, 255, 40, 50, 60, 0]);
    expect(pixelsFrom(rgba, 4, 1)).toEqual([{ r: 10, g: 20, b: 30 }]);
  });

  it("samples rather than reading every pixel", () => {
    const many = new Uint8Array(4 * 100).fill(255);
    expect(pixelsFrom(many, 4, 4)).toHaveLength(25);
  });
});

describe("a plain background", () => {
  // A 10x10 picture: a white ground with a sage square in the middle.
  const ground = { r: 245, g: 245, b: 243 };
  const object = { r: 169, g: 181, b: 164 };
  const studio = Array.from({ length: 100 }, (_, index) => {
    const x = index % 10;
    const y = Math.floor(index / 10);
    return x >= 3 && x <= 6 && y >= 3 && y <= 6 ? object : ground;
  });

  it("drops the ground and leaves the object", () => {
    const kept = withoutBackground(studio, 10, 10);
    expect(kept).toHaveLength(16);
    expect(palette(kept)[0]!.color).toBe("green");
  });

  it("changes nothing when the border is not one colour", () => {
    const room = studio.map((pixel, index) => (index % 3 === 0 ? { r: 120, g: 84, b: 58 } : pixel));
    expect(withoutBackground(room, 10, 10)).toEqual(room);
  });

  it("keeps a picture that really is one colour", () => {
    const plain = Array.from({ length: 100 }, () => ground);
    expect(withoutBackground(plain, 10, 10)).toEqual(plain);
  });
});

describe("what is worth searching for", () => {
  it("takes the colours that cover the picture", () => {
    const entries = [
      { color: "beige" as const, share: 0.5, rgb: { r: 226, g: 214, b: 193 } },
      { color: "brown" as const, share: 0.3, rgb: { r: 120, g: 84, b: 58 } },
      { color: "red" as const, share: 0.07, rgb: { r: 168, g: 48, b: 44 } },
    ];
    expect(searchableColours(entries)).toEqual(["beige", "brown"]);
  });

  it("falls back to whatever there is when nothing is large", () => {
    const entries = [
      { color: "red" as const, share: 0.09, rgb: { r: 168, g: 48, b: 44 } },
      { color: "blue" as const, share: 0.08, rgb: { r: 40, g: 58, b: 96 } },
    ];
    expect(searchableColours(entries)).toEqual(["red", "blue"]);
  });
});
