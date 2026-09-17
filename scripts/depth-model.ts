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
 *
 * The model itself is converted from the official checkpoint by
 * `research/export_depth_model.py`; this script handles the parts that belong to
 * the web application, and never downloads anything by itself. The shop works
 * without any of it: the sheet of paper needs no model, and the drawn sample
 * room carries its own exact depth.
 */

import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const DIR = path.join("public", "models", "depth");
const RUNTIME_PACKAGE = "onnxruntime-web";
/** What the browser needs from that package: the loader and the WebAssembly it fetches beside it. */
const RUNTIME_PATTERN = /^ort(\.min\.js|\.wasm|-wasm.*\.(wasm|mjs|js))$/;
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
  const files = (await readdir(source)).filter((file) => RUNTIME_PATTERN.test(file));
  if (files.length === 0) {
    console.log(`No runtime files matched in ${source}; list its contents and update RUNTIME_PATTERN.`);
    process.exitCode = 1;
    return;
  }
  for (const file of files) {
    await copyFile(path.join(source, file), path.join(DIR, file));
    console.log(`  ${file.padEnd(44)} ${await sizeOf(path.join(DIR, file))}`);
  }
  console.log(`Copied ${files.length} files into ${DIR}.`);
}

async function plan(): Promise<void> {
  console.log(`Placing a piece without a sheet of paper needs a depth model in the browser.

What it costs, once, on this machine:

  1. Python tooling (torch, transformers, onnx, onnxruntime)   a few hundred MB into research/.venv
  2. The checkpoint depth-anything/Depth-Anything-V2-Metric-Indoor-Small-hf   about 99 MB, Apache-2.0
  3. The WebAssembly runtime (${RUNTIME_PACKAGE}, MIT)         about 15 MB, a development dependency

What shoppers download, the first time they use the mode: the quantised model,
roughly 25 MB, cached by their browser afterwards. Nothing else changes: the
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

if (command === "check") await check();
else if (command === "runtime") await runtime();
else if (command === "plan") await plan();
else {
  console.error("Usage: pnpm depth-model [plan | check | runtime]");
  process.exitCode = 1;
}
