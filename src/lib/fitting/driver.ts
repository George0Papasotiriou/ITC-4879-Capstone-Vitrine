/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Which FASHN the shop talks to — the service, the tests' fixture, or the keyless stand-in — for the web process and the worker alike.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

import { createDrawnTryOnDriver, createFashnDriver, createFixtureStudioDriver, type TryOnDriver } from "@/lib/ai/providers/fashn";

/**
 * docs/adr/063.
 * - "service": FASHN, with the key.
 * - "fixture": the tests' FASHN (FASHN_PROVIDER=fixture, refused in production).
 * - "drawn": no key — the photograph beside the piece, and no video or model shot.
 */
export type StudioMode = "service" | "fixture" | "drawn";

type StudioEnv = { FASHN_API_KEY?: string; FASHN_PROVIDER: "auto" | "fixture" };

export function studioMode(env: StudioEnv): StudioMode {
  if (env.FASHN_PROVIDER === "fixture") return "fixture";
  return env.FASHN_API_KEY === undefined ? "drawn" : "service";
}

/** Whether a video and a model shot can be made at all: the stand-in makes neither. */
export const canAnimate = (mode: StudioMode) => mode !== "drawn";

const FIXTURE_VIDEO = path.join(process.cwd(), "src", "lib", "fitting", "fixtures", "move.webm");

export function studioDriver(env: StudioEnv, options: { fetch?: typeof fetch } = {}): TryOnDriver {
  const mode = studioMode(env);
  if (mode === "fixture") return createFixtureStudioDriver(async () => new Uint8Array(await readFile(FIXTURE_VIDEO)));
  if (mode === "service") return createFashnDriver({ apiKey: env.FASHN_API_KEY!, ...(options.fetch === undefined ? {} : { fetch: options.fetch }) });
  return createDrawnTryOnDriver();
}
