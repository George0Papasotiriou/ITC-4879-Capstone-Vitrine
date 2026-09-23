/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The seam where a realtime voice model joins: what it would return, and why it does not yet.
 */

import { serverEnv } from "@/env";

/**
 * Realtime voice (docs/adr/026, docs/PLAN.md Phase 7 step 1).
 *
 * The plan's voice is a realtime model: audio in, audio out, tool calls over
 * the same socket. The AI SDK has the client for it
 * (`Experimental_AbstractRealtimeSession`, `experimental_getRealtimeToolDefinitions`),
 * and the tools are already a registry the socket could be given
 * (`/api/concierge/tools`). What is missing is a key, and an API that is still
 * marked experimental in the SDK we pin.
 *
 * So this file is the seam, not a stub that pretends: `realtimeVoiceConfigured`
 * is the one place that decides, and it says no until a key and a verified API
 * exist. Until then the browser's own speech carries the audio and the
 * ordinary Concierge endpoint carries the thinking — the same tools, the same
 * guardrails, the same costs.
 */

export type RealtimeToken = { value: string; url: string; expiresAt: number };

/** Whether a realtime session can be minted at all. */
export function realtimeVoiceConfigured(): boolean {
  // Two things are needed, and only one of them is an environment variable.
  // The second — a realtime API this project has read and pinned — is a change
  // to this file, which is why it is not written as a variable check alone.
  return serverEnv().aiMode === "google" && false;
}

/** The ephemeral token a browser would open the socket with. */
export function liveSession(): RealtimeToken {
  throw new Error("Realtime voice is not configured. See docs/adr/026; the browser's own speech is used instead.");
}
