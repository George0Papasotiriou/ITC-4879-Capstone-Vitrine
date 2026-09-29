/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The small key-value contract the shop uses beside PostgreSQL: Redis in production, memory on a laptop.
 */

/**
 * docs/adr/039. PostgreSQL keeps what must last; this keeps what is short-lived
 * and shared between processes: rate-limit windows, cached search rankings,
 * trending counts, and messages from one service to another ("this order was
 * just paid"). Every value can be lost without harm — a lost window only lets a
 * few more requests through, a lost cache is recomputed, a lost message is
 * caught by the page's next refresh.
 *
 * Every key the shop writes starts with `vt:<namespace>:`, so the admin page
 * can say how much each part uses and nothing collides with BullMQ's keys.
 */

export type KvStats = {
  kind: "redis" | "memory";
  /** Keys per namespace (`vt:<namespace>:…`), counted up to a cap. */
  keysByNamespace: Record<string, number>;
  /** True when the count stopped at the cap. */
  truncated: boolean;
  /** Redis's own figure ("2.31M"), or null in memory. */
  usedMemory: string | null;
};

export interface KeyValue {
  readonly kind: "redis" | "memory";
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  /** Sets only when absent; true when this call set it (a de-duplication gate). */
  setIfAbsent(key: string, value: string, ttlSeconds: number): Promise<boolean>;
  /** Adds one; the key is created with the time to live, which later increments do not extend. */
  incr(key: string, ttlSeconds: number): Promise<number>;
  del(key: string): Promise<void>;
  /**
   * One request against a sliding window: the hit is recorded only when fewer
   * than `limit` were recorded in the last `windowMs`, atomically.
   */
  hit(key: string, limit: number, windowMs: number, now: number): Promise<{ allowed: boolean; count: number }>;
  /** Adds to a member's score in a sorted set, giving the set a time to live. */
  zincrby(key: string, member: string, by: number, ttlSeconds: number): Promise<void>;
  /** The highest-scoring members, best first. */
  ztop(key: string, count: number): Promise<{ member: string; score: number }[]>;
  publish(channel: string, message: string): Promise<void>;
  /** Listens on a channel; the returned function stops listening. */
  subscribe(channel: string, listener: (message: string) => void): Promise<() => void>;
  stats(): Promise<KvStats>;
}

export const KEY_PREFIX = "vt:";
/** How many keys the admin page counts before it says "at least". */
export const STATS_KEY_CAP = 20_000;

export function namespaceOf(key: string): string {
  if (!key.startsWith(KEY_PREFIX)) return "other";
  const rest = key.slice(KEY_PREFIX.length);
  const end = rest.indexOf(":");
  return end === -1 ? rest : rest.slice(0, end);
}
