/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Installs and checks the browser depth model the paper-free room mode uses.
 */

/**
 * The depth model for placing a piece without a sheet of paper (ADR-014).
 *
 *   pnpm depth-model            what it would take, and what is installed now
 *   pnpm depth-model check      list the installed files
 *   pnpm depth-model runtime    copy the WebAssembly runtime into public/models/depth
 *   pnpm depth-model build      what `pnpm build` runs: verify the model, copy the runtime
 *
 * The model itself is converted from the official checkpoint by
 * `research/export_depth_model.py`; this script handles the parts that belong to
 * the web application, and never downloads anything by itself. The shop works
 * without any of it: the sheet of paper needs no model, and the drawn sample
 * room carries its own exact depth.
 *
 * HOW IT REACHES PRODUCTION. The converted model (36 MB) and its manifest are
 * committed, so Railway has them with the code. The runtime (14 MB) is not: it
 * is the same file for everyone and comes with the pinned package, so the build
 * copies it from node_modules. `.gitattributes` marks the model binary, so git
 * never rewrites a byte of it on the way.
 */

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const DIR = path.join("public", "models", "depth");
const RUNTIME_PACKAGE = "onnxruntime-web";
/**
 * What the browser needs from that package: the WebAssembly-only build (the model
 * runs on the WebAssembly backend) and the module and binary it loads from the
 * same folder.
 */
const RUNTIME_FILES = ["ort.wasm.min.js", "ort-wasm-simd-threaded.wasm", "ort-wasm-simd-threaded.mjs"];
const MEGABYTE = 1_048_576;

const command = process.argv[2] ?? "plan";

async function sizeOf(file: string): Promise<string> {
  const { size } = await stat(file);
  return `${(size / MEGABYTE).toFixed(1)} MB`;
}

async function check(): Promise<boolean> {
  const manifest = path.join(DIR, "manifest.json");
  if (!existsSync(manifest)) {
    console.log(`Not installed: no ${manifest}.`);
    console.log("The shop falls back to the sheet of paper, and says so on the room page.");
    return false;
  }
  const parsed = JSON.parse(await readFile(manifest, "utf8")) as { name?: string; output?: string; bytes?: number };
  console.log(`Installed: ${parsed.name ?? "unknown model"} (${parsed.output ?? "unknown output"})`);
  for (const entry of (await readdir(DIR)).sort()) {
    console.log(`  ${entry.padEnd(44)} ${await sizeOf(path.join(DIR, entry))}`);
  }
  return true;
}

async function runtime(): Promise<void> {
  const source = path.join("node_modules", RUNTIME_PACKAGE, "dist");
  if (!existsSync(source)) {
    console.log(`The runtime package is not installed. It is a development dependency: it is never bundled into the
shop — the browser loads these files from public/models/depth at run time, only in the paper-free mode.

  pnpm add -D ${RUNTIME_PACKAGE}
  pnpm depth-model runtime`);
    process.exitCode = 1;
    return;
  }
  await mkdir(DIR, { recursive: true });
  const files = RUNTIME_FILES.filter((file) => existsSync(path.join(source, file)));
  if (files.length !== RUNTIME_FILES.length) {
    console.log(`Expected ${RUNTIME_FILES.join(", ")} in ${source}; the package layout has changed, so update RUNTIME_FILES.`);
    process.exitCode = 1;
    return;
  }
  for (const file of files) {
    await copyFile(path.join(source, file), path.join(DIR, file));
    console.log(`  ${file.padEnd(44)} ${await sizeOf(path.join(DIR, file))}`);
  }
  console.log(`Copied ${files.length} files into ${DIR}.`);
}

/**
 * The build step. Never fails the build over the model: without it the shop
 * still works and the room page says the paper-free mode is unavailable. But it
 * says loudly what is missing, and it refuses to put a runtime next to a model
 * whose bytes do not match its manifest (the browser would refuse it anyway).
 */
