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
 * Where the depth for the paper-free mode comes from.
 *
 * The photo never leaves the device (CLAUDE.md rule 9), so the model runs in the
 * browser, on files this application serves itself. Nothing is fetched from a
 * model hub at runtime and no third party sees a room.
 *
 * INSTALLATION. The files live under `public/models/depth/`, described by a
 * `manifest.json`; `pnpm depth-model` prepares them (see scripts/depth-model.ts,
 * which converts the official checkpoint — a download George approves once). If
 * the manifest is not there, `loadDepthModel` says so and the page offers the
 * sheet of paper instead. That is the state the shop ships in today.
 *
 * WHICH MODEL. A *metric* model (Depth Anything V2 Metric, indoor) answers in
 * metres and the placement is metric with it. A *relative* model answers up to
 * an unknown factor, which the camera height then fixes (depth.ts). An
 * *inverse* depth model (plain Depth Anything V2, which predicts disparity) is
 * refused: recovering metres from it needs two unknowns, not one, and a plausible
 * sofa drawn at the wrong size is worse than no sofa at all.
 */

export type DepthSource = {
  /** How the map was made, for the interface and the evaluation log. */
  id: "sample" | "model";
  /** Depth in metres, rather than up to an unknown factor. */
  metric: boolean;
  estimate(image: { data: ArrayLike<number>; width: number; height: number }): Promise<DepthMap>;
  /** Milliseconds the last estimate took. */
  lastMs: number | null;
  dispose(): void;
};

export type LoadDepthModel =
  | { ok: true; source: DepthSource; manifest: DepthManifest }
  | { ok: false; reason: "not_installed" | "unsupported_output" | "no_webassembly" | "failed" };

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
};

export const DEPTH_MODEL_DIR = "/models/depth/";

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
  env: { wasm: { wasmPaths: string; numThreads?: number; proxy?: boolean } };
  Tensor: new (type: "float32", data: Float32Array, dims: readonly number[]) => OrtTensor;
  InferenceSession: { create(path: string, options?: { executionProviders?: string[] }): Promise<OrtSession> };
};

let runtimePromise: Promise<Ort | null> | null = null;

/**
 * Loads the runtime from this application's own files by adding a script tag.
 * It is deliberately not an import: onnxruntime-web is not a dependency of the
 * build, so nothing ships to shoppers who never open the paper-free mode, and
 * the shop still builds and deploys when the model is not installed at all.
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
 * Prepares the paper-free mode's model, or explains why it cannot.
 *
 * The first call downloads the model (tens of megabytes) and the browser caches
 * it, so later visits start immediately; the session is created once and reused
 * for every photo.
 */
export async function loadDepthModel(): Promise<LoadDepthModel> {
  if (typeof WebAssembly !== "object") return { ok: false, reason: "no_webassembly" };
  let manifest: DepthManifest;
  try {
    const response = await fetch(`${DEPTH_MODEL_DIR}manifest.json`, { cache: "force-cache" });
    if (!response.ok) return { ok: false, reason: "not_installed" };
    manifest = (await response.json()) as DepthManifest;
  } catch {
    return { ok: false, reason: "not_installed" };
  }
  if (manifest.output === "inverse_depth") return { ok: false, reason: "unsupported_output" };

  try {
    const ort = await loadRuntime(`${DEPTH_MODEL_DIR}${manifest.runtime}`);
    if (ort === null) return { ok: false, reason: "failed" };
    ort.env.wasm.wasmPaths = DEPTH_MODEL_DIR;
    const session = await ort.InferenceSession.create(`${DEPTH_MODEL_DIR}${manifest.model}`, {
      executionProviders: manifest.providers ?? ["webgpu", "wasm"],
    });
    const inputName = manifest.inputName ?? session.inputNames[0] ?? "pixel_values";
    const outputName = manifest.outputName ?? session.outputNames[0] ?? "predicted_depth";

    const source: DepthSource = {
      id: "model",
      metric: manifest.output === "metric_depth",
      lastMs: null,
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
  } catch {
    return { ok: false, reason: "failed" };
  }
}
