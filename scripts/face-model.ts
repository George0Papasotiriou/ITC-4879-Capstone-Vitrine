/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Installs and checks the face landmarker the AR Mirror runs in the browser.
 */

/**
 * The AR Mirror's face tracking (docs/adr/065).
 *
 *   pnpm face-model          check the model and list what is installed
 *   pnpm face-model build    what `pnpm build` runs: verify the model, copy the runtime
 *
 * HOW IT REACHES PRODUCTION. The model (MediaPipe's face_landmarker.task,
 * float16, 3.6 MB, Apache 2.0) and its manifest are committed under
 * public/models/face, so Railway has them with the code. The WebAssembly
 * runtime (about 22 MB) comes with the pinned @mediapipe/tasks-vision
 * package, so the build copies it from node_modules into
 * public/models/face/wasm, which git ignores. Nothing is downloaded at build
 * or run time from anyone else, and no shopper's camera frame leaves their
 * device: the model runs on it.
 */

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

const DIR = path.join("public", "models", "face");
const WASM_FROM = path.join("node_modules", "@mediapipe", "tasks-vision", "wasm");
/** The runtime with SIMD, and without for the few browsers that lack it. */
const RUNTIME_FILES = ["vision_wasm_internal.js", "vision_wasm_internal.wasm", "vision_wasm_nosimd_internal.js", "vision_wasm_nosimd_internal.wasm"];

type Manifest = { name: string; model: string; sha256: string; bytes: number; licence: string; source: string; runtime: string };

async function check(): Promise<boolean> {
  const manifestPath = path.join(DIR, "manifest.json");
  if (!existsSync(manifestPath)) {
    console.log(`Not installed: no ${manifestPath}. The mirror says it is unavailable.`);
    return false;
  }
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Manifest;
  const modelPath = path.join(DIR, manifest.model);
  if (!existsSync(modelPath)) {
    console.log(`The manifest names ${manifest.model}, which is missing.`);
    return false;
  }
  const bytes = await readFile(modelPath);
  const sha = createHash("sha256").update(bytes).digest("hex");
  if (sha !== manifest.sha256) {
    console.log(`${manifest.model}: SHA-256 ${sha} does not match the manifest's ${manifest.sha256}.`);
    return false;
  }
  console.log(`${manifest.name}: ${manifest.model}, ${(bytes.length / 1_048_576).toFixed(1)} MB, SHA-256 checked.`);
  return true;
}

async function copyRuntime(): Promise<boolean> {
  if (!existsSync(WASM_FROM)) {
    console.log(`No ${WASM_FROM}: install the dependencies first.`);
    return false;
  }
  await mkdir(path.join(DIR, "wasm"), { recursive: true });
  for (const file of RUNTIME_FILES) await copyFile(path.join(WASM_FROM, file), path.join(DIR, "wasm", file));
  console.log(`Runtime copied into ${path.join(DIR, "wasm")} (${RUNTIME_FILES.length} files).`);
  return true;
}

const command = process.argv[2] ?? "check";
if (command === "build") {
  // Never fails the build: without the files the mirror says it is unavailable, and the rest of the shop is unaffected.
  const ok = (await check()) && (await copyRuntime());
  if (!ok) console.warn("face-model: the AR Mirror will be unavailable in this build.");
} else {
  await check();
}