async function build(): Promise<void> {
  const manifestPath = path.join(DIR, "manifest.json");
  if (!existsSync(manifestPath)) {
    console.log("[depth-model] No model in public/models/depth: the paper-free room mode will be unavailable.");
    return;
  }
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { model: string; sha256?: string };
  const modelPath = path.join(DIR, manifest.model);
  if (!existsSync(modelPath)) {
    console.log(`[depth-model] The manifest names ${manifest.model}, which is missing: the paper-free mode will be unavailable.`);
    return;
  }
  const bytes = await readFile(modelPath);
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (manifest.sha256 !== undefined && digest !== manifest.sha256) {
    console.log(`[depth-model] ${manifest.model} does not match its manifest (sha256 ${digest.slice(0, 16)}…): not installing the runtime.`);
    return;
  }
  console.log(`[depth-model] ${manifest.model}: ${(bytes.byteLength / MEGABYTE).toFixed(1)} MB, fingerprint verified.`);
  await runtime();
  // A missing runtime package is not a build failure either; the mode is simply unavailable.
  process.exitCode = 0;
}

async function plan(): Promise<void> {
  console.log(`Placing a piece without a sheet of paper needs a depth model in the browser.

What it costs, once, on this machine:

  1. Python tooling (torch, transformers, onnx, onnxruntime)   a few hundred MB into research/.venv
  2. The checkpoint depth-anything/Depth-Anything-V2-Metric-Indoor-Small-hf   about 99 MB, Apache-2.0
  3. The WebAssembly runtime (${RUNTIME_PACKAGE}, MIT)         about 15 MB, a development dependency

What shoppers download, the first time they use the mode: the quantised model
(36 MB) and the runtime (14 MB), checked and cached by their browser afterwards. Nothing else changes: the
sheet-of-paper method needs none of this, and no photograph ever leaves a device.

The steps:

  python research/export_depth_model.py --dry-run     # what the conversion would do
  uv run --with torch --with transformers --with onnx --with onnxruntime \\
    python research/export_depth_model.py --out ${DIR}
  pnpm add -D ${RUNTIME_PACKAGE}
  pnpm depth-model runtime
  pnpm depth-model check

Nothing has been downloaded by this command.
`);
  await check();
}

/**
 * Real room photographs, prepared exactly as the browser prepares them
 * (src/lib/vision/depth-image.ts letterbox), for the conversion script to test
 * each compression of the model against the original. Defaults to the rug
 * listings whose main photograph is a furnished room, which are real indoor
 * scenes with a floor: the kind of picture the model will be given.
 */
async function inputs(files: string[]): Promise<void> {
  const { default: sharp } = await import("sharp");
  const { letterbox } = await import("@/lib/vision/depth-image");
  let chosen = files;
  if (chosen.length === 0) {
    const fixture = JSON.parse(await readFile("src/lib/catalog/fixtures/collection.json", "utf8")) as {
      products: { category: string; media: { src: string; whiteGround: boolean }[] }[];
    };
    chosen = fixture.products
      .filter((product) => product.category === "rugs" && product.media[0]?.whiteGround === false)
      .slice(0, 6)
      .map((product) => path.join("public", product.media[0]!.src));
  }
  const outDir = path.join(".local", "depth-verify");
  await mkdir(outDir, { recursive: true });
  for (const file of chosen) {
    const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const box = letterbox(data, info.width, info.height, 518);
    const target = path.join(outDir, `${path.basename(file).replace(/\.[a-z]+$/i, "")}.f32`);
    await writeFile(target, Buffer.from(box.tensor.buffer, box.tensor.byteOffset, box.tensor.byteLength));
    console.log(`  ${target}  from ${file} (${info.width} × ${info.height})`);
  }
  console.log(`Prepared ${chosen.length} photographs for the conversion to be checked against.`);
}

if (command === "check") await check();
else if (command === "runtime") await runtime();
else if (command === "build") await build();
else if (command === "inputs") await inputs(process.argv.slice(3));
else if (command === "plan") await plan();
else {
  console.error("Usage: pnpm depth-model [plan | check | runtime | build | inputs [photos...]]");
  process.exitCode = 1;
}
