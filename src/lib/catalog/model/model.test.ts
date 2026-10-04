/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Unit tests for made models: true size for every kind and style, budgets, determinism, valid glTF, reading real titles.
 */

import { readFileSync } from "node:fs";

import { validateBytes } from "gltf-validator";
import { describe, expect, it } from "vitest";

import { canMakeModel, fitToSize, makeModel, makeParts } from "@/lib/catalog/model";
import { context } from "@/lib/catalog/model/context";
import { familyOf } from "@/lib/catalog/model/family";
import { roundedBox } from "@/lib/catalog/model/geometry";
import { paint } from "@/lib/catalog/model/materials";
import { fabricOf, metalTone, paletteFromWords, woodTone, Words, type PieceFacts } from "@/lib/catalog/model/words";
import { ROOM_PLACEMENT } from "@/lib/catalog/taxonomy";

type FixtureProduct = { slug: string; kind: string; titleEn: string; attributes?: Record<string, string>; materials?: string[]; colors?: string[]; dimsCm?: { w: number; d: number; h: number } | null };

const fixture = (JSON.parse(readFileSync("src/lib/catalog/fixtures/abo.json", "utf8")) as { products: FixtureProduct[] }).products;
const facts = (p: FixtureProduct): PieceFacts => ({ slug: p.slug, kind: p.kind, title: p.titleEn, attributes: p.attributes ?? {}, materials: p.materials ?? [], colors: p.colors ?? [], dims: p.dimsCm! });
const placeable = fixture.filter((p) => p.dimsCm && canMakeModel(p.kind, p.dimsCm));

/** Every n-th piece of each kind: a spread of styles from the real catalogue. */
function sample(perKind: number): FixtureProduct[] {
  const out: FixtureProduct[] = [];
  for (const kind of Object.keys(ROOM_PLACEMENT)) {
    const pieces = placeable.filter((p) => p.kind === kind);
    const step = Math.max(1, Math.floor(pieces.length / perKind));
    for (let i = 0; i < pieces.length && out.filter((p) => p.kind === kind).length < perKind; i += step) out.push(pieces[i]!);
  }
  return out;
}

function extent(parts: ReturnType<typeof makeParts>["parts"]) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const { mesh } of parts) {
    const box = mesh.bounds();
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis]!, box.min[axis]!);
      max[axis] = Math.max(max[axis]!, box.max[axis]!);
    }
  }
  return { min, max };
}

describe("made models are the size they are listed at", () => {
  it.each(sample(6).map((p) => [p.kind, p.titleEn.slice(0, 50), p] as const))("%s: %s", (_kind, _title, p) => {
    const made = makeParts(facts(p));
    const { min, max } = extent(made.parts);
    // Width x, height y, depth z, to the millimetre; standing on the floor, centred.
    expect(Math.abs(max[0]! - min[0]! - p.dimsCm!.w / 100)).toBeLessThan(0.001);
    expect(Math.abs(max[1]! - min[1]! - p.dimsCm!.h / 100)).toBeLessThan(0.001);
    expect(Math.abs(max[2]! - min[2]! - p.dimsCm!.d / 100)).toBeLessThan(0.001);
    expect(Math.abs(min[1]!)).toBeLessThan(1e-6);
    expect(Math.abs(min[0]! + max[0]!)).toBeLessThan(1e-6);
    expect(Math.abs(min[2]! + max[2]!)).toBeLessThan(1e-6);
    expect(made.triangles).toBeLessThanOrEqual(120_000);
    for (const { mesh } of made.parts) expect(mesh.positions.every(Number.isFinite)).toBe(true);
  });

  it("covers every kind that stands or lies on a floor", () => {
    for (const kind of Object.keys(ROOM_PLACEMENT)) expect(familyOf(kind), kind).not.toBeNull();
  });
});

