/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Evaluation E10: how close the shop's 3D models come to the real thing, measured against the pieces that have a real scan.
 */

/**
 * docs/adr/058, docs/adr/059.
 *
 *   pnpm evals:models [--limit 400] [--no-photo] [--seed 4949]
 *
 * The answer key is ABO's own 3D scans of the pieces that have one (stored by
 * the catalog-models job; locally `pnpm catalog models`). For each such piece
 * the script builds, without looking at the scan:
 *
 *   before   the stand-in of docs/adr/025 — a few boxes, coloured by the
 *            first colour word (rebuilt here from that code, to measure
 *            against);
 *   made     the shop's made model (docs/adr/058), coloured from words and
 *            from the studio photograph;
 *   ai       the AI model from the photograph, where the pilot made one
 *            (docs/adr/059), read from storage.
 *
 * Shape: each model and the scan become the set of cells of a 24³ grid their
 * surfaces pass through, each stretched to fill the grid (so only shape counts,
 * not size — every model is already at the listed size), compared by
 * intersection over union. A scan's front is not labelled, so every model is
 * given the best of the four quarter-turns about the vertical, the same for
 * all of them.
 *
 * Colour: the scan's main colour is the largest k-means cluster of its base
 * colour texture (the black padding of the texture atlas left out); each
 * model's main colour is compared with it by CIEDE2000.
 *
 * Differences between methods are paired (the same pieces) with a 95%
 * bootstrap interval (2,000 resamples, seeded). Writes
 * docs/report/evaluations/e10-models.md and .json.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";

import { makeParts } from "@/lib/catalog/model";
import { documentTriangles, iou, meshPoints, occupancy, ORIENTATIONS, surfacePoints, type Rotation } from "@/lib/catalog/model/ai-fit";
import { canMakeModel } from "@/lib/catalog/model/family";
import { roundedBox } from "@/lib/catalog/model/geometry";
import { swatches } from "@/lib/catalog/model/look";
import { Mesh, type Vec3 } from "@/lib/catalog/model/mesh";
import { readPhoto } from "@/lib/catalog/model/serve";
import { difference, paletteFromWords, type PieceFacts } from "@/lib/catalog/model/words";
import { modelKey } from "@/lib/catalog/model-compress";
import { colourSwatch, type Rgb } from "@/lib/vision/palette";
import type { ColorId } from "@/lib/search/vocabulary";

const { values } = parseArgs({ options: { limit: { type: "string", default: "400" }, "no-photo": { type: "boolean", default: false }, seed: { type: "string", default: "4949" } } });

type FixtureProduct = { slug: string; sourceId: string; kind: string; titleEn: string; attributes?: Record<string, string>; materials?: string[]; colors?: string[]; dimsCm?: { w: number; d: number; h: number } | null; modelSource?: string | null; media?: { kind: string; src: string; whiteGround?: boolean; width?: number; height?: number }[] };

const STORAGE = path.join(".local", "storage");
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

/** The four quarter-turns about the vertical: rotations that keep y where it is. */
const YAWS: readonly Rotation[] = ORIENTATIONS.filter((m) => m[3] === 0 && m[4] === 1 && m[5] === 0);
const rotate = (m: Rotation, [x, y, z]: Vec3): Vec3 => [m[0] * x + m[1] * y + m[2] * z, m[3] * x + m[4] * y + m[5] * z, m[6] * x + m[7] * y + m[8] * z];

function shapeScore(model: readonly Vec3[], scan: Uint8Array): number {
  return Math.max(...YAWS.map((yaw) => iou(occupancy(model.map((p) => rotate(yaw, p))), scan)));
}

/**
 * The stand-in of docs/adr/025, as it was before docs/adr/058 replaced it:
 * boxes per kind at the listed size, in the first colour word. Kept here only
 * to measure the "before".
 */
