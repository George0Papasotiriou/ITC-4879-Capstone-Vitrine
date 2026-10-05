"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Finds a face's 478 landmarks in each camera frame, on the shopper's own device: MediaPipe's landmarker from the shop's own files, or a scripted face for tests.
 */

import { cachedBytes, sha256Hex } from "@/components/media/model-files";
import type { Point2 } from "@/lib/vision/camera";
import { scriptedLandmarks, type ScriptedFace } from "@/lib/vision/mirror/scripted";

/**
 * docs/adr/065. Privacy by design (CLAUDE.md rule 9): the camera's frames
 * are given to a model running in this tab and nowhere else. The model and
 * its WebAssembly runtime are this shop's own files (public/models/face,
 * scripts/face-model.ts); the model is checked against its SHA-256 before
 * use and kept in Cache Storage, so the second visit starts at once.
 *
 * The landmarker uses the graphics card when it can (the "GPU delegate")
 * and the processor when it cannot.
 */

export const FACE_MODEL_DIR = "/models/face/";

export type FaceFrame = { landmarks: Point2[]; width: number; height: number };
export type FrameSource = HTMLVideoElement | HTMLCanvasElement;

/** A frame's size in pixels, whichever kind of source it is. */
export const frameSize = (source: FrameSource) => (source instanceof HTMLVideoElement ? { width: source.videoWidth, height: source.videoHeight } : { width: source.width, height: source.height });

export type FaceTracker = {
  /** Landmarks in the frame's pixels, or null when no face is seen: a live video, or a still picture drawn on a canvas. */
  detect(source: FrameSource, timeMs: number): FaceFrame | null;
  readonly kind: "mediapipe" | "scripted";
  close(): void;
};

export type LoadFaceTracker = { ok: true; tracker: FaceTracker } | { ok: false; reason: "not_installed" | "integrity" | "no_webassembly" | "failed" };

type Manifest = { model: string; sha256: string; bytes: number };

/* -------------------------------------------------------------------------- */
/* A scripted face, for tests and for machines without a camera               */
/* -------------------------------------------------------------------------- */

export type { ScriptedFace } from "@/lib/vision/mirror/scripted";

declare global {
  interface Window {
    /** Set before the mirror opens: the tracker sees this face instead of running the model (the e2e tests use it). */
    vitrineMirrorScripted?: boolean;
    /** The scripted face, changeable while the mirror runs. */
    vitrineMirrorFace?: ScriptedFace;
  }
}

function scriptedTracker(): FaceTracker {
  return {
    kind: "scripted",
    detect(source) {
      const face = window.vitrineMirrorFace;
      const size = frameSize(source);
      const width = size.width || 1280;
      const height = size.height || 720;
      if (face === undefined) return null;
      return { landmarks: scriptedLandmarks(face, width, height), width, height };
    },
    close() {},
  };
}

/* -------------------------------------------------------------------------- */
/* MediaPipe                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Loads the landmarker, reporting bytes as the model downloads. The
 * package's JavaScript is imported only here, so no other page carries it.
 */
export async function loadFaceTracker(onProgress?: (received: number, total: number) => void): Promise<LoadFaceTracker> {
  if (typeof window !== "undefined" && window.vitrineMirrorScripted === true) return { ok: true, tracker: scriptedTracker() };
  if (typeof WebAssembly === "undefined") return { ok: false, reason: "no_webassembly" };
  let manifest: Manifest;
  try {
    const response = await fetch(`${FACE_MODEL_DIR}manifest.json`, { cache: "no-cache" });
    if (!response.ok) return { ok: false, reason: "not_installed" };
    manifest = (await response.json()) as Manifest;
  } catch {
    return { ok: false, reason: "not_installed" };
  }
  try {
    let received = 0;
    const model = await cachedBytes(`${FACE_MODEL_DIR}${manifest.model}`, `vitrine-face-${manifest.sha256.slice(0, 16)}`, (bytes) => {
      received += bytes;
      onProgress?.(received, manifest.bytes);
    });
    if ((await sha256Hex(model)) !== manifest.sha256) return { ok: false, reason: "integrity" };
    const { FaceLandmarker, FilesetResolver } = await import("@mediapipe/tasks-vision");
    const fileset = await FilesetResolver.forVisionTasks(`${FACE_MODEL_DIR}wasm`);
    const create = (delegate: "GPU" | "CPU") =>
      FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetBuffer: new Uint8Array(model), delegate },
        runningMode: "VIDEO",
        numFaces: 1,
        minFaceDetectionConfidence: 0.5,
        minFacePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
    const landmarker = await create("GPU").catch(() => create("CPU"));
    let lastTime = -1;
    return {
      ok: true,
      tracker: {
        kind: "mediapipe",
        detect(source, timeMs) {
          // The landmarker needs strictly increasing timestamps.
          const time = Math.max(timeMs, lastTime + 1);
          lastTime = time;
          const result = landmarker.detectForVideo(source, time);
          const face = result.faceLandmarks[0];
          if (face === undefined) return null;
          const { width, height } = frameSize(source);
          return { landmarks: face.map((point) => [point.x * width, point.y * height] as Point2), width, height };
        },
        close: () => landmarker.close(),
      },
    };
  } catch {
    return { ok: false, reason: "failed" };
  }
}
