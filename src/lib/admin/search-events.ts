/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Search analytics: recording what people search for, without who, for the top and zero-result query panels.
 */

import type postgres from "postgres";
import { uuidv7 } from "uuidv7";

import { normalize } from "@/lib/search/normalize";

/**
 * Search events (docs/adr/018). A row holds the query, folded as search folds
 * it, how many results it found and whether search had to correct or relax
 * it — never a user, a session or an address. Before storing:
 * - email addresses are dropped;
 * - a run of 7 or more digits, even with spaces between groups ("690 000
 *   0000"), becomes "#": phone and card numbers never reach the table, while
 *   sizes such as "sofa 180 200" stay readable.
 * Rows older than 90 days are deleted as new ones are written.
 */

export const SEARCH_EVENTS_KEEP_DAYS = 90;
const MIN_MASKED_DIGITS = 7;
const MAX_QUERY_LENGTH = 200;
const EMAIL = /[^\s@]+@[^\s@]+/g;
/** Digit groups separated by single spaces (normalize has already turned dashes and dots into spaces). */
const DIGIT_RUN = /\d+(?: \d+)*/g;

export function maskQuery(raw: string): string {
  const folded = normalize(raw.replace(EMAIL, " ").slice(0, MAX_QUERY_LENGTH * 2));
  return folded
    .replace(DIGIT_RUN, (run) => (run.replace(/ /g, "").length >= MIN_MASKED_DIGITS ? "#" : run))
    .slice(0, MAX_QUERY_LENGTH);
}

export type SearchEventInput = {
  query: string;
  locale: string;
  results: number;
  relaxed: boolean;
  corrected: boolean;
  tookMs: number;
  source: "page" | "api";
};

let lastPrunedAt = 0;

/**
 * Records one search. Never throws: analytics must not break a search. A query
 * that masks down to nothing (only an email, only a number) is not recorded.
 */
export async function recordSearch(sql: postgres.Sql, input: SearchEventInput, { now = new Date(), onError }: { now?: Date; onError?: (error: unknown) => void } = {}) {
  const query = maskQuery(input.query);
  if (query === "" || query === "#") return;
  try {
    await sql`
      INSERT INTO search_events (id, query, locale, results, relaxed, corrected, took_ms, source, occurred_at)
      VALUES (${uuidv7()}, ${query}, ${input.locale}, ${Math.max(0, input.results)}, ${input.relaxed}, ${input.corrected},
              ${Math.max(0, Math.round(input.tookMs))}, ${input.source}, ${now.toISOString()}::timestamptz)
    `;
    // Pruned at most once an hour per server, as the outbox is.
    if (now.getTime() - lastPrunedAt > 60 * 60 * 1000) {
      lastPrunedAt = now.getTime();
      await pruneSearchEvents(sql, now);
    }
  } catch (error) {
    onError?.(error);
  }
}

export async function pruneSearchEvents(sql: postgres.Sql, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - SEARCH_EVENTS_KEEP_DAYS * 24 * 60 * 60 * 1000);
  const deleted = await sql`DELETE FROM search_events WHERE occurred_at < ${cutoff.toISOString()}::timestamptz`;
  return deleted.count;
}
