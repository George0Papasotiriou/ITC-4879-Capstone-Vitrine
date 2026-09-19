"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Estimates a depth map in the browser: the self-hosted model when installed, and the drawn sample room's exact depth.
 */

import { sampleRoomDepth } from "@/components/room/sample-room";
import { depthToPhoto, letterbox } from "@/lib/vision/depth-image";
import type { DepthMap } from "@/lib/vision/depth";

/**
 * Where the depth for the paper-free mode comes from (docs/adr/014).
 *
 * The photo never leaves the device (CLAUDE.md rule 9), so the model runs in the
 * browser, on files this application serves itself. Nothing is fetched from a
 * model hub at run time and no third party sees a room.
 *
 * INSTALLATION. The files live under `public/models/depth/`, described by a
 * `manifest.json`: research/export_depth_model.py converts the official
 * checkpoint and chooses its compression by measurement, and `pnpm depth-model
 * runtime` copies the WebAssembly runtime beside it. Without the manifest,
 * `loadDepthModel` says so and the page offers the sheet of paper instead.
 *
 * HOW IT RUNS.
 *   - Downloaded once, with progress shown, and kept in the browser's Cache
 *     Storage, so the second visit starts at once and works offline.
 *   - Checked against the SHA-256 in the manifest before it is used: a model
 *     that is not the one the shop converted never runs.
 *   - Run in a background worker (the runtime's proxy mode), so the page stays
 *     responsive for the seconds it takes.
 *   - On several threads when the page is cross-origin isolated (the room page
 *     is, see next.config.ts), on one otherwise.
 *
 * WHICH MODEL. A *metric* model (Depth Anything V2 Metric, indoor) answers in
 * metres and the placement is metric with it. A *relative* model answers up to
 * an unknown factor, which the camera height then fixes (depth.ts). An
 * *inverse* depth model (plain Depth Anything V2, which predicts disparity) is
 * refused: recovering metres from it needs two unknowns, not one.
 */

export type DepthSource = {
  /** How the map was made, for the interface and the evaluation log. */
  id: "sample" | "model";
  /** Depth in metres, rather than up to an unknown factor. */
  metric: boolean;
  estimate(image: { data: ArrayLike<number>; width: number; height: number }): Promise<DepthMap>;
  /** Milliseconds the last estimate took. */
  lastMs: number | null;
  /** Threads the model runs on. */
  threads: number;
  dispose(): void;
};

export type LoadDepthModel =
  | { ok: true; source: DepthSource; manifest: DepthManifest }
  | { ok: false; reason: "not_installed" | "unsupported_output" | "no_webassembly" | "integrity" | "failed" };

export type DepthManifest = {
  /** Human-readable name, shown on the credits page. */
  name: string;
  /** File names inside public/models/depth/. */
  model: string;
  runtime: string;
  /** Square input side the model expects, pixels (518 for Depth Anything V2). */
  inputSize: number;
  /** What the model's numbers mean. */
  output: "metric_depth" | "relative_depth" | "inverse_depth";
  /** Name of the model's input and output tensors. */
  inputName?: string;
  outputName?: string;
  /** Execution providers to try, in order. */
  providers?: string[];
  licence?: string;
  /** SHA-256 of the model file, hex: checked before the model is used. */
  sha256?: string;
  bytes?: number;
};

/** Bytes received so far and in total, while the model downloads for the first time. */
export type DownloadProgress = (received: number, total: number) => void;

export const DEPTH_MODEL_DIR = "/models/depth/";
const RUNTIME_BINARY = "ort-wasm-simd-threaded.wasm";

/* -------------------------------------------------------------------------- */
/* The sample room: exact depth, no model                                     */
/* -------------------------------------------------------------------------- */

/**
 * The drawn room's own depth. Instant, exact, and metric, so the paper-free flow
 * can be tried, demonstrated and tested end to end before any model is
 * installed — and so the geometry can be checked against a known camera.
 */
