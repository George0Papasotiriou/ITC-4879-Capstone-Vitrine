/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Ping job processor used as a liveness probe.
 */

import { loggerFor } from "@/lib/log";
import type { JobPayloads } from "@/lib/jobs/types";

/**
 * Liveness probe job (Phase 1).
 *
 * It proves the whole path works: `web` enqueues, Redis carries, `worker`
 * executes. Every later processor follows the same shape — take a typed
 * payload, do the work, return a small typed result.
 */
export async function processPing(
  payload: JobPayloads["ping"],
  jobId: string,
): Promise<{ ok: true; roundTripMs: number }> {
  const log = loggerFor({ job: "ping", jobId });
  const roundTripMs = Date.now() - Date.parse(payload.requestedAt);

  log.info({ roundTripMs, note: payload.note }, "ping processed");

  return { ok: true, roundTripMs };
}
