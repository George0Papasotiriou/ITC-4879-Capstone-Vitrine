/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Job names, payload types and queue constants shared by web and worker.
 */

/**
 * Job contracts shared by `web` (which enqueues) and `worker` (which runs).
 *
 * Adding a job means adding one entry here and one processor in
 * `src/worker/processors/`. The map is the single place that defines what a
 * job is called and what it carries, so a typo in either service is a compile
 * error rather than a job that silently never runs.
 */
export type JobPayloads = {
  /** Phase 1 liveness probe: proves web -> Redis -> worker end to end. */
  ping: { requestedAt: string; note?: string };
  /** Phase 8: rebuild the Taste Graph's neighbour lists and popularity (A2). Nightly in production. */
  "rebuild-taste-graph": { requestedAt: string; reason: "schedule" | "manual" | "simulation" };
};

export type JobName = keyof JobPayloads;

/** One BullMQ queue per concern. Phase 1 needs only the default queue. */
export const QUEUE_NAMES = {
  default: "vitrine:default",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

/** Which queue each job runs on. */
export const JOB_QUEUE: Record<JobName, QueueName> = {
  ping: QUEUE_NAMES.default,
  "rebuild-taste-graph": QUEUE_NAMES.default,
};

/**
 * The worker writes this key every 15 seconds with a 60 second TTL. `/api/health`
 * reads it to tell "worker is running" apart from "worker crashed 20 minutes ago".
 */
export const WORKER_HEARTBEAT_KEY = "vitrine:worker:heartbeat";
export const WORKER_HEARTBEAT_TTL_SECONDS = 60;
export const WORKER_HEARTBEAT_INTERVAL_MS = 15_000;
