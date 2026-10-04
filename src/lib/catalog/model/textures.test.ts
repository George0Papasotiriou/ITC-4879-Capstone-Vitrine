/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Unit tests for the drawn textures: every one tiles without a seam, and the normal map leans the right way.
 */

import { describe, expect, it } from "vitest";

import { drawTexture, normalsFromHeight, TEXTURE_KINDS } from "@/lib/catalog/model/textures";

describe("drawn textures", () => {
  it.each(TEXTURE_KINDS)("%s tiles: across its edges it steps no more than between any two neighbouring columns", (kind) => {
    const size = 96;
    const { albedo } = drawTexture(kind, size);
    const at = (x: number, y: number) => albedo[y * size + x]!;
    // The mean step between each pair of neighbouring columns (and rows), the seam pair included.
    const columnStep = (x: number) => Array.from({ length: size }, (_, y) => Math.abs(at(x, y) - at((x + 1) % size, y))).reduce((a, b) => a + b) / size;
    const rowStep = (y: number) => Array.from({ length: size }, (_, x) => Math.abs(at(x, y) - at(x, (y + 1) % size))).reduce((a, b) => a + b) / size;
    const columns = Array.from({ length: size - 1 }, (_, x) => columnStep(x));
    const rows = Array.from({ length: size - 1 }, (_, y) => rowStep(y));
    // A weave's strand edge may fall on the seam, as it falls between other columns: never worse than the worst inside.
    expect(columnStep(size - 1)).toBeLessThanOrEqual(Math.max(...columns) * 1.15 + 0.005);
    expect(rowStep(size - 1)).toBeLessThanOrEqual(Math.max(...rows) * 1.15 + 0.005);
  });

  it.each(TEXTURE_KINDS)("%s stays within 0…1", (kind) => {
    const maps = drawTexture(kind, 32);
    for (const map of [maps.albedo, maps.height, maps.roughness, maps.occlusion]) for (const value of map) expect(value >= 0 && value <= 1).toBe(true);
  });
});

describe("normalsFromHeight", () => {
  it("points a flat surface straight out", () => {
    const flat = normalsFromHeight(new Float32Array(16).fill(0.5), 4, 10);
    for (let i = 0; i < 16; i += 1) expect([flat[i * 3], flat[i * 3 + 1], flat[i * 3 + 2]]).toEqual([128, 128, 255]);
  });

  it("leans a surface rising to the right towards the left, as light falling on a slope does", () => {
    const size = 8;
    const ramp = new Float32Array(size * size);
    for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) ramp[y * size + x] = x / size;
    const normals = normalsFromHeight(ramp, size, 4);
    // In the middle (away from the wrap-round), x of the normal is negative: below 128.
    expect(normals[(4 * size + 4) * 3]!).toBeLessThan(128);
  });
});
