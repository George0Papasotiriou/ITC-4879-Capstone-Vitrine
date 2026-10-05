/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Read-through caching in the key-value store, cleared by a catalogue version rather than by hand.
 */

import { createHash } from "node:crypto";

import { dayKey, kv } from "@/lib/kv";
import type { KeyValue } from "@/lib/kv/types";

/**
 * docs/adr/039. What is cached is what is expensive and the same for
 * everybody: a search's ranking (ids, what the query was read as), a
 * capsule wardrobe or a completed look (ids, docs/adr/066), never
 * prices, stock or anything about a person — those are read fresh from the
 * database every time, so a cached ranking can be a little old but never
 * wrong about money.
 *
 * Invalidation by version: every key carries the catalogue's version number,
 * and the deploy's sync, a staff edit or a new product adds one to it. Old
 * entries are then never read again and expire on their own. A short time to
 * live bounds the rest (stock changes, reviews).
 */

export type CacheSpace = "search" | "wardrobe";

const VERSION_KEY = "vt:catalog:version";
const YEAR_SECONDS = 60 * 60 * 24 * 365;
const STATS_SECONDS = 60 * 60 * 24 * 8;

export async function catalogVersion(store: KeyValue = kv()): Promise<string> {
  return (await store.get(VERSION_KEY)) ?? "0";
}

/** After the catalogue changed: every cached ranking made before is left unread. */
export async function bumpCatalogVersion(store: KeyValue = kv()): Promise<void> {
  try {
    await store.incr(VERSION_KEY, YEAR_SECONDS);
  } catch {
    // Without the store there is no cache either; nothing to clear.
  }
}

export async function cached<T>(space: CacheSpace, parts: unknown, ttlSeconds: number, compute: () => Promise<T>, store: () => KeyValue = kv): Promise<T> {
  let key: string;
  try {
    const digest = createHash("sha256").update(JSON.stringify(parts)).digest("base64url").slice(0, 32);
    key = `vt:cache:${space}:${await catalogVersion(store())}:${digest}`;
    const hit = await store().get(key);
    if (hit !== null) {
      void store().incr(`vt:stats:cache:hit:${space}:${dayKey()}`, STATS_SECONDS).catch(() => {});
      return JSON.parse(hit) as T;
    }
  } catch {
    // The store is unreachable: answer without it.
    return compute();
  }
  const value = await compute();
  void store()
    .set(key, JSON.stringify(value), ttlSeconds)
    .then(() => store().incr(`vt:stats:cache:miss:${space}:${dayKey()}`, STATS_SECONDS))
    .catch(() => {});
  return value;
}

/** Hits and misses for one day, for the admin page. */
export async function cacheCounts(space: CacheSpace, day: string, store: KeyValue = kv()): Promise<{ hits: number; misses: number }> {
  const [hits, misses] = await Promise.all([store.get(`vt:stats:cache:hit:${space}:${day}`), store.get(`vt:stats:cache:miss:${space}:${day}`)]);
  return { hits: Number(hits ?? "0"), misses: Number(misses ?? "0") };
}
