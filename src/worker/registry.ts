/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Job dispatch table mapping job names to processors.
 */

import type { JobName, JobPayloads } from "@/lib/jobs/types";
import { processPing } from "@/worker/processors/ping";
import { processPriceWatches } from "@/worker/processors/price-watches";
import { processRebuildTasteGraph } from "@/worker/processors/rebuild-taste-graph";
import { processWeeklyReport } from "@/worker/processors/weekly-report";

/**
 * The job dispatch table, shared by both ways a job can run.
 *
 * In production the worker service pulls jobs from Redis and looks up the
 * processor here. Locally, the inline driver calls the very same processor in
 * process. There is exactly one definition of what each job does; only the
 * transport differs, so a job that passes locally cannot behave differently in
 * the worker for want of shared code.
 *
 * The mapped type makes a job name without a processor a compile error rather
 * than a job that is silently dropped.
 */
export type Processor<N extends JobName> = (payload: JobPayloads[N], jobId: string) => Promise<unknown>;

export const processors: { [N in JobName]: Processor<N> } = {
  ping: processPing,
  "rebuild-taste-graph": processRebuildTasteGraph,
  "price-watches": processPriceWatches,
  "weekly-report": processWeeklyReport,
};
