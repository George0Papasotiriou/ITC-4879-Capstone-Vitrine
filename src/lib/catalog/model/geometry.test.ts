/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Unit tests for the modeler's primitives: rounded boxes, cushions, lathes, tubes, extrusions, sweeps.
 */

import { describe, expect, it } from "vitest";

import { arcPath, cushion, diamondGrid, extrude, lathe, roundedBox, roundedRectanglePath, superellipsePath, sweep, triangulate, tube } from "@/lib/catalog/model/geometry";
import { compose, cross, dot, length, Mesh, rotationY, scaling, sub, translation, type Vec3 } from "@/lib/catalog/model/mesh";

/** Every triangle's winding agrees with its corners' normals: faces point outwards. */
function outwardShare(mesh: Mesh): number {
  let agree = 0;
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const [a, b, c] = [mesh.indices[t]!, mesh.indices[t + 1]!, mesh.indices[t + 2]!];
    const face = cross(sub(mesh.position(b), mesh.position(a)), sub(mesh.position(c), mesh.position(a)));
    const normal: Vec3 = [0, 1, 2].map((axis) => mesh.normal(a)[axis]! + mesh.normal(b)[axis]! + mesh.normal(c)[axis]!) as Vec3;
    if (length(face) < 1e-14 || dot(face, normal) > 0) agree += 1;
  }
  return agree / mesh.triangleCount;
}

const unitNormals = (mesh: Mesh) => Array.from({ length: mesh.vertexCount }, (_, v) => length(mesh.normal(v))).every((l) => Math.abs(l - 1) < 1e-6);

/** Area of the triangles whose three corners lie in the plane y = level. */
function areaAt(mesh: Mesh, level: number): number {
  let area = 0;
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const p = [mesh.indices[t]!, mesh.indices[t + 1]!, mesh.indices[t + 2]!].map((v) => mesh.position(v));
    if (p.some((q) => Math.abs(q[1] - level) > 1e-9)) continue;
    area += length(cross(sub(p[1]!, p[0]!), sub(p[2]!, p[0]!))) / 2;
  }
  return area;
}

describe("roundedBox", () => {
  it("measures exactly its size, with unit normals pointing out", () => {
    const box = roundedBox({ size: [0.8, 0.4, 0.6], radius: 0.05, step: 0.1 });
    const { min, max } = box.bounds();
    expect(max[0] - min[0]).toBeCloseTo(0.8, 9);
    expect(max[1] - min[1]).toBeCloseTo(0.4, 9);
    expect(max[2] - min[2]).toBeCloseTo(0.6, 9);
    expect(unitNormals(box)).toBe(true);
    expect(outwardShare(box)).toBe(1);
  });

  it("puts every point of a rounded edge at the radius from the shrunken box", () => {
    const r = 0.05;
    const box = roundedBox({ size: [0.4, 0.4, 0.4], radius: r });
    for (let v = 0; v < box.vertexCount; v += 1) {
      const p = box.position(v);
      const q: Vec3 = p.map((value) => Math.max(-0.15, Math.min(0.15, value))) as Vec3;
      expect(length(sub(p, q))).toBeCloseTo(r, 9);
    }
  });

  it("clamps a radius larger than the box to half its smallest side", () => {
    const box = roundedBox({ size: [0.2, 0.04, 0.2], radius: 1 });
    const { min, max } = box.bounds();
    expect(max[1] - min[1]).toBeCloseTo(0.04, 9);
  });
});

describe("cushion", () => {
  it("crowns its face in the middle and stays put at the seams", () => {
    const flat = cushion({ size: [0.6, 0.12, 0.6], radius: 0.03, crown: 0 });
    const crowned = cushion({ size: [0.6, 0.12, 0.6], radius: 0.03, crown: 0.02 });
    expect(crowned.mesh.bounds().max[1] - flat.mesh.bounds().max[1]).toBeCloseTo(0.02, 2);
    expect(crowned.mesh.bounds().max[0]).toBeCloseTo(flat.mesh.bounds().max[0], 9);
  });

  it("places a button at every point of a diamond grid, sunk into its dimple", () => {
    const tufted = cushion({ size: [0.8, 0.6, 0.12], radius: 0.04, crown: 0.01, face: "front", tufting: { kind: "buttons", spacing: 0.14, depth: 0.03 } });
    const grid = diamondGrid(0.8, 0.6, 0.14);
    expect(tufted.buttons).toHaveLength(grid.length);
    for (const { position } of tufted.buttons) expect(position[2]).toBeLessThan(0.06);
    expect(outwardShare(tufted.mesh)).toBeGreaterThan(0.99);
  });

  it("lays the diamond out in offset rows, inside the face", () => {
    const grid = diamondGrid(1, 0.5, 0.15);
    const rows = new Set(grid.map(([, y]) => y.toFixed(6)));
    expect(rows.size).toBeGreaterThan(1);
    for (const [x, y] of grid) {
      expect(Math.abs(x)).toBeLessThan(0.5);
      expect(Math.abs(y)).toBeLessThan(0.25);
    }
  });
});

