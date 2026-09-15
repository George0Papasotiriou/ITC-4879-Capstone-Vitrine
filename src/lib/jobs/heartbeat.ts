/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Pure worker liveness check based on the heartbeat timestamp.
 */

import { WORKER_HEARTBEAT_TTL_SECONDS } from "@/lib/jobs/types";

/**
 * Worker liveness, as a pure function so it can be tested without Redis.
 *
 * The worker has no public URL. It proves it is alive by refreshing a Redis key
 * every 15 seconds; the key carries a TTL, so an absent key already means
 * "silent for at least a TTL". The age check below additionally catches a clock
 * or replication oddity where the key survives but is stale.
 */
export type HeartbeatVerdict =
  | { fresh: true; ageSeconds: number }
  | { fresh: false; reason: "missing" | "stale" | "unparseable"; ageSeconds: number | null };

export function readHeartbeat(
  lastBeatIso: string | null,
  now: Date = new Date(),
  ttlSeconds: number = WORKER_HEARTBEAT_TTL_SECONDS,
): HeartbeatVerdict {
  if (lastBeatIso === null || lastBeatIso === "") {
    return { fresh: false, reason: "missing", ageSeconds: null };
  }

  const beatMs = Date.parse(lastBeatIso);
  if (Number.isNaN(beatMs)) {
    return { fresh: false, reason: "unparseable", ageSeconds: null };
  }

  // A beat timestamped in the future means clock skew between services. Treat
  // the age as zero rather than negative: the worker is clearly alive.
  const ageSeconds = Math.max(0, Math.round((now.getTime() - beatMs) / 1000));

  return ageSeconds <= ttlSeconds
    ? { fresh: true, ageSeconds }
    : { fresh: false, reason: "stale", ageSeconds };
}
