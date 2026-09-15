/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Job processor that rebuilds the Taste Graph.
 */

import { sql } from "@/lib/db/client";
import type { JobPayloads } from "@/lib/jobs/types";
import { loggerFor } from "@/lib/log";
import { createTasteGraph } from "@/lib/reco/store";

/**
 * Rebuilds the Taste Graph (A2, Phase 8 step 3): behavioural and content
 * neighbour lists, their blend, and product popularity, from the last 90 days
 * of consented interactions. Idempotent — a rerun replaces the lists — so a
 * retried job cannot leave duplicates.
 */
export async function processRebuildTasteGraph(payload: JobPayloads["rebuild-taste-graph"], jobId: string) {
  const log = loggerFor({ job: "rebuild-taste-graph", jobId });
  const stats = await createTasteGraph(sql).rebuild();
  log.info({ ...stats, reason: payload.reason }, "taste graph rebuilt");
  return stats;
}
