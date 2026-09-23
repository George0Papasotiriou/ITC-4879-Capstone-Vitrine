/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Tests for the .glb writer and the shapes built from a product's dimensions.
 */

import { describe, expect, it } from "vitest";

import { baseColor, glbFromParts, type Part } from "@/lib/catalog/glb";
import { hasShape, shapeColour, shapeFor } from "@/lib/catalog/shape";

const cube: Part = { x: 0, y: 0.5, z: 0, width: 1, height: 1, depth: 1, color: "#8a5f3c" };

/** Reads a .glb back the way a viewer would: header, JSON chunk, binary chunk. */
function parse(file: Uint8Array) {
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  const magic = view.getUint32(0, true);
  const version = view.getUint32(4, true);
  const total = view.getUint32(8, true);
  const jsonLength = view.getUint32(12, true);
  const jsonType = view.getUint32(16, true);
  const json = JSON.parse(new TextDecoder().decode(file.subarray(20, 20 + jsonLength))) as Record<string, never>;
  const binLength = view.getUint32(20 + jsonLength, true);
  const binType = view.getUint32(24 + jsonLength, true);
  return { magic, version, total, jsonLength, jsonType, json, binLength, binType, bin: file.subarray(28 + jsonLength, 28 + jsonLength + binLength) };
}

describe("writing a .glb", () => {
  it("writes a file a viewer can read: magic, version, two chunks", () => {
    const file = glbFromParts([cube], { name: "Cube" });
    const read = parse(file);

    expect(read.magic).toBe(0x46546c67); // "glTF"
    expect(read.version).toBe(2);
    expect(read.total).toBe(file.byteLength);
    expect(read.jsonType).toBe(0x4e4f534a); // "JSON"
    expect(read.binType).toBe(0x004e4942); // "BIN\0"
    // Every chunk starts on a multiple of four, so the whole file does too.
    expect(file.byteLength % 4).toBe(0);
    expect(read.jsonLength % 4).toBe(0);
  });

  it("describes one mesh with a primitive per part", () => {
    const read = parse(glbFromParts([cube, { ...cube, y: 1.5, color: "#3e5c8f" }]));
    const gltf = read.json as unknown as {
      meshes: { primitives: unknown[] }[];
      materials: { pbrMetallicRoughness: { baseColorFactor: number[] } }[];
      accessors: { count: number; type: string; min?: number[]; max?: number[] }[];
      buffers: { byteLength: number }[];
    };

    expect(gltf.meshes).toHaveLength(1);
    expect(gltf.meshes[0]!.primitives).toHaveLength(2);
    expect(gltf.materials).toHaveLength(2);
    // Positions, normals and indices for each part.
    expect(gltf.accessors).toHaveLength(6);
    expect(gltf.accessors[0]).toMatchObject({ count: 24, type: "VEC3" });
    expect(gltf.accessors[2]).toMatchObject({ count: 36, type: "SCALAR" });
    expect(gltf.buffers[0]!.byteLength).toBe(read.bin.byteLength);
  });

  it("says where the part is, in metres", () => {
    const gltf = parse(glbFromParts([cube])).json as unknown as { accessors: { min?: number[]; max?: number[] }[] };
    expect(gltf.accessors[0]!.min).toEqual([-0.5, 0, -0.5]);
    expect(gltf.accessors[0]!.max).toEqual([0.5, 1, 0.5]);
  });

  it("needs something to build", () => {
    expect(() => glbFromParts([])).toThrow(RangeError);
  });
});

describe("colours in a model", () => {
  it("converts sRGB to the linear light glTF expects", () => {
    expect(baseColor("#ffffff")).toEqual([1, 1, 1, 1]);
    expect(baseColor("#000000")).toEqual([0, 0, 0, 1]);
    // Mid grey is darker in linear light than its hex suggests.
    const [red] = baseColor("#808080");
    expect(red).toBeGreaterThan(0.2);
    expect(red).toBeLessThan(0.3);
  });

  it("falls back rather than writing a broken colour", () => {
    expect(baseColor("rebeccapurple")[3]).toBe(1);
    expect(baseColor("#12345")).toEqual(baseColor("nonsense"));
  });

  it("builds in the colour the catalogue names, or a warm grey when it names none", () => {
    expect(shapeColour(["green"]).g).toBeGreaterThan(shapeColour(["green"]).r);
    expect(shapeColour([])).toMatchObject({ r: 176 });
  });
});

