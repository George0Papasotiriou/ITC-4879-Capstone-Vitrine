/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The 3D files the shop hands to AR viewers, fetched as a phone would and checked with Khronos's own glTF validator.
 */

/**
 * docs/adr/025, docs/adr/035, docs/report/ar-check.md.
 *
 *   pnpm models:check [--base https://…] [--scans 12] [--shapes 6] [--seed 4949]
 *
 * Scene Viewer (Android) is handed /api/models/<slug>: the piece's own scan
 * (a redirect to the stored file) or, without one, a shape built from its
 * measurements. Quick Look (iPhone) is handed a USDZ that model-viewer writes
 * in the browser from the same file (checked in tests/e2e/ar.spec.ts). So the
 * file at that address is what every AR view rests on. For a seeded sample of
 * scanned pieces and of measured pieces without a scan, this script fetches
 * the address the way a phone does (following the redirect) and checks:
 *
 *   - the answer is 200, `model/gltf-binary`, and starts with the glTF magic;
 *   - Khronos's glTF-Validator (the reference implementation of the glTF 2.0
 *     specification) reports no errors;
 *   - a scanned piece arrives as its stored file, a measured one as its shape.
 *
 * Writes docs/report/evaluations/ar-models.md and .json; exits 1 on any error.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import { validateBytes } from "gltf-validator";

type FixtureProduct = { slug: string; kind: string; modelSource?: string | null; dimsCm?: { w: number; d: number; h: number } | null };

const { values } = parseArgs({
  options: {
    base: { type: "string", default: "http://localhost:3000" },
    scans: { type: "string", default: "12" },
    shapes: { type: "string", default: "6" },
    seed: { type: "string", default: "4949" },
  },
});
const base = values.base.replace(/\/$/, "");

/** mulberry32, as the other seeded samples in the shop. */
function generator(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function sample<T>(items: readonly T[], count: number, random: () => number): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [copy[index], copy[other]] = [copy[other]!, copy[index]!];
  }
  return copy.slice(0, count);
}

type Row = {
  slug: string;
  kind: string;
  expected: "scan" | "shape";
  served: string;
  status: number;
  type: string;
  bytes: number;
  errors: number;
  warnings: number;
  firstError: string | null;
  triangles: number | null;
};

async function check(slug: string, kind: string, expected: Row["expected"]): Promise<Row> {
  const response = await fetch(`${base}/api/models/${slug}`, { redirect: "follow" });
  const served = new URL(response.url).pathname;
  const body = new Uint8Array(await response.arrayBuffer());
  const row: Row = {
    slug,
    kind,
    expected,
    served,
    status: response.status,
    type: response.headers.get("content-type") ?? "",
    bytes: body.byteLength,
    errors: 0,
    warnings: 0,
    firstError: null,
    triangles: null,
  };
  if (response.status !== 200) return { ...row, errors: 1, firstError: `HTTP ${response.status}` };
  if (Buffer.from(body.subarray(0, 4)).toString("latin1") !== "glTF") return { ...row, errors: 1, firstError: "not a binary glTF" };
  const report = await validateBytes(body, { maxIssues: 20, uri: served });
  const firstError = report.issues.messages.find((message) => message.severity === 0);
  return {
    ...row,
    errors: report.issues.numErrors,
    warnings: report.issues.numWarnings,
    firstError: firstError === undefined ? null : `${firstError.code}: ${firstError.message}`,
    triangles: report.info?.totalTriangleCount ?? null,
  };
}

const fixture = JSON.parse(await readFile(path.join("src", "lib", "catalog", "fixtures", "abo.json"), "utf8")) as { products: FixtureProduct[] };
const random = generator(Number(values.seed));
const scanned = fixture.products.filter((product) => product.modelSource);
const SHAPE_KINDS = new Set(["CHAIR", "TABLE", "SOFA", "BED", "OTTOMAN", "SHELF", "DRESSER", "CABINET", "LAMP"]);
const measured = fixture.products.filter((product) => !product.modelSource && SHAPE_KINDS.has(product.kind) && product.dimsCm);

const rows: Row[] = [];
for (const product of sample(scanned, Number(values.scans), random)) rows.push(await check(product.slug, product.kind, "scan"));
for (const product of sample(measured, Number(values.shapes), random)) rows.push(await check(product.slug, product.kind, "shape"));

// A scan must arrive as the stored file; a shape is made at the address itself.
const misrouted = rows.filter((row) => row.status === 200 && (row.expected === "scan") !== row.served.startsWith("/media/"));
const failed = rows.filter((row) => row.errors > 0 || !row.type.includes("model/gltf-binary"));
const out = path.join("docs", "report", "evaluations", "ar-models");
await mkdir(path.dirname(out), { recursive: true });
await writeFile(`${out}.json`, JSON.stringify({ base, at: new Date().toISOString(), seed: Number(values.seed), validator: "gltf-validator 2.0.0-dev.3.10 (Khronos)", rows }, null, 2) + "\n");
const lines = [
  "# AR files: what the phones are handed, checked with Khronos's glTF-Validator",
  "",
  `Written by \`pnpm models:check --base ${base}\` on ${new Date().toISOString().slice(0, 10)}. ${rows.length} pieces (seed ${values.seed}): ` +
    `${rows.filter((row) => row.expected === "scan").length} with their own scan, ${rows.filter((row) => row.expected === "shape").length} drawn from their measurements. ` +
    `Each fetched at /api/models/<slug> as Scene Viewer does, redirects followed.`,
  "",
  "| Piece | Kind | Served from | HTTP | Type | Size | Triangles | Errors | Warnings |",
  "|---|---|---|---|---|---|---|---|---|",
  ...rows.map(
    (row) =>
      `| ${row.slug} | ${row.kind} | ${row.served.startsWith("/media/") ? "stored scan" : "made from measurements"} | ${row.status} | ${row.type} | ` +
      `${(row.bytes / 1024).toFixed(0)} KB | ${row.triangles ?? "–"} | ${row.errors} | ${row.warnings} |`,
  ),
  "",
  `Errors: ${failed.length === 0 ? "none" : failed.map((row) => `${row.slug} (${row.firstError ?? row.type})`).join("; ")}. ` +
    `Misrouted (a scan not served as its file, or a shape served as one): ${misrouted.length === 0 ? "none" : misrouted.map((row) => row.slug).join(", ")}.`,
];
await writeFile(`${out}.md`, lines.join("\n") + "\n");
console.log(lines.slice(4).join("\n"));
if (failed.length > 0 || misrouted.length > 0) process.exitCode = 1;