function boxesBefore(kind: string, dims: { w: number; d: number; h: number }): Mesh[] {
  const [w, d, h] = [dims.w / 100, dims.d / 100, dims.h / 100];
  const box = (x: number, y: number, z: number, bw: number, bh: number, bd: number) => roundedBox({ size: [bw, bh, bd], radius: 0 }).translate([x, y, z]);
  switch (kind) {
    case "SOFA":
    case "CHAIR":
    case "BENCH": {
      const seatTop = Math.min(h * 0.45, 0.48);
      const seatT = Math.min(seatTop * 0.5, 0.14);
      const armW = Math.min(w * 0.12, 0.16);
      const backD = Math.min(d * 0.2, 0.12);
      const parts = [box(0, (seatTop - seatT) / 2, 0, w * 0.86, seatTop - seatT, d * 0.86), box(0, seatTop - seatT / 2, 0, w, seatT, d), box(0, (seatTop + h) / 2, -(d - backD) / 2, w, h - seatTop, backD)];
      if (w > 0.7) for (const side of [-1, 1]) parts.push(box((side * (w - armW)) / 2, seatTop + ((h - seatTop) * 0.55) / 2, 0, armW, (h - seatTop) * 0.55, d));
      return parts;
    }
    case "TABLE":
    case "DESK": {
      const t = Math.min(h * 0.12, 0.06);
      const leg = Math.min(w, d) * 0.08;
      const parts = [box(0, h - t / 2, 0, w, t, d)];
      for (const x of [-1, 1]) for (const z of [-1, 1]) parts.push(box((x * (w - 2 * leg)) / 2, (h - t) / 2, (z * (d - 2 * leg)) / 2, leg, h - t, leg));
      return parts;
    }
    case "LAMP":
    case "HOME_LIGHTING_AND_LAMPS": {
      const shade = Math.min(h * 0.3, 0.32);
      const base = Math.min(h * 0.06, 0.04);
      const stem = Math.min(w, d) * 0.12;
      return [box(0, base / 2, 0, w * 0.7, base, d * 0.7), box(0, (h - shade) / 2, 0, stem, h - shade, stem), box(0, h - shade / 2, 0, w, shade, d)];
    }
    case "BED":
      return [box(0, (h * 0.35) / 2, 0, w * 0.96, h * 0.35, d), box(0, h * 0.35 + (h * 0.2) / 2, 0, w, h * 0.2, d * 0.98), box(0, h / 2, -(d - Math.min(d * 0.08, 0.08)) / 2, w, h, Math.min(d * 0.08, 0.08))];
    case "RUG":
      return [box(0, 0.005, 0, w, 0.01, d)];
    default:
      return [box(0, h / 2, 0, w, h, d)];
  }
}

