/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Enqueues jobs through BullMQ or the inline driver.
 */

import type { JobsOptions, Queue } from "bullmq";

import { serverEnv } from "@/env";
import { enqueueInline } from "@/lib/jobs/inline";
import {
  JOB_QUEUE,
  QUEUE_NAMES,
  type JobName,
  type JobPayloads,
  type QueueName,
} from "@/lib/jobs/types";

/**
 * Enqueueing, independent of the jobs driver (ADR-008).
 *
 * Callers write `enqueue("ping", payload)` and never learn which driver runs it:
 * BullMQ on Redis in production, the inline driver on a laptop.
 *
 * BullMQ is imported lazily so that a process using the inline driver never
 * loads it or opens a Redis connection it has nowhere to send.
 */

const queues = new Map<QueueName, Queue>();

async function getQueue(name: QueueName): Promise<Queue> {
  let queue = queues.get(name);
  if (queue === undefined) {
    const [{ Queue: BullQueue }, { createRedis }] = await Promise.all([
      import("bullmq"),
      import("@/lib/jobs/redis"),
    ]);
    // Queue handles are created once per process and reused: each one opens a
    // Redis connection, so one per request would exhaust the connection limit.
    queue = new BullQueue(name, { connection: createRedis({ forBullMq: true }) });
    queues.set(name, queue);
  }
  return queue;
}

const DEFAULTS = {
  attempts: 3,
  backoffMs: 2_000,
} as const;

/**
 * Enqueue a job. The payload type is derived from the job name, so
 * `enqueue("ping", { wrong: true })` does not compile.
 */
export async function enqueue<N extends JobName>(
  name: N,
  payload: JobPayloads[N],
  options?: Pick<JobsOptions, "attempts" | "delay" | "jobId">,
): Promise<string> {
  if (serverEnv().jobsDriver === "inline") {
    return enqueueInline(name, payload, {
      attempts: options?.attempts ?? DEFAULTS.attempts,
      backoffMs: DEFAULTS.backoffMs,
    });
  }

  const queue = await getQueue(JOB_QUEUE[name]);
  const job = await queue.add(name, payload, {
    attempts: DEFAULTS.attempts,
    backoff: { type: "exponential", delay: DEFAULTS.backoffMs },
    removeOnComplete: { age: 3_600, count: 1_000 },
    removeOnFail: { age: 24 * 3_600 },
    ...options,
  });
  return job.id ?? "unknown";
}

/** Closes every queue connection. Used by tests and graceful shutdown. */
export async function closeQueues(): Promise<void> {
  await Promise.all([...queues.values()].map((queue) => queue.close()));
  queues.clear();
}

export { QUEUE_NAMES };
