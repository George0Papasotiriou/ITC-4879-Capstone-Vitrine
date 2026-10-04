/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Making an AI-generated mesh fit for the shop: turned to face the front, scaled to the listed size, standing on the floor.
 */

import { NodeIO, type Document } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, prune, textureCompress } from "@gltf-transform/functions";

import type { Mesh, Vec3 } from "@/lib/catalog/model/mesh";

/**
 * docs/adr/059. An image-to-3D model returns a mesh in its own frame: some
 * size, some way up, facing some way. The shop knows two things it does not —
 * the piece's real measurements, and what kind of thing it is — and the made
 * model of the same piece (docs/adr/058) carries both: right way up, front
 * towards +z, at the listed size.
 *
 * So the AI mesh is tried in each of the 24 orientations a box can take (6
 * faces that could be up × 4 turns about it). In each, both meshes are
 * reduced to which cells of a 24 × 24 × 24 grid their surfaces pass through,
 * each stretched to fill the grid (so size does not count, only shape), and
 * compared by intersection over union. The best orientation wins; its IoU is
 * kept as the model's "fit", and a fit below 0.35 means the AI mesh is not
 * recognisably this piece — it is rejected, and the made model stays.
 *
 * The chosen turn, the stretch to the listed size and the step down onto the
 * floor are set as one transform on a new root node, so the mesh itself is
 * untouched. Its textures are then resized to 1024 px, as the scans are
 * (model-compress.ts).
 */

export const FIT_GRID = 24;
export const MIN_FIT = 0.35;

/** A 3×3 rotation, row-major. */
export type Rotation = [number, number, number, number, number, number, number, number, number];

/** The 24 rotations of a cube: every signed permutation of the axes with determinant +1. */
export const ORIENTATIONS: readonly Rotation[] = (() => {
  const out: Rotation[] = [];
  const permutations = [
    [0, 1, 2],
    [0, 2, 1],
    [1, 0, 2],
    [1, 2, 0],
    [2, 0, 1],
    [2, 1, 0],
  ];
  for (const p of permutations) {
    for (let signs = 0; signs < 8; signs += 1) {
      const m: Rotation = [0, 0, 0, 0, 0, 0, 0, 0, 0];
      for (let row = 0; row < 3; row += 1) m[row * 3 + p[row]!] = signs & (1 << row) ? -1 : 1;
      const det = m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
      if (det > 0) out.push(m);
    }
  }
  return out;
})();

const rotate = (m: Rotation, [x, y, z]: Vec3): Vec3 => [m[0] * x + m[1] * y + m[2] * z, m[3] * x + m[4] * y + m[5] * z, m[6] * x + m[7] * y + m[8] * z];

/**
 * Points spread over a mesh's surface: each triangle gets samples in
 * proportion to its area (at least its corners and centre), on a fixed
 * barycentric pattern, so the same mesh always gives the same points.
 */
export function surfacePoints(triangles: Iterable<[Vec3, Vec3, Vec3]>, spacing: number, cap = 400_000): Vec3[] {
  const out: Vec3[] = [];
  for (const [a, b, c] of triangles) {
    const ab: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const ac: Vec3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const area = Math.hypot(ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]) / 2;
    const steps = Math.min(12, Math.max(1, Math.ceil(Math.sqrt(area) / spacing)));
    for (let i = 0; i <= steps; i += 1) {
      for (let j = 0; i + j <= steps; j += 1) {
        const u = i / steps;
        const v = j / steps;
        out.push([a[0] + ab[0] * u + ac[0] * v, a[1] + ab[1] * u + ac[1] * v, a[2] + ab[2] * u + ac[2] * v]);
      }
    }
    if (out.length > cap) break;
  }
  return out;
}

/** The grid cells the points fall in, after stretching their bounding box to fill the grid, grown by one cell so nearby surfaces meet. */
export function occupancy(points: readonly Vec3[], n = FIT_GRID): Uint8Array {
  const grid = new Uint8Array(n * n * n);
  if (points.length === 0) return grid;
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of points) for (let axis = 0; axis < 3; axis += 1) {
    min[axis] = Math.min(min[axis]!, p[axis]!);
    max[axis] = Math.max(max[axis]!, p[axis]!);
  }
  const cell = (value: number, axis: number) => Math.min(n - 1, Math.max(0, Math.floor(((value - min[axis]!) / Math.max(1e-9, max[axis]! - min[axis]!)) * n)));
  const marked = new Uint8Array(n * n * n);
  for (const p of points) marked[(cell(p[0], 0) * n + cell(p[1], 1)) * n + cell(p[2], 2)] = 1;
  for (let x = 0; x < n; x += 1) for (let y = 0; y < n; y += 1) for (let z = 0; z < n; z += 1) {
    if (marked[(x * n + y) * n + z] === 0) continue;
    for (let dx = -1; dx <= 1; dx += 1) for (let dy = -1; dy <= 1; dy += 1) for (let dz = -1; dz <= 1; dz += 1) {
      const [i, j, k] = [x + dx, y + dy, z + dz];
      if (i >= 0 && j >= 0 && k >= 0 && i < n && j < n && k < n) grid[(i * n + j) * n + k] = 1;
    }
  }
  return grid;
}

export function iou(a: Uint8Array, b: Uint8Array): number {
  let both = 0;
  let either = 0;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] === 1 && b[i] === 1) both += 1;
    if (a[i] === 1 || b[i] === 1) either += 1;
  }
  return either === 0 ? 0 : both / either;
}

