/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Shared Redis connection factory.
 */

import { Redis } from "ioredis";

import { serverEnv } from "@/env";

/**
 * Shared Redis connection factory.
 *
 * Known gotcha (docs/PLAN.md, CLAUDE.md): on Railway's private network the
 * hostname may resolve over IPv6 only. `family: 0` lets Node try both stacks
 * instead of failing with ENOTFOUND.
 *
 * BullMQ requires `maxRetriesPerRequest: null` on the connections used by its
 * workers, otherwise long blocking reads are aborted.
 */
export function createRedis(options?: { forBullMq?: boolean }): Redis {
  const env = serverEnv();
  // Only the bullmq driver reaches this, and the environment contract requires
  // REDIS_URL for it; this makes that guarantee visible to the type checker.
  if (env.REDIS_URL === undefined) {
    throw new Error("Redis was requested but REDIS_URL is not set (jobs driver: " + env.jobsDriver + ").");
  }
  return new Redis(env.REDIS_URL, {
    family: 0,
    lazyConnect: false,
    ...(options?.forBullMq === true ? { maxRetriesPerRequest: null } : {}),
  });
}

let shared: Redis | undefined;

/** Connection for short commands (health checks, rate limits, caches). */
export function redis(): Redis {
  shared ??= createRedis();
  return shared;
}
