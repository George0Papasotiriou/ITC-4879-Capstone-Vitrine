/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Tests for agent keys: their shape, their hash, reading them from a header, and their life.
 */

import { describe, expect, it } from "vitest";

import { bearerKey, createKeySchema, expiresAfter, hashAgentKey, keyState, newAgentKey } from "@/lib/agents/tokens";

describe("agent keys", () => {
  it("are long, random, prefixed, and stored only as a hash", () => {
    const first = newAgentKey();
    const second = newAgentKey();
    expect(first.key).toMatch(/^vta_[A-Za-z0-9_-]{43}$/);
    expect(first.key).not.toBe(second.key);
    expect(first.hash).toBe(hashAgentKey(first.key));
    expect(first.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(first.hash).not.toContain(first.key.slice(4, 20));
    expect(first.hint).toBe(first.key.slice(-4));
  });

  it("are read from a Bearer header, and nothing else counts as one", () => {
    const { key } = newAgentKey();
    expect(bearerKey(`Bearer ${key}`)).toBe(key);
    expect(bearerKey(`bearer   ${key} `)).toBe(key);
    expect(bearerKey(null)).toBeNull();
    expect(bearerKey(key)).toBeNull();
    expect(bearerKey("Bearer sk_test_abc")).toBeNull();
    expect(bearerKey("Bearer vta_short")).toBeNull();
    expect(bearerKey(`Basic ${key}`)).toBeNull();
  });

  it("name what they may do, once each, and live 1, 7, 30 or 90 days", () => {
    expect(createKeySchema.parse({ name: " Claude ", scopes: ["orders", "cart", "cart"], days: "30" })).toEqual({ name: "Claude", scopes: ["cart", "orders"], days: 30 });
    expect(createKeySchema.safeParse({ name: "x", scopes: [], days: 30 }).success).toBe(false);
    expect(createKeySchema.safeParse({ name: "x", scopes: ["admin"], days: 30 }).success).toBe(false);
    expect(createKeySchema.safeParse({ name: "x", scopes: ["cart"], days: 365 }).success).toBe(false);
    expect(createKeySchema.safeParse({ name: "", scopes: ["cart"], days: 7 }).success).toBe(false);
  });

  it("expire on their date and stop at once when revoked", () => {
    const made = new Date("2026-09-29T10:00:00Z");
    const expiresAt = expiresAfter(7, made);
    expect(expiresAt.toISOString()).toBe("2026-10-06T10:00:00.000Z");
    expect(keyState({ expiresAt, revokedAt: null }, made)).toBe("active");
    expect(keyState({ expiresAt, revokedAt: null }, expiresAt)).toBe("expired");
    expect(keyState({ expiresAt, revokedAt: made }, made)).toBe("revoked");
  });
});
