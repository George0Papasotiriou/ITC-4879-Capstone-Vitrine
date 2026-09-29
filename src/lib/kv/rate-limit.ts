/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Rate limits shared by every web server, through the key-value store.
 */

import { createRateLimiter } from "@/lib/ai/guardrails/rate-limit";
import { anonymous, dayKey, kv } from "@/lib/kv";
import type { KeyValue } from "@/lib/kv/types";
import { logger } from "@/lib/log";

/**
 * docs/adr/039. The per-process limiter (src/lib/ai/guardrails/rate-limit.ts)
 * counted each web server separately, so two servers let twice the limit
 * through. This one keeps one sliding window per person and limit in the
 * shared store. The person is an address or account id, stored only as a keyed
 * hash (`anonymous`). If the store cannot be reached, the process's own window
 * takes over for that request: a limit is protection, never the reason a
 * shopper is turned away.
 *
 * Every refusal is counted per limit and day, for /admin/system.
 */

export type LimitName = "concierge" | "concierge-tools" | "reco-events" | "study" | "support-new" | "support-reply" | "hand-over" | "mcp" | "csp-report";

const DAY_SECONDS = 60 * 60 * 24;

export function sharedRateLimiter({ name, limit, windowMs }: { name: LimitName; limit: number; windowMs: number }, store: () => KeyValue = kv) {
  const local = createRateLimiter({ limit, windowMs });
  let warned = false;

  return async function allow(who: string, now = Date.now()): Promise<boolean> {
    try {
      const { allowed } = await store().hit(`vt:limit:${name}:${anonymous(who)}`, limit, windowMs, now);
      if (!allowed) await store().incr(`vt:stats:refused:${name}:${dayKey(new Date(now))}`, 8 * DAY_SECONDS);
      return allowed;
    } catch (error) {
      if (!warned) {
        warned = true;
        logger.warn({ err: error, limit: name }, "shared rate limit unavailable; this process counts on its own");
      }
      return local(who, now);
    }
  };
}

/** Refusals per limit for one day (UTC), for the admin page. */
export async function refusalsOn(day: string, store: KeyValue = kv()): Promise<Record<LimitName, number>> {
  const names: LimitName[] = ["concierge", "concierge-tools", "reco-events", "study", "support-new", "support-reply", "hand-over", "mcp"];
  const counts = await Promise.all(names.map(async (name) => Number((await store.get(`vt:stats:refused:${name}:${day}`)) ?? "0")));
  return Object.fromEntries(names.map((name, index) => [name, counts[index]!])) as Record<LimitName, number>;
}