/** The scan's main colour: the largest cluster of its base colour textures, the atlas's black padding left out. */
async function scanColour(document: Awaited<ReturnType<typeof io.readBinary>>): Promise<Rgb | null> {
  const { default: sharp } = await import("sharp");
  const pixels: Rgb[] = [];
  for (const material of document.getRoot().listMaterials()) {
    const texture = material.getBaseColorTexture();
    const factor = material.getBaseColorFactor();
    const image = texture?.getImage();
    if (image == null) continue;
    const { data, info } = await sharp(Buffer.from(image)).resize(96, 96, { fit: "fill" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    for (let i = 0; i < info.width * info.height; i += 1) {
      const p = { r: data[i * 3]! * factor[0]!, g: data[i * 3 + 1]! * factor[1]!, b: data[i * 3 + 2]! * factor[2]! };
      if (p.r + p.g + p.b > 24) pixels.push({ r: Math.round(p.r), g: Math.round(p.g), b: Math.round(p.b) });
    }
  }
  return swatches(pixels, 4)[0]?.colour ?? null;
}

/** A seeded generator (mulberry32), as the other evaluations use. */
function generator(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** Mean of paired differences b − a, with a 95% percentile bootstrap interval. */
function paired(a: number[], b: number[], seed: number) {
  const diffs = a.map((value, i) => b[i]! - value);
  const mean = (list: number[]) => list.reduce((s, v) => s + v, 0) / Math.max(1, list.length);
  const random = generator(seed);
  const means: number[] = [];
  for (let r = 0; r < 2000; r += 1) {
    const sample = diffs.map(() => diffs[Math.floor(random() * diffs.length)]!);
    means.push(mean(sample));
  }
  means.sort((x, y) => x - y);
  return { mean: mean(diffs), low: means[Math.floor(0.025 * means.length)]!, high: means[Math.floor(0.975 * means.length)]!, n: diffs.length };
}

type Row = { slug: string; kind: string; before: number; made: number; ai: number | null; colourWords: number | null; colourPhoto: number | null; colourBefore: number | null };

const fixture = (JSON.parse(await readFile(path.join("src", "lib", "catalog", "fixtures", "abo.json"), "utf8")) as { products: FixtureProduct[] }).products;
const scanned = fixture.filter((p) => p.modelSource && p.dimsCm && canMakeModel(p.kind, p.dimsCm)).slice(0, Number(values.limit));
const rows: Row[] = [];
let missing = 0;
for (const p of scanned) {
  const file = path.join(STORAGE, ...modelKey(p.sourceId).split("/"));
  const bytes = await readFile(file).catch(() => null);
  if (bytes === null) {
    missing += 1;
    continue;
  }
  const scan = await io.readBinary(new Uint8Array(bytes));
  const triangles = [...documentTriangles(scan)];
  let span = 1e-6;
  for (const t of triangles) for (const q of t) span = Math.max(span, Math.abs(q[0]), Math.abs(q[1]), Math.abs(q[2]));
  const scanGrid = occupancy(surfacePoints(triangles, span / 60));
  const facts: PieceFacts = { slug: p.slug, kind: p.kind, title: p.titleEn, attributes: p.attributes ?? {}, materials: p.materials ?? [], colors: p.colors ?? [], dims: p.dimsCm! };
  const madeParts = makeParts(facts).parts;
  const before = shapeScore(meshPoints(boxesBefore(p.kind, p.dimsCm!)), scanGrid);
  const made = shapeScore(meshPoints(madeParts.map((part) => part.mesh)), scanGrid);

  // An AI model of this piece, if the pilot made one (any provider), read from storage.
  let ai: number | null = null;
  for (const short of ["trellis", "trellis-2"]) {
    const aiBytes = await readFile(path.join(STORAGE, "catalog", "ai-3d", short, `${p.slug.replace(/[^a-z0-9-]/gi, "").slice(0, 80)}.glb`)).catch(() => null);
    if (aiBytes === null) continue;
    const aiDoc = await io.readBinary(new Uint8Array(aiBytes));
    const aiTriangles = [...documentTriangles(aiDoc)];
    ai = Math.max(ai ?? 0, shapeScore(surfacePoints(aiTriangles, 0.02), scanGrid));
  }

  const truth = await scanColour(scan);
  const words = paletteFromWords(p.colors ?? []);
  const firstWord = p.colors?.[0];
  let photoColour: Rgb | null = null;
  if (!values["no-photo"]) {
    const images = (p.media ?? []).filter((m) => m.kind === "image").map((m) => ({ src: m.src, width: m.width ?? 1100, height: m.height ?? 1100, studio: m.whiteGround !== false }));
    const studio = images.find((image) => image.studio) ?? images[0] ?? null;
    const read = await readPhoto({ ...facts, studio: studio?.src ?? null, images }, { photo: async (url) => fetch(url).then(async (r) => (r.ok ? new Uint8Array(await r.arrayBuffer()) : null)).catch(() => null) });
    photoColour = read.palette.source === "photo" ? read.palette.main : null;
  }
  rows.push({
    slug: p.slug,
    kind: p.kind,
    before: Math.round(before * 1000) / 1000,
    made: Math.round(made * 1000) / 1000,
    ai: ai === null ? null : Math.round(ai * 1000) / 1000,
    colourBefore: truth === null || firstWord === undefined ? null : Math.round(difference(colourSwatch(firstWord as ColorId), truth) * 10) / 10,
    colourWords: truth === null || words.source === "default" ? null : Math.round(difference(words.main, truth) * 10) / 10,
    colourPhoto: truth === null || photoColour === null ? null : Math.round(difference(photoColour, truth) * 10) / 10,
  });
  if (rows.length % 20 === 0) process.stdout.write(`  ${rows.length} pieces measured\n`);
}

const seed = Number(values.seed);
const mean = (list: number[]) => list.reduce((s, v) => s + v, 0) / Math.max(1, list.length);
const shape = paired(rows.map((r) => r.before), rows.map((r) => r.made), seed);
const withAi = rows.filter((r) => r.ai !== null);
const aiVsMade = withAi.length === 0 ? null : paired(withAi.map((r) => r.made), withAi.map((r) => r.ai!), seed);
const coloured = rows.filter((r) => r.colourWords !== null && r.colourPhoto !== null);
const colour = paired(coloured.map((r) => r.colourWords!), coloured.map((r) => r.colourPhoto!), seed);
const kinds = [...new Set(rows.map((r) => r.kind))].sort();
const byKind = kinds.map((kind) => {
  const list = rows.filter((r) => r.kind === kind);
  return { kind, n: list.length, before: mean(list.map((r) => r.before)), made: mean(list.map((r) => r.made)) };
});

const out = path.join("docs", "report", "evaluations", "e10-models");
await mkdir(path.dirname(out), { recursive: true });
await writeFile(`${out}.json`, JSON.stringify({ at: new Date().toISOString(), seed, pieces: rows.length, missingScans: missing, shape, aiVsMade, colour, byKind, rows }, null, 2) + "\n");
const f = (value: number, digits = 3) => value.toFixed(digits);
const lines = [
  "# E10: how close the 3D models come to the real thing",
  "",
  `Written by \`pnpm evals:models\` on ${new Date().toISOString().slice(0, 10)}. Answer key: ABO's own 3D scans of ${rows.length} pieces (${missing} scans not on this machine were skipped). Shape is IoU of 24³ surface grids, best of four quarter-turns about the vertical for every model alike; colour is CIEDE2000 between each model's main colour and the scan texture's main colour. Intervals: paired bootstrap, 2,000 resamples, seed ${seed}.`,
  "",
  "## Shape (higher is better)",
  "",
  "| | Pieces | Mean IoU |",
  "|---|---|---|",
  `| Before: boxes (docs/adr/025) | ${rows.length} | ${f(mean(rows.map((r) => r.before)))} |`,
  `| Made model (docs/adr/058) | ${rows.length} | ${f(mean(rows.map((r) => r.made)))} |`,
  ...(withAi.length === 0 ? [] : [`| AI model from the photograph (docs/adr/059) | ${withAi.length} | ${f(mean(withAi.map((r) => r.ai!)))} |`]),
  "",
  `Made − before: ${shape.mean >= 0 ? "+" : ""}${f(shape.mean)} (95% ${f(shape.low)} to ${f(shape.high)}, n = ${shape.n}).` +
    (aiVsMade === null ? " No AI models yet: the pilot waits for George's yes." : ` AI − made on the same pieces: ${aiVsMade.mean >= 0 ? "+" : ""}${f(aiVsMade.mean)} (95% ${f(aiVsMade.low)} to ${f(aiVsMade.high)}, n = ${aiVsMade.n}).`),
  "",
  "| Kind | Pieces | Before | Made |",
  "|---|---|---|---|",
  ...byKind.map((k) => `| ${k.kind} | ${k.n} | ${f(k.before)} | ${f(k.made)} |`),
  "",
  "## Colour (ΔE2000, lower is better)",
  "",
  `On ${coloured.length} pieces with a colour word, a readable studio photograph and a scan texture: colour word ${f(mean(coloured.map((r) => r.colourWords!)), 1)}, photograph's bands ${f(mean(coloured.map((r) => r.colourPhoto!)), 1)}; photograph − word ${colour.mean >= 0 ? "+" : ""}${f(colour.mean, 1)} (95% ${f(colour.low, 1)} to ${f(colour.high, 1)}).`,
  "",
];
await writeFile(`${out}.md`, lines.join("\n"));
process.stdout.write(lines.slice(4).join("\n") + "\n");
