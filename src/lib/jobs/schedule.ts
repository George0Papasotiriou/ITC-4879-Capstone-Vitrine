/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The shop's recurring jobs: one table, run by BullMQ in production and by a plain interval locally.
 */

import { enqueue } from "@/lib/jobs/queue";
import type { JobName, JobPayloads } from "@/lib/jobs/types";
import { loggerFor } from "@/lib/log";

/**
 * Recurring work is described once here (docs/adr/020) and run two ways:
 *
 * - in production the worker upserts each entry as a BullMQ job scheduler,
 *   keyed by `id`, so a redeploy replaces the schedule instead of adding a
 *   second one, and Redis keeps the clock;
 * - locally there is no Redis, so the web process runs each entry on an
 *   interval. It is not a clock: a laptop that is asleep simply misses a turn,
 *   which is why every scheduled job is written to be safe to run twice and at
 *   any hour.
 *
 * The patterns are UTC, like every other time in the shop.
 */

/** Payload shape every scheduled job accepts, so one table can enqueue them all. */
export type SchedulePayload = { requestedAt: string; reason: "schedule" };

/** The jobs whose payload a schedule can build. */
export type ScheduledJobName = { [N in JobName]: SchedulePayload extends JobPayloads[N] ? N : never }[JobName];

export type ScheduledJob = {
  /** Stable key: upserting with the same id replaces the schedule. */
  id: string;
  job: ScheduledJobName;
  /** Cron, UTC, for BullMQ. */
  pattern: string;
  /**
   * What the local stand-in does instead of cron; null for a job that runs only
   * in production and locally only when asked (it would download gigabytes on
   * a laptop that never asked for them).
   */
  localEveryMs: number | null;
};

const MINUTE = 60_000;

export const SCHEDULES: readonly ScheduledJob[] = [
  // Early morning, before the shop is busy: the people who hear from it are asleep either way.
  { id: "price-watches-daily", job: "price-watches", pattern: "0 5 * * *", localEveryMs: 15 * MINUTE },
  // Monday morning, covering the week that just ended.
  { id: "weekly-report", job: "weekly-report", pattern: "0 6 * * 1", localEveryMs: 60 * MINUTE },
  // The Taste Graph is rebuilt nightly, after the day's behaviour is in.
  { id: "taste-graph-nightly", job: "rebuild-taste-graph", pattern: "30 3 * * *", localEveryMs: 30 * MINUTE },
  // Photographs are kept for a day; the sweep runs often enough that "deleted
  // after 24 hours" is true to the quarter hour (docs/adr/023).
  { id: "photo-expiry", job: "photo-expiry", pattern: "*/15 * * * *", localEveryMs: 15 * MINUTE },
  // After a deploy, the pieces with a 3D scan get it a few at a time; once all have, a run finds nothing to do (docs/adr/035).
  // Not on a local timer: locally, `pnpm catalog models` does it when asked.
  { id: "catalog-models", job: "catalog-models", pattern: "*/5 * * * *", localEveryMs: null },
  // The shop's own models of the pieces without a scan, built ahead thirty at a time (docs/adr/058). Locally,
  // `pnpm catalog made` does it when asked; a shopper's request builds any that are missing anyway.
  { id: "made-models", job: "made-models", pattern: "*/10 * * * *", localEveryMs: null },
  // Unpaid orders past their 30-minute hold give their stock back and their payment is voided,
  // so a card cannot be charged for an order that no longer exists (docs/adr/038).
  { id: "orders-expire", job: "orders-expire", pattern: "*/5 * * * *", localEveryMs: 5 * MINUTE },
];

/** Enqueues one scheduled job now. Used by the two schedulers and by "run it now" buttons. */
export async function enqueueScheduled(job: ScheduledJobName): Promise<string> {
  return enqueue(job, { requestedAt: new Date().toISOString(), reason: "schedule" });
}

/**
 * Production: tell Redis about every schedule. Safe to call on every worker
 * start — `upsertJobScheduler` replaces the entry with the same id.
 */
export async function registerBullSchedules(): Promise<void> {
  const log = loggerFor({ scheduler: "bullmq" });
  const [{ Queue }, { createRedis }, { JOB_QUEUE }] = await Promise.all([import("bullmq"), import("@/lib/jobs/redis"), import("@/lib/jobs/types")]);
  const queues = new Map<string, InstanceType<typeof Queue>>();
  try {
    for (const schedule of SCHEDULES) {
      const name = JOB_QUEUE[schedule.job];
      let queue = queues.get(name);
      if (queue === undefined) {
        queue = new Queue(name, { connection: createRedis({ forBullMq: true }) });
        queues.set(name, queue);
      }
      await queue.upsertJobScheduler(
        schedule.id,
        { pattern: schedule.pattern, tz: "UTC" },
        { name: schedule.job, data: { requestedAt: new Date().toISOString(), reason: "schedule" } },
      );
      log.info({ id: schedule.id, job: schedule.job, pattern: schedule.pattern }, "schedule registered");
    }
  } finally {
    await Promise.all([...queues.values()].map((queue) => queue.close()));
  }
}

/**
 * The local stand-in: one interval per schedule, started once per process.
 * Returns a function that stops them, which the tests use.
 */
export function startLocalSchedules({ now = Date.now, setTimer = setInterval, clearTimer = clearInterval }: LocalSchedulerOptions = {}): () => void {
  const log = loggerFor({ scheduler: "local" });
  const running = new Set<ScheduledJobName>();
  const timers = SCHEDULES.flatMap((schedule) => {
    if (schedule.localEveryMs === null) return [];
    const startedAt = now();
    const timer = setTimer(() => {
      // Never two at once: a slow pass on a laptop must not pile up behind itself.
      if (running.has(schedule.job)) return;
      running.add(schedule.job);
      void enqueueScheduled(schedule.job)
        .then((id) => log.info({ job: schedule.job, jobId: id, afterMs: now() - startedAt }, "scheduled job enqueued"))
        .catch((error: unknown) => log.warn({ err: error, job: schedule.job }, "scheduled job could not be enqueued"))
        .finally(() => running.delete(schedule.job));
    }, schedule.localEveryMs);
    // Node keeps running for a timer; a scheduler must not be the reason a process stays alive.
    (timer as { unref?: () => void }).unref?.();
    return [timer];
  });
  return () => timers.forEach((timer) => clearTimer(timer as ReturnType<typeof setInterval>));
}

export type LocalSchedulerOptions = {
  now?: () => number;
  setTimer?: typeof setInterval;
  clearTimer?: typeof clearInterval;
};