/** The bounding box of a shape, in metres. */
function extent(parts: readonly Part[]) {
  const axis = (pick: (part: Part) => [number, number]) => {
    const values = parts.flatMap((part) => pick(part));
    return { min: Math.min(...values), max: Math.max(...values) };
  };
  return {
    x: axis((part) => [part.x - part.width / 2, part.x + part.width / 2]),
    y: axis((part) => [part.y - part.height / 2, part.y + part.height / 2]),
    z: axis((part) => [part.z - part.depth / 2, part.z + part.depth / 2]),
  };
}

describe("the shape of a piece", () => {
  const dims = { w: 200, d: 90, h: 85 };

  it("is only offered for what can stand or lie on a floor", () => {
    expect(hasShape("SOFA", dims)).toBe(true);
    expect(hasShape("RUG", dims)).toBe(true);
    // A mirror needs a wall, which neither this nor the room planner measures.
    expect(hasShape("HOME_MIRROR", dims)).toBe(false);
    expect(hasShape("SOFA", null)).toBe(false);
  });

  it("is exactly the size the catalogue says, standing on the floor", () => {
    for (const [kind, size] of [
      ["SOFA", dims],
      ["TABLE", { w: 120, d: 80, h: 75 }],
      ["LAMP", { w: 30, d: 30, h: 150 }],
      ["BED", { w: 160, d: 200, h: 100 }],
      ["SHELF", { w: 80, d: 35, h: 180 }],
      ["CABINET", { w: 90, d: 45, h: 120 }],
    ] as const) {
      const box = extent(shapeFor(kind, size, { r: 120, g: 84, b: 58 }));
      expect(box.y.min, kind).toBeCloseTo(0, 5);
      expect(box.y.max, kind).toBeCloseTo(size.h / 100, 5);
      expect(box.x.max - box.x.min, kind).toBeCloseTo(size.w / 100, 5);
      expect(box.z.max - box.z.min, kind).toBeCloseTo(size.d / 100, 5);
      // Centred, so a viewer orbits around the piece and not beside it.
      expect(box.x.min + box.x.max, kind).toBeCloseTo(0, 5);
    }
  });

  it("gives a sofa a seat, a back and arms, and a stool neither", () => {
    const sofa = shapeFor("SOFA", dims, { r: 120, g: 84, b: 58 });
    expect(sofa.length).toBe(5);
    // The back sits behind the seat, towards negative z.
    expect(sofa[2]!.z).toBeLessThan(0);

    const narrow = shapeFor("CHAIR", { w: 45, d: 45, h: 85 }, { r: 120, g: 84, b: 58 });
    expect(narrow).toHaveLength(3);
    expect(shapeFor("OTTOMAN", { w: 50, d: 50, h: 40 }, { r: 120, g: 84, b: 58 })).toHaveLength(1);
  });

  it("gives a table four legs under its top", () => {
    const table = shapeFor("TABLE", { w: 120, d: 80, h: 75 }, { r: 120, g: 84, b: 58 });
    expect(table).toHaveLength(5);
    const [top, ...legs] = table;
    expect(top!.y).toBeGreaterThan(0.7);
    for (const leg of legs) expect(leg.y).toBeLessThan(top!.y);
  });

  it("lays a rug flat", () => {
    const [rug] = shapeFor("RUG", { w: 200, d: 140, h: 2 }, { r: 200, g: 200, b: 190 });
    expect(rug!.height).toBeLessThan(0.02);
    expect(rug!.width).toBeCloseTo(2, 5);
  });
});