export function sampleDepthSource(): DepthSource {
  return {
    id: "sample",
    metric: true,
    lastMs: 0,
    threads: 1,
    async estimate() {
      const started = performance.now();
      const depth = sampleRoomDepth();
      this.lastMs = performance.now() - started;
      return depth;
    },
    dispose() {},
  };
}

/* -------------------------------------------------------------------------- */
/* The self-hosted model                                                      */
/* -------------------------------------------------------------------------- */

/** The slice of onnxruntime-web this file uses; the runtime is loaded at run time, not bundled. */
type OrtTensor = { data: Float32Array | Uint8Array; dims: readonly number[] };
type OrtSession = {
  run(feeds: Record<string, OrtTensor>): Promise<Record<string, OrtTensor>>;
  inputNames: readonly string[];
  outputNames: readonly string[];
  release?(): Promise<void>;
};
type Ort = {
  env: { wasm: { wasmPaths: string; wasmBinary?: ArrayBuffer; numThreads?: number; proxy?: boolean } };
  Tensor: new (type: "float32", data: Float32Array, dims: readonly number[]) => OrtTensor;
  InferenceSession: { create(model: string | Uint8Array, options?: { executionProviders?: string[] }): Promise<OrtSession> };
};

let runtimePromise: Promise<Ort | null> | null = null;

/**
 * Loads the runtime from this application's own files by adding a script tag.
 * It is deliberately not an import: onnxruntime-web is not bundled, so nothing
 * ships to shoppers who never open the paper-free mode, and the shop still
 * builds and deploys when the model is not installed at all.
 */
function loadRuntime(url: string): Promise<Ort | null> {
  runtimePromise ??= new Promise<Ort | null>((resolve) => {
    const existing = (window as unknown as { ort?: Ort }).ort;
    if (existing !== undefined) {
      resolve(existing);
      return;
    }
    const script = document.createElement("script");
    script.src = url;
    script.async = true;
    script.onload = () => resolve((window as unknown as { ort?: Ort }).ort ?? null);
    script.onerror = () => resolve(null);
    document.head.append(script);
  });
  return runtimePromise;
}

/**
 * A file from the model folder, from Cache Storage when it has been fetched
 * before, otherwise downloaded with its progress reported and then kept. The
 * cache name carries the model's hash, so a new conversion is a new cache and
 * the old one is cleared.
 */
async function cachedBytes(url: string, cacheName: string, onChunk: (bytes: number) => void): Promise<ArrayBuffer> {
  const cache = typeof caches === "undefined" ? null : await caches.open(cacheName).catch(() => null);
  const hit = await cache?.match(url);
  if (hit !== undefined) {
    const buffer = await hit.arrayBuffer();
    onChunk(buffer.byteLength);
    return buffer;
  }
  const response = await fetch(url);
  if (!response.ok || response.body === null) throw new Error(`${url}: ${response.status}`);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    onChunk(value.byteLength);
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  await cache?.put(url, new Response(bytes, { headers: { "content-type": response.headers.get("content-type") ?? "application/octet-stream" } })).catch(() => {});
  return bytes.buffer;
}

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Threads for the runtime: several when the page may share memory with workers, one otherwise. */
function threadCount(): number {
  if (typeof crossOriginIsolated === "undefined" || !crossOriginIsolated) return 1;
  // Leave a core for the page itself; four is where the model stops getting faster.
  return Math.min(4, Math.max(1, (navigator.hardwareConcurrency ?? 2) - 1));
}

let modelPromise: Promise<LoadDepthModel> | null = null;

/**
 * Prepares the paper-free mode's model, or explains why it cannot. The first
 * call downloads it (with progress); later calls, and later visits, reuse it.
 */
export function loadDepthModel(onProgress?: DownloadProgress): Promise<LoadDepthModel> {
  modelPromise ??= load(onProgress).then((result) => {
    // A failure is not remembered: the next attempt may succeed (a network blip).
    if (!result.ok) modelPromise = null;
    return result;
  });
  return modelPromise;
}

