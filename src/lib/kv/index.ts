/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The shop's key-value store: Redis whenever REDIS_URL is set, this process's memory otherwise.
 */

import { createHmac } from "node:crypto";

import { serverEnv } from "@/env";
import { createRedis, redis } from "@/lib/jobs/redis";
import { createMemoryKv } from "@/lib/kv/memory";
import { createRedisKv } from "@/lib/kv/redis";
import type { KeyValue } from "@/lib/kv/types";

let store: KeyValue | undefined;

/** The store for this process; the same one for every caller. Usable from pages, routes and the worker. */
export function kv(): KeyValue {
  store ??= serverEnv().REDIS_URL !== undefined ? createRedisKv(redis, () => createRedis()) : createMemoryKv();
  return store;
}

/** For tests: use this store instead. */
export function useKvForTests(replacement: KeyValue | undefined): void {
  store = replacement;
}

/**
 * A key part that stands for a person without naming them: an address or an
 * account id, keyed with the shop's own secret so the stored value cannot be
 * turned back into the address by trying them all. Nothing in the store says
 * who anyone is.
 */
export function anonymous(value: string): string {
  // Read raw, so a script or test without the full settings can still key its values.
  const salt = process.env.COOKIE_SECRET || "vitrine-local";
  return createHmac("sha256", salt).update(value).digest("base64url").slice(0, 22);
}

/** Today in UTC, as the day counters name it. */
export function dayKey(at = new Date()): string {
  return at.toISOString().slice(0, 10);
}

export type { KeyValue, KvStats } from "@/lib/kv/types";
