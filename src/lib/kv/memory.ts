/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The key-value contract in one process's memory: the laptop's stand-in for Redis, and the tests' reference.
 */

import { EventEmitter } from "node:events";

import { namespaceOf, STATS_KEY_CAP, type KeyValue, type KvStats } from "@/lib/kv/types";

/**
 * Behaves as the Redis driver does for everything the shop relies on —
 * expiry, the atomic sliding window, sorted sets, publish and subscribe — but
 * only within this process. On the local stack that is the whole shop (the web
 * server runs the jobs too); in production Redis is used instead, because web
 * and worker are separate processes.
 */
export function createMemoryKv(now: () => number = Date.now): KeyValue {
  const values = new Map<string, { value: string; expiresAt: number }>();
  const windows = new Map<string, number[]>();
  const sorted = new Map<string, { scores: Map<string, number>; expiresAt: number }>();
  const bus = new EventEmitter();
  bus.setMaxListeners(0);

  const alive = (expiresAt: number) => expiresAt > now();
  const read = (key: string) => {
    const entry = values.get(key);
    if (entry === undefined) return null;
    if (!alive(entry.expiresAt)) {
      values.delete(key);
      return null;
    }
    return entry;
  };

  return {
    kind: "memory",
    get: async (key) => read(key)?.value ?? null,
    set: async (key, value, ttlSeconds) => {
      values.set(key, { value, expiresAt: now() + ttlSeconds * 1000 });
    },
    setIfAbsent: async (key, value, ttlSeconds) => {
      if (read(key) !== null) return false;
      values.set(key, { value, expiresAt: now() + ttlSeconds * 1000 });
      return true;
    },
    incr: async (key, ttlSeconds) => {
      const entry = read(key);
      const next = (entry === null ? 0 : Number(entry.value)) + 1;
      values.set(key, { value: String(next), expiresAt: entry?.expiresAt ?? now() + ttlSeconds * 1000 });
      return next;
    },
    del: async (key) => {
      values.delete(key);
      windows.delete(key);
      sorted.delete(key);
    },
    hit: async (key, limit, windowMs, at) => {
      const recent = (windows.get(key) ?? []).filter((time) => time > at - windowMs);
      if (recent.length >= limit) {
        windows.set(key, recent);
        return { allowed: false, count: recent.length };
      }
      recent.push(at);
      windows.set(key, recent);
      return { allowed: true, count: recent.length };
    },
    zincrby: async (key, member, by, ttlSeconds) => {
      const entry = sorted.get(key);
      const set = entry !== undefined && alive(entry.expiresAt) ? entry.scores : new Map<string, number>();
      set.set(member, (set.get(member) ?? 0) + by);
      sorted.set(key, { scores: set, expiresAt: now() + ttlSeconds * 1000 });
    },
    ztop: async (key, count) => {
      const entry = sorted.get(key);
      if (entry === undefined || !alive(entry.expiresAt)) return [];
      return [...entry.scores.entries()]
        .map(([member, score]) => ({ member, score }))
        .sort((a, b) => b.score - a.score || a.member.localeCompare(b.member))
        .slice(0, count);
    },
    publish: async (channel, message) => {
      bus.emit(channel, message);
    },
    subscribe: async (channel, listener) => {
      bus.on(channel, listener);
      return () => bus.off(channel, listener);
    },
    stats: async (): Promise<KvStats> => {
      const keysByNamespace: Record<string, number> = {};
      let counted = 0;
      const keys = [...values.keys(), ...windows.keys(), ...sorted.keys()];
      for (const key of new Set(keys)) {
        if (counted >= STATS_KEY_CAP) break;
        const namespace = namespaceOf(key);
        keysByNamespace[namespace] = (keysByNamespace[namespace] ?? 0) + 1;
        counted += 1;
      }
      return { kind: "memory", keysByNamespace, truncated: counted >= STATS_KEY_CAP, usedMemory: null };
    },
  };
}