async function load(onProgress?: DownloadProgress): Promise<LoadDepthModel> {
  if (typeof WebAssembly !== "object") return { ok: false, reason: "no_webassembly" };
  let manifest: DepthManifest;
  try {
    const response = await fetch(`${DEPTH_MODEL_DIR}manifest.json`, { cache: "no-cache" });
    if (!response.ok) return { ok: false, reason: "not_installed" };
    manifest = (await response.json()) as DepthManifest;
  } catch {
    return { ok: false, reason: "not_installed" };
  }
  if (manifest.output === "inverse_depth") return { ok: false, reason: "unsupported_output" };

  try {
    const ort = await loadRuntime(`${DEPTH_MODEL_DIR}${manifest.runtime}`);
    if (ort === null) return { ok: false, reason: "failed" };

    const cacheName = `vitrine-depth-${(manifest.sha256 ?? manifest.model).slice(0, 16)}`;
    if (typeof caches !== "undefined") {
      // Older conversions are dead weight on the shopper's disk.
      for (const name of await caches.keys().catch(() => [] as string[])) {
        if (name.startsWith("vitrine-depth-") && name !== cacheName) void caches.delete(name);
      }
    }

    // The runtime's own binary is downloaded here too, so one progress bar
    // covers everything the first use costs, and it is cached with the model.
    const binaryHead = await fetch(`${DEPTH_MODEL_DIR}${RUNTIME_BINARY}`, { method: "HEAD" }).catch(() => null);
    const total = (manifest.bytes ?? 0) + Number(binaryHead?.headers.get("content-length") ?? 0);
    let received = 0;
    const tick = (bytes: number) => {
      received += bytes;
      onProgress?.(received, Math.max(total, received));
    };
    const [modelBuffer, binary] = await Promise.all([
      cachedBytes(`${DEPTH_MODEL_DIR}${manifest.model}`, cacheName, tick),
      cachedBytes(`${DEPTH_MODEL_DIR}${RUNTIME_BINARY}`, cacheName, tick),
    ]);
    if (manifest.sha256 !== undefined && (await sha256Hex(modelBuffer)) !== manifest.sha256) {
      if (typeof caches !== "undefined") void caches.delete(cacheName);
      return { ok: false, reason: "integrity" };
    }

    const threads = threadCount();
    ort.env.wasm.wasmPaths = DEPTH_MODEL_DIR;
    ort.env.wasm.wasmBinary = binary;
    ort.env.wasm.numThreads = threads;
    // Inference in a worker: the page keeps responding while the model runs.
    ort.env.wasm.proxy = true;
    const session = await ort.InferenceSession.create(new Uint8Array(modelBuffer), {
      executionProviders: manifest.providers ?? ["wasm"],
    });
    const inputName = manifest.inputName ?? session.inputNames[0] ?? "pixel_values";
    const outputName = manifest.outputName ?? session.outputNames[0] ?? "predicted_depth";

    const source: DepthSource = {
      id: "model",
      metric: manifest.output === "metric_depth",
      lastMs: null,
      threads,
      async estimate(image) {
        const started = performance.now();
        const box = letterbox(image.data, image.width, image.height, manifest.inputSize);
        const feeds = { [inputName]: new ort.Tensor("float32", box.tensor, [1, 3, box.size, box.size]) };
        const result = await session.run(feeds);
        const output = result[outputName] ?? Object.values(result)[0];
        if (output === undefined) throw new Error("The depth model returned nothing");
        const values = output.data instanceof Float32Array ? output.data : Float32Array.from(output.data);
        const depth = depthToPhoto(values, box, image.width, image.height);
        this.lastMs = performance.now() - started;
        return depth;
      },
      dispose() {
        void session.release?.();
      },
    };
    return { ok: true, source, manifest };
  } catch (error) {
    // Unexpected: the shopper is offered the sheet of paper, and the cause is left
    // for whoever opens the console (it never contains the photograph).
    console.warn("[depth] the measuring model could not be prepared:", error);
    return { ok: false, reason: "failed" };
  }
}
