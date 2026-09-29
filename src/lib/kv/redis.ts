/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The key-value contract on Redis: one connection for commands, one for listening.
 */

import type { Redis } from "ioredis";

import { KEY_PREFIX, namespaceOf, STATS_KEY_CAP, type KeyValue, type KvStats } from "@/lib/kv/types";

/**
 * docs/adr/039. Two operations need more than one Redis command to be right,
 * and a Lua script makes each atomic, so two web servers asking at the same
 * moment cannot both slip under a limit:
 *
 *   hit    drop the window's old entries, count, and add this one only if the
 *          count is under the limit — a sorted set of timestamps per key
 *          (the sliding-window log; exact, where a fixed window lets twice the
 *          limit through across a boundary);
 *   incr   increment, and give the key its time to live only when this made it.
 *
 * Listening needs a connection of its own: a Redis connection that subscribes
 * can do nothing else. One is opened the first time something listens, and it
 * dispatches every message to the listeners of its channel.
 */

const HIT = `
redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, tonumber(ARGV[1]) - tonumber(ARGV[2]))
local count = redis.call('ZCARD', KEYS[1])
if count < tonumber(ARGV[3]) then
  redis.call('ZADD', KEYS[1], ARGV[1], ARGV[4])
  redis.call('PEXPIRE', KEYS[1], ARGV[2])
  return {1, count + 1}
end
return {0, count}
`;

const INCR = `
local value = redis.call('INCR', KEYS[1])
if value == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return value
`;

export function createRedisKv(commands: () => Redis, subscriber: () => Redis): KeyValue {
  const listeners = new Map<string, Set<(message: string) => void>>();
  let listening: Redis | undefined;
  let sequence = 0;

  const listener = () => {
    if (listening !== undefined) return listening;
    listening = subscriber();
    listening.on("message", (channel: string, message: string) => {
      for (const listen of listeners.get(channel) ?? []) listen(message);
    });
    return listening;
  };

  return {
    kind: "redis",
    get: (key) => commands().get(key),
    set: async (key, value, ttlSeconds) => {
      await commands().set(key, value, "EX", Math.max(1, Math.round(ttlSeconds)));
    },
    setIfAbsent: async (key, value, ttlSeconds) => (await commands().set(key, value, "EX", Math.max(1, Math.round(ttlSeconds)), "NX")) === "OK",
    incr: async (key, ttlSeconds) => Number(await commands().eval(INCR, 1, key, Math.max(1, Math.round(ttlSeconds)))),
    del: async (key) => {
      await commands().del(key);
    },
    hit: async (key, limit, windowMs, now) => {
      // A unique member per hit: two requests in the same millisecond are two entries.
      sequence = (sequence + 1) % 1_000_000;
      const [allowed, count] = (await commands().eval(HIT, 1, key, now, windowMs, limit, `${now}-${process.pid}-${sequence}`)) as [number, number];
      return { allowed: allowed === 1, count };
    },
    zincrby: async (key, member, by, ttlSeconds) => {
      await commands().multi().zincrby(key, by, member).expire(key, Math.max(1, Math.round(ttlSeconds))).exec();
    },
    ztop: async (key, count) => {
      const flat = await commands().zrevrange(key, 0, Math.max(0, count - 1), "WITHSCORES");
      const top: { member: string; score: number }[] = [];
      for (let i = 0; i + 1 < flat.length; i += 2) top.push({ member: flat[i]!, score: Number(flat[i + 1]) });
      return top;
    },
    publish: async (channel, message) => {
      await commands().publish(channel, message);
    },
    subscribe: async (channel, listen) => {
      const set = listeners.get(channel) ?? new Set();
      const first = set.size === 0;
      set.add(listen);
      listeners.set(channel, set);
      if (first) await listener().subscribe(channel);
      return () => {
        set.delete(listen);
        if (set.size === 0) {
          listeners.delete(channel);
          void listener().unsubscribe(channel).catch(() => {});
        }
      };
    },
    stats: async (): Promise<KvStats> => {
      const client = commands();
      const keysByNamespace: Record<string, number> = {};
      let cursor = "0";
      let counted = 0;
      do {
        const [next, keys] = await client.scan(cursor, "MATCH", `${KEY_PREFIX}*`, "COUNT", 500);
        cursor = next;
        for (const key of keys) {
          const namespace = namespaceOf(key);
          keysByNamespace[namespace] = (keysByNamespace[namespace] ?? 0) + 1;
        }
        counted += keys.length;
      } while (cursor !== "0" && counted < STATS_KEY_CAP);
      const memory = await client.info("memory");
      const used = /used_memory_human:(\S+)/.exec(memory)?.[1] ?? null;
      return { kind: "redis", keysByNamespace, truncated: cursor !== "0", usedMemory: used };
    },
  };
}
