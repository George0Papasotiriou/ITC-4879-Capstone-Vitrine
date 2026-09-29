/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The key-value contract, checked on the memory store always and on Redis when one is configured.
 */

import { Redis } from "ioredis";
import { afterAll, describe, expect, it } from "vitest";

import { createMemoryKv } from "@/lib/kv/memory";
import { createRedisKv } from "@/lib/kv/redis";
import { namespaceOf, type KeyValue } from "@/lib/kv/types";

/**
 * docs/adr/039. The same expectations for both drivers, so the laptop's
 * stand-in cannot drift from what production does. The Redis half runs where
 * `REDIS_URL` is set (CI, or `railway run pnpm test`); every key it writes is
 * under a prefix of its own and removed afterwards.
 */

type Clock = { now: number };

function contract(name: string, make: (clock: Clock) => KeyValue, prefix: string, { usesRealTime = false } = {}) {
  describe(name, () => {
    const clock: Clock = { now: Date.UTC(2026, 8, 29, 12) };
    const store = make(clock);
    const key = (rest: string) => `vt:test:${prefix}:${rest}`;

    it("keeps a value for its time to live", async () => {
      await store.set(key("a"), "hello", 60);
      expect(await store.get(key("a"))).toBe("hello");
      if (!usesRealTime) {
        clock.now += 61_000;
        expect(await store.get(key("a"))).toBeNull();
      }
    });

    it("sets only when absent", async () => {
      expect(await store.setIfAbsent(key("gate"), "1", 60)).toBe(true);
      expect(await store.setIfAbsent(key("gate"), "1", 60)).toBe(false);
    });

    it("counts up, keeping the first time to live", async () => {
      expect(await store.incr(key("n"), 60)).toBe(1);
      expect(await store.incr(key("n"), 60)).toBe(2);
      await store.del(key("n"));
      expect(await store.get(key("n"))).toBeNull();
    });

    it("lets through at most the limit in a sliding window, then the oldest hit leaves it", async () => {
      const at = Date.UTC(2026, 8, 29, 12);
      const results = [];
      for (let i = 0; i < 4; i += 1) results.push((await store.hit(key("window"), 3, 1000, at + i * 100)).allowed);
      expect(results).toEqual([true, true, true, false]);
      // 1,001 ms after the first hit it has left the window: one more fits.
      expect((await store.hit(key("window"), 3, 1000, at + 1001)).allowed).toBe(true);
      expect((await store.hit(key("window"), 3, 1000, at + 1002)).allowed).toBe(false);
    });

    it("keeps sorted scores, best first", async () => {
      await store.zincrby(key("z"), "sofa", 1, 60);
      await store.zincrby(key("z"), "lamp", 1, 60);
      await store.zincrby(key("z"), "sofa", 2, 60);
      expect(await store.ztop(key("z"), 5)).toEqual([
        { member: "sofa", score: 3 },
        { member: "lamp", score: 1 },
      ]);
      expect(await store.ztop(key("missing"), 5)).toEqual([]);
    });

    it("delivers a published message to its channel's listeners only", async () => {
      const heard: string[] = [];
      const stop = await store.subscribe(key("channel"), (message) => heard.push(message));
      const other = await store.subscribe(key("other"), (message) => heard.push(`other:${message}`));
      await store.publish(key("channel"), "paid");
      await new Promise((resolve) => setTimeout(resolve, usesRealTime ? 150 : 0));
      stop();
      other();
      await store.publish(key("channel"), "ignored");
      await new Promise((resolve) => setTimeout(resolve, usesRealTime ? 150 : 0));
      expect(heard).toEqual(["paid"]);
    });

    it("counts its keys by namespace", async () => {
      const stats = await store.stats();
      expect(stats.kind).toBe(store.kind);
      expect(stats.keysByNamespace.test ?? 0).toBeGreaterThan(0);
    });
  });
}

contract("memory store", (clock) => createMemoryKv(() => clock.now), "memory");

const redisUrl = process.env.REDIS_URL;
const connections: Redis[] = [];
if (redisUrl !== undefined && redisUrl !== "") {
  const prefix = `run-${process.pid}`;
  const open = () => {
    const connection = new Redis(redisUrl, { family: 0 });
    connections.push(connection);
    return connection;
  };
  const commands = open();
  contract("Redis store", () => createRedisKv(() => commands, open), prefix, { usesRealTime: true });
  afterAll(async () => {
    const keys = await commands.keys(`vt:test:${prefix}:*`);
    if (keys.length > 0) await commands.del(...keys);
    await Promise.all(connections.map((connection) => connection.quit()));
  });
}

describe("namespaceOf", () => {
  it("reads the part after vt:", () => {
    expect(namespaceOf("vt:limit:concierge:abc")).toBe("limit");
    expect(namespaceOf("vt:catalog")).toBe("catalog");
    expect(namespaceOf("bull:default:1")).toBe("other");
  });
});
