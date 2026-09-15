/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Inline jobs driver: runs jobs in-process with retries as the local stand-in for BullMQ.
 */

import { uuidv7 } from "uuidv7";

import type { JobName, JobPayloads } from "@/lib/jobs/types";
import { loggerFor } from "@/lib/log";

/**
 * The inline jobs driver: the local stand-in for Redis and BullMQ (ADR-008).
 *
 * `enqueue` returns immediately with an id and the job runs a moment later in
 * the same process, with the same retry policy as production — three attempts,
 * exponential backoff. What it does not give you is durability: a job in flight
 * is lost if the process stops. That is acceptable for a laptop and exactly why
 * `src/env.ts` refuses this driver in production.
 *
 * Jobs still go through the shared processor registry, so the code under test
 * locally is the code the worker runs.
 */

export type InlineJobOptions = {
  attempts?: number;
  /** Base delay for exponential backoff, in milliseconds. */
  backoffMs?: number;
};

type Stats = { enqueued: number; succeeded: number; failed: number; lastRunAt: string | null };

const stats: Stats = { enqueued: 0, succeeded: 0, failed: 0, lastRunAt: null };
const pending = new Set<Promise<void>>();

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Backoff for attempt n (1-based): base, 2×base, 4×base… — the same curve as
 * BullMQ's "exponential" setting, so a flaky dependency is retried on the same
 * schedule locally as in production.
 */
export function backoffDelay(attempt: number, baseMs: number): number {
  return baseMs * 2 ** (attempt - 1);
}

export function enqueueInline<N extends JobName>(
  name: N,
  payload: JobPayloads[N],
  options: InlineJobOptions = {},
): string {
  const id = uuidv7();
  const attempts = options.attempts ?? 3;
  const backoffMs = options.backoffMs ?? 2_000;
  const log = loggerFor({ job: name, jobId: id, driver: "inline" });

  stats.enqueued += 1;

  const run = (async () => {
    // Yield first, so enqueue behaves like a queue: the caller's response is
    // never waiting on the job.
    await sleep(0);

    // Loaded on first use: the registry pulls in every processor, and none of
    // that belongs in a request path that only enqueues.
    const { processors } = await import("@/worker/registry");
    const processor = processors[name];

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const startedAt = Date.now();
      try {
        await processor(payload, id);
        stats.succeeded += 1;
        stats.lastRunAt = new Date().toISOString();
        log.info({ attempt, durationMs: Date.now() - startedAt }, "job succeeded");
        return;
      } catch (error) {
        const final = attempt === attempts;
        log[final ? "error" : "warn"](
          { attempt, attempts, durationMs: Date.now() - startedAt, err: error },
          final ? "job failed" : "job attempt failed, retrying",
        );
        if (final) {
          stats.failed += 1;
          stats.lastRunAt = new Date().toISOString();
          return;
        }
        await sleep(backoffDelay(attempt, backoffMs));
      }
    }
  })();

  pending.add(run);
  void run.finally(() => pending.delete(run));

  return id;
}

/** Counts for the health check. */
export function inlineJobStats(): Readonly<Stats> {
  return { ...stats };
}

/** Waits until every job enqueued so far has finished. For tests. */
export async function drainInlineJobs(): Promise<void> {
  while (pending.size > 0) {
    await Promise.all([...pending]);
  }
}
