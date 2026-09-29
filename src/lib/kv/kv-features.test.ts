/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Tests for what the shop builds on the key-value store: shared limits, the search cache, live order messages.
 */

import { describe, expect, it, vi } from "vitest";

import { cacheCounts, cached, bumpCatalogVersion } from "@/lib/kv/cache";
import { publishOrderChange, subscribeOrder } from "@/lib/kv/live";
import { createMemoryKv } from "@/lib/kv/memory";
import { refusalsOn, sharedRateLimiter } from "@/lib/kv/rate-limit";
import type { KeyValue } from "@/lib/kv/types";

const broken = (): KeyValue => {
  const fail = async () => {
    throw new Error("store unreachable");
  };
  return { kind: "redis", get: fail, set: fail, setIfAbsent: fail, incr: fail, del: fail, hit: fail, zincrby: fail, ztop: fail, publish: fail, subscribe: fail, stats: fail };
};

describe("sharedRateLimiter", () => {
  it("allows the limit per person and window, then refuses and counts the refusal", async () => {
    const store = createMemoryKv();
    const allow = sharedRateLimiter({ name: "concierge", limit: 2, windowMs: 60_000 }, () => store);
    const at = Date.UTC(2026, 8, 29, 9);
    expect([await allow("1.2.3.4", at), await allow("1.2.3.4", at + 1), await allow("1.2.3.4", at + 2)]).toEqual([true, true, false]);
    // Another person has their own window.
    expect(await allow("5.6.7.8", at + 3)).toBe(true);
    expect((await refusalsOn("2026-09-29", store)).concierge).toBe(1);
  });

  it("keeps no address in the store, only a keyed hash", async () => {
    const store = createMemoryKv();
    const allow = sharedRateLimiter({ name: "study", limit: 5, windowMs: 60_000 }, () => store);
    await allow("203.0.113.9");
    const stats = await store.stats();
    expect(stats.keysByNamespace.limit).toBe(1);
    const spy = vi.spyOn(store, "hit");
    await allow("203.0.113.9");
    expect(spy.mock.calls[0]![0]).not.toContain("203.0.113.9");
  });

  it("falls back to this process's own window when the store is down, never turning people away for it", async () => {
    const allow = sharedRateLimiter({ name: "support-new", limit: 2, windowMs: 60_000 }, broken);
    expect([await allow("a"), await allow("a"), await allow("a")]).toEqual([true, true, false]);
  });
});

describe("cached", () => {
  it("computes once, answers from the store after, and counts both", async () => {
    const store = createMemoryKv();
    let computed = 0;
    const compute = async () => {
      computed += 1;
      return { ids: ["a", "b"] };
    };
    expect(await cached("search", { q: "sofa" }, 60, compute, () => store)).toEqual({ ids: ["a", "b"] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await cached("search", { q: "sofa" }, 60, compute, () => store)).toEqual({ ids: ["a", "b"] });
    expect(computed).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const today = new Date().toISOString().slice(0, 10);
    expect(await cacheCounts("search", today, store)).toEqual({ hits: 1, misses: 1 });
  });

  it("forgets every ranking when the catalogue changes", async () => {
    const store = createMemoryKv();
    let computed = 0;
    const compute = async () => ++computed;
    await cached("search", { q: "lamp" }, 60, compute, () => store);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await bumpCatalogVersion(store);
    expect(await cached("search", { q: "lamp" }, 60, compute, () => store)).toBe(2);
  });

  it("answers without the store when it cannot be reached", async () => {
    expect(await cached("search", { q: "rug" }, 60, async () => "fresh", broken)).toBe("fresh");
  });
});

describe("live order messages", () => {
  it("reaches the pages listening to that order, and only them", async () => {
    const store = createMemoryKv();
    const heard: string[] = [];
    const stop = await subscribeOrder("order-1", (change) => heard.push(change.status), store);
    await subscribeOrder("order-2", (change) => heard.push(`other ${change.status}`), store);
    await publishOrderChange("order-1", "paid", store);
    stop();
    await publishOrderChange("order-1", "packed", store);
    expect(heard).toEqual(["paid"]);
  });

  it("does not throw when the store is down: the page catches up on its next refresh", async () => {
    await expect(publishOrderChange("order-1", "paid", broken())).resolves.toBeUndefined();
  });
});