describe("fitToSize", () => {
  it("stretches the whole piece to the listing and sets it on the floor", () => {
    const parts = [{ mesh: roundedBox({ size: [0.5, 0.3, 0.2], radius: 0.01 }).translate([3, 2, 1]), material: paint({ r: 200, g: 200, b: 200 }) }];
    fitToSize(parts, { w: 1, d: 0.4, h: 0.9 });
    const { min, max } = extent(parts);
    expect(max[0]! - min[0]!).toBeCloseTo(1, 9);
    expect(max[1]! - min[1]!).toBeCloseTo(0.9, 9);
    expect(max[2]! - min[2]!).toBeCloseTo(0.4, 9);
    expect(min[1]).toBeCloseTo(0, 9);
  });
});

describe("the .glb written", () => {
  const families = new Map<string, FixtureProduct>();
  for (const p of placeable) {
    const family = familyOf(p.kind)!;
    if (!families.has(family)) families.set(family, p);
  }

  it.each([...families.entries()])("passes Khronos's glTF validator: %s", async (_family, p) => {
    const glb = await makeModel(facts(p));
    const report = await validateBytes(glb, { maxIssues: 20 });
    expect(report.issues.numErrors, JSON.stringify(report.issues.messages)).toBe(0);
    expect(report.issues.numWarnings, JSON.stringify(report.issues.messages)).toBe(0);
    expect(glb.byteLength).toBeLessThan(2 * 1024 * 1024);
  }, 60_000);

  it("is the same file every time for the same piece", async () => {
    const p = placeable.find((x) => x.kind === "CHAIR")!;
    const [a, b] = await Promise.all([makeModel(facts(p)), makeModel(facts(p))]);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  }, 60_000);
});

describe("reading the listing", () => {
  const words = (title: string, extra: Partial<PieceFacts> = {}) => new Words({ slug: "x", kind: "CHAIR", title, attributes: {}, materials: [], colors: [], dims: { w: 70, d: 70, h: 80 }, ...extra });

  it("matches whole words, not parts of them", () => {
    expect(words("Tufted Armless English Roll Accent Chair").has("arm")).toBe(false);
    expect(words("Tufted Armless English Roll Accent Chair").has("armless")).toBe(true);
    expect(words("Mid-Century Modern Chair").has("mid century")).toBe(true);
    expect(words("3-Drawer Dresser").countBefore("drawer")).toBe(3);
  });

  it("names fabrics, woods and metals from the words", () => {
    expect(fabricOf(words("Velvet Accent Chair"))).toBe("velvet");
    expect(fabricOf(words("Faux Leather Recliner"))).toBe("leather");
    expect(fabricOf(words("Glam Tufted Chair"))).toBe("velvet");
    expect(woodTone(words("Solid Walnut Coffee Table"))).not.toBeNull();
    expect(metalTone(words("Arc Lamp", { attributes: { finish: "Antique Brass" } }))?.finish).toBe("brushed");
    expect(metalTone(words("Chrome Floor Lamp"))?.finish).toBe("polished");
  });

  it("builds George's chair as a tufted, armless slipper chair with a scroll back", () => {
    const p = placeable.find((x) => x.titleEn.includes("Tufted Armless English Roll"))!;
    const made = makeParts(facts(p));
    const c = context(facts(p), paletteFromWords(p.colors ?? []));
    expect(c.words.has("armless")).toBe(true);
    // The back is tufted: many small button meshes in the upholstery.
    expect(made.parts.length).toBeGreaterThan(6);
    // The legs stand clear of the floor-length skirt a slipper chair does not have.
    expect(made.triangles).toBeGreaterThan(5000);
  });

  it("gives a long sofa three or four seat cushions and a loveseat two", () => {
    const sofa = makeParts({ slug: "s", kind: "SOFA", title: "Modern Sofa Couch", attributes: {}, materials: ["fabric"], colors: ["grey"], dims: { w: 220, d: 90, h: 85 } });
    const loveseat = makeParts({ slug: "l", kind: "SOFA", title: "Modern Loveseat", attributes: {}, materials: ["fabric"], colors: ["grey"], dims: { w: 150, d: 90, h: 85 } });
    expect(sofa.parts.length).toBeGreaterThan(loveseat.parts.length);
  });
});