/** The orientation of `candidate` that best matches `reference`, and how well (IoU in each of the 24). */
export function bestOrientation(candidate: readonly Vec3[], reference: readonly Vec3[]): { rotation: Rotation; index: number; fit: number; fits: number[] } {
  const target = occupancy(reference);
  const fits = ORIENTATIONS.map((rotation) => iou(occupancy(candidate.map((p) => rotate(rotation, p))), target));
  let index = 0;
  for (let i = 1; i < fits.length; i += 1) if (fits[i]! > fits[index]! + 1e-9) index = i;
  return { rotation: ORIENTATIONS[index]!, index, fit: fits[index]!, fits };
}

/** The made model's surface points, from its meshes (already in the shop's frame). */
export function meshPoints(meshes: readonly Mesh[], spacing = 0.02): Vec3[] {
  function* triangles() {
    for (const mesh of meshes) for (let t = 0; t < mesh.indices.length; t += 3) yield [mesh.position(mesh.indices[t]!), mesh.position(mesh.indices[t + 1]!), mesh.position(mesh.indices[t + 2]!)] as [Vec3, Vec3, Vec3];
  }
  return surfacePoints(triangles(), spacing);
}

/** A glTF document's triangles in world space (every mesh node's world matrix applied). */
export function* documentTriangles(document: Document): Generator<[Vec3, Vec3, Vec3]> {
  const scene = document.getRoot().getDefaultScene() ?? document.getRoot().listScenes()[0];
  if (scene === undefined) return;
  const nodes: ReturnType<typeof scene.listChildren> = [];
  scene.traverse((node) => nodes.push(node));
  const corner: number[] = [0, 0, 0];
  for (const node of nodes) {
    const mesh = node.getMesh();
    if (mesh === null) continue;
    const m = node.getWorldMatrix();
    const world = (i: number, position: NonNullable<ReturnType<ReturnType<typeof mesh.listPrimitives>[number]["getAttribute"]>>): Vec3 => {
      position.getElement(i, corner);
      const [x, y, z] = corner as [number, number, number];
      return [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
    };
    for (const primitive of mesh.listPrimitives()) {
      if (primitive.getMode() !== 4) continue;
      const position = primitive.getAttribute("POSITION");
      if (position === null) continue;
      const indices = primitive.getIndices();
      const count = indices === null ? position.getCount() : indices.getCount();
      const at = (k: number) => (indices === null ? k : indices.getScalar(k));
      for (let k = 0; k + 2 < count; k += 3) yield [world(at(k), position), world(at(k + 1), position), world(at(k + 2), position)];
    }
  }
}

export type FittedModel = { glb: Uint8Array; fit: number; orientation: number; triangles: number; bytes: number };

/**
 * The AI mesh turned, stretched and set on the floor to match the made model
 * at the listed size (metres), with its textures lightened. `fit` below
 * MIN_FIT means it should not be shown.
 */
export async function fitAiModel(original: Uint8Array, made: readonly Mesh[], size: { w: number; d: number; h: number }): Promise<FittedModel> {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const document = await io.readBinary(original);
  const triangles = [...documentTriangles(document)];
  // Sample densely enough for the mesh's own scale, whatever unit it came in.
  let span = 1e-6;
  for (const triangle of triangles) for (const p of triangle) span = Math.max(span, Math.abs(p[0]), Math.abs(p[1]), Math.abs(p[2]));
  const points = surfacePoints(triangles, span / 60);
  const best = bestOrientation(points, meshPoints(made));

  // The turned mesh's bounds give the stretch to the listed size and the step onto the floor.
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of points) {
    const q = rotate(best.rotation, p);
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis]!, q[axis]!);
      max[axis] = Math.max(max[axis]!, q[axis]!);
    }
  }
  const target: Vec3 = [size.w, size.h, size.d];
  const s: Vec3 = [0, 1, 2].map((axis) => target[axis]! / Math.max(1e-9, max[axis]! - min[axis]!)) as Vec3;
  const t: Vec3 = [-((min[0] + max[0]) / 2) * s[0], -min[1] * s[1], -((min[2] + max[2]) / 2) * s[2]];
  const r = best.rotation;
  // Column-major 4×4 of p ↦ S·R·p + t.
  const matrix = [s[0] * r[0], s[1] * r[3], s[2] * r[6], 0, s[0] * r[1], s[1] * r[4], s[2] * r[7], 0, s[0] * r[2], s[1] * r[5], s[2] * r[8], 0, t[0], t[1], t[2], 1] as const;

  const scene = document.getRoot().getDefaultScene() ?? document.getRoot().listScenes()[0]!;
  const root = document.createNode("fitted").setMatrix([...matrix] as Parameters<ReturnType<typeof document.createNode>["setMatrix"]>[0]);
  for (const child of scene.listChildren()) {
    scene.removeChild(child);
    root.addChild(child);
  }
  scene.addChild(root);

  const { default: sharp } = await import("sharp");
  const opaque = document.getRoot().listMaterials().every((material) => material.getAlphaMode() === "OPAQUE");
  await document.transform(dedup(), prune(), textureCompress({ encoder: sharp, resize: [1024, 1024], quality: 84, ...(opaque ? { targetFormat: "jpeg" as const } : {}) }));
  const glb = await io.writeBinary(document);
  return { glb, fit: best.fit, orientation: best.index, triangles: triangles.length, bytes: glb.byteLength };
}
