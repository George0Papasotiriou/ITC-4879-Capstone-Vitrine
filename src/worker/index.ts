/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Worker service entry: BullMQ workers, heartbeat and graceful shutdown.
 */

import { Worker, type Job } from "bullmq";

import { createRedis } from "@/lib/jobs/redis";
import {
  QUEUE_NAMES,
  WORKER_HEARTBEAT_INTERVAL_MS,
  WORKER_HEARTBEAT_KEY,
  WORKER_HEARTBEAT_TTL_SECONDS,
  type JobName,
} from "@/lib/jobs/types";
import { logger } from "@/lib/log";
import { processors } from "@/worker/registry";

/**
 * The worker service.
 *
 * Anything slow, costly or scheduled runs here rather than in a request:
 * embeddings, try-on and video generation, Taste Graph builds, emails, reports
 * and cleanup (docs/PLAN.md 2.1). It is a second Railway service deployed from
 * the same repository, bundled by tsup into `dist/worker/index.js` (ADR-001).
 */

const log = logger.child({ service: "worker" });

async function runJob(job: Job): Promise<unknown> {
  const name = job.name as JobName;
  const processor = processors[name];

  if (processor === undefined) {
    throw new Error(`No processor registered for job "${job.name}".`);
  }

  const startedAt = Date.now();
  try {
    const result = await processor(job.data as never, job.id ?? "unknown");
    log.info(
      { job: job.name, jobId: job.id, durationMs: Date.now() - startedAt },
      "job succeeded",
    );
    return result;
  } catch (error) {
    log.error(
      {
        job: job.name,
        jobId: job.id,
        durationMs: Date.now() - startedAt,
        attempt: job.attemptsMade + 1,
        err: error,
      },
      "job failed",
    );
    throw error;
  }
}

const connection = createRedis({ forBullMq: true });
const heartbeatRedis = createRedis();

const workers = Object.values(QUEUE_NAMES).map(
  (queueName) =>
    new Worker(queueName, runJob, {
      connection,
      concurrency: 5,
    }),
);

for (const worker of workers) {
  worker.on("error", (error) => {
    log.error({ err: error }, "worker error");
  });
}

/**
 * Heartbeat. `/api/health` reads this key, so a crash-looping or wedged worker
 * shows up as unhealthy instead of looking fine because the service exists.
 */
async function writeHeartbeat(): Promise<void> {
  try {
    await heartbeatRedis.set(
      WORKER_HEARTBEAT_KEY,
      new Date().toISOString(),
      "EX",
      WORKER_HEARTBEAT_TTL_SECONDS,
    );
  } catch (error) {
    log.warn({ err: error }, "heartbeat write failed");
  }
}

void writeHeartbeat();
const heartbeat = setInterval(() => {
  void writeHeartbeat();
}, WORKER_HEARTBEAT_INTERVAL_MS);

log.info(
  { queues: Object.values(QUEUE_NAMES) },
  "worker started",
);

/**
 * Graceful shutdown. Railway sends SIGTERM on redeploy; BullMQ's `close()`
 * stops accepting new jobs and waits for in-flight ones, so a deploy never
 * tears a job in half. Anything still running when the grace period ends is
 * retried, because jobs are idempotent by contract.
 */
let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info({ signal }, "shutting down");

  clearInterval(heartbeat);

  try {
    await Promise.all(workers.map((worker) => worker.close()));
    await Promise.all([connection.quit(), heartbeatRedis.quit()]);
    log.info("shutdown complete");
    process.exit(0);
  } catch (error) {
    log.error({ err: error }, "shutdown failed");
    process.exit(1);
  }
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
