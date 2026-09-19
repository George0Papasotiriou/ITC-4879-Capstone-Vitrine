/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * A short-window rate limit on AI requests per address, on top of the daily allowances.
 */

/**
 * Daily allowances (src/lib/ai/usage.ts) bound what one shopper can spend in a
 * day; this bounds how fast any single address can ask, so a script cannot burn
 * a guest's allowance, or many fresh guest cookies, in seconds. It counts per
 * server process in a sliding window of timestamps; with several web servers it
 * becomes the per-server limit, which is still an upper bound (docs/adr/019
 * notes Redis for a shared limit once Railway's Redis is in use).
 */

export function createRateLimiter({ limit, windowMs, maxKeys = 10_000 }: { limit: number; windowMs: number; maxKeys?: number }) {
  const hits = new Map<string, number[]>();

  return function allow(key: string, now = Date.now()): boolean {
    const recent = (hits.get(key) ?? []).filter((at) => now - at < windowMs);
    if (recent.length >= limit) {
      hits.set(key, recent);
      return false;
    }
    recent.push(now);
    hits.delete(key);
    hits.set(key, recent);
    // Oldest keys go first when the map is full, so memory stays bounded under a flood of addresses.
    while (hits.size > maxKeys) hits.delete(hits.keys().next().value!);
    return true;
  };
}