describe("lathe and tube", () => {
  it("turns a profile to its radius and height, closed and facing out", () => {
    const pot = lathe([{ r: 0, y: 0 }, { r: 0.1, y: 0 }, { r: 0.15, y: 0.3 }, { r: 0, y: 0.3 }], { segments: 32 });
    const { min, max } = pot.bounds();
    expect(max[0]).toBeCloseTo(0.15, 9);
    expect(max[1] - min[1]).toBeCloseTo(0.3, 9);
    expect(outwardShare(pot)).toBe(1);
  });

  it("sweeps a circle along a path at its radius, a closed loop without a twist", () => {
    const ring = tube(arcPath([0, 0, 0], 0.5, 0, Math.PI * 2, "xz", 48).slice(0, -1), 0.02, { closed: true, segments: 10 });
    for (let v = 0; v < ring.vertexCount; v += 1) {
      const p = ring.position(v);
      const centreDistance = Math.hypot(p[0], p[2]);
      expect(Math.hypot(centreDistance - 0.5, p[1])).toBeLessThan(0.0205);
    }
    expect(outwardShare(ring)).toBe(1);
  });
});

describe("triangulate and extrude", () => {
  it("fills a rounded rectangle completely", () => {
    const outline = roundedRectanglePath(2, 0.95, 0.006, 3);
    let area = 0;
    for (const [a, b, c] of triangulate(outline)) {
      const [p, q, r] = [outline[a]!, outline[b]!, outline[c]!];
      area += ((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])) / 2;
    }
    expect(area).toBeCloseTo(2 * 0.95 - (4 - Math.PI) * 0.006 ** 2, 3);
  });

  it("fills a concave L without spilling outside it", () => {
    const outline: [number, number][] = [[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2]];
    let area = 0;
    for (const [a, b, c] of triangulate(outline)) {
      const [p, q, r] = [outline[a]!, outline[b]!, outline[c]!];
      area += Math.abs((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])) / 2;
    }
    expect(area).toBeCloseTo(3, 9);
  });

  it("gives a bevelled table top a whole top face, even where the corner radius equals the bevel", () => {
    expect(areaAt(extrude(roundedRectanglePath(2, 0.95, 0.006, 3), { height: 0.04, bevel: 0.006 }), 0.04)).toBeGreaterThan(1.85);
    // With the corner rounder than the bevel (as the builders draw them), every face points out.
    const top = extrude(roundedRectanglePath(2, 0.95, 0.012, 4), { height: 0.04, bevel: 0.006 });
    expect(outwardShare(top)).toBe(1);
  });

  it("extrudes a round top to its diameter", () => {
    const disc = extrude(superellipsePath(1, 1, 2, 64), { height: 0.03, bevel: 0.005 });
    const { min, max } = disc.bounds();
    expect(max[0] - min[0]).toBeCloseTo(1, 3);
    expect(max[1] - min[1]).toBeCloseTo(0.03, 9);
  });
});

describe("sweep", () => {
  it("runs a wall round a rounded rectangle at its offsets", () => {
    const basket = sweep(roundedRectanglePath(0.4, 0.3, 0.05, 6), [{ r: 0.005, y: 0 }, { r: 0.005, y: 0.2 }, { r: -0.005, y: 0.2 }, { r: -0.005, y: 0.02 }]);
    const { min, max } = basket.bounds();
    expect(max[0] - min[0]).toBeCloseTo(0.41, 3);
    expect(max[1]).toBeCloseTo(0.2, 9);
  });
});

describe("Mesh.transform", () => {
  it("keeps normals unit and outward under a stretch, a turn and a mirror", () => {
    const box = roundedBox({ size: [0.4, 0.2, 0.3], radius: 0.03 });
    box.transform(compose(translation([1, 0, 0]), rotationY(0.7), scaling([2, 0.5, -1])));
    expect(unitNormals(box)).toBe(true);
    expect(outwardShare(box)).toBe(1);
  });

  it("gives tangents perpendicular to the normals", () => {
    const box = roundedBox({ size: [0.4, 0.2, 0.3], radius: 0.03 });
    const tangents = box.tangents();
    for (let v = 0; v < box.vertexCount; v += 1) {
      const t: Vec3 = [tangents[v * 4]!, tangents[v * 4 + 1]!, tangents[v * 4 + 2]!];
      expect(Math.abs(dot(t, box.normal(v)))).toBeLessThan(1e-6);
      expect(Math.abs(tangents[v * 4 + 3]!)).toBe(1);
    }
  });
});
