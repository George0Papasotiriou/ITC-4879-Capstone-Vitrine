/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Everything /admin/system shows, read from the key-value store in one go.
 */

import { dayKey, kv } from "@/lib/kv";
import { cacheCounts } from "@/lib/kv/cache";
import { refusalsOn } from "@/lib/kv/rate-limit";
import type { KeyValue } from "@/lib/kv/types";
import { readTrending } from "@/lib/search/trending";

/** docs/adr/039. Today and yesterday are UTC days, as the counters are kept. */
export async function systemFigures(store: KeyValue = kv(), now = Date.now()) {
  const today = dayKey(new Date(now));
  const yesterday = dayKey(new Date(now - 24 * 60 * 60 * 1000));
  const [stats, cache, refusedToday, refusedYesterday, trending] = await Promise.all([
    store.stats(),
    cacheCounts("search", today, store),
    refusalsOn(today, store),
    refusalsOn(yesterday, store),
    readTrending(store, now, 12),
  ]);
  return { stats, cache, refusedToday, refusedYesterday, trending };
}
