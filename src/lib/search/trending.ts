/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * "Trending now": what several people searched for lately, counted without knowing who they were.
 */

import type { KeyValue } from "@/lib/kv/types";

/**
 * docs/adr/039. Shown to every visitor, so the rules are strict.
 *
 * WHAT MAY BE SHOWN. A search becomes a candidate only if it found something,
 * and only in a plain shape: letters (any script), spaces, hyphens and
 * apostrophes, 2 to 40 characters, at most four words. An email address, a
 * phone or order number, a link — anything with digits or symbols — never
 * qualifies, so nothing typed by mistake can be put on show.
 *
 * COUNTING PEOPLE, NOT KEYSTROKES. Each hour has its own sorted set of terms.
 * A person adds one to a term at most once per hour: a gate key, a keyed hash
 * of who and what that lives one hour, decides whether this search counts. A
 * term needs at least three people over the last day to be shown at all, so
 * one person, however persistent, cannot put anything there.
 *
 * FRESH OVER BIG. A count from h hours ago weighs 0.5^(h / 6): half after six
 * hours, a sixteenth after a day. The score of a term is
 *
 *   score(term) = Σ over the last 24 hours h of  count_h(term) · 0.5^(h / 6)
 *
 * and the shelf shows the highest scores. Yesterday's big story fades by
 * morning; something many people start looking for rises within the hour.
 */

export const TRENDING_HALF_LIFE_HOURS = 6;
export const TRENDING_WINDOW_HOURS = 24;
export const TRENDING_MIN_PEOPLE = 3;

const HOUR_MS = 60 * 60 * 1000;
const SHAPE = /^[\p{L}][\p{L}\s'’-]{1,39}$/u;

/** The form a search is counted under, or null when it may never be shown. */
export function trendingTerm(query: string): string | null {
  const term = query.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
  if (!SHAPE.test(term)) return null;
  if (term.split(" ").length > 4) return null;
  return term;
}

export type HourCounts = { ageHours: number; counts: { member: string; score: number }[] };

/** The shelf from the hourly counts: decayed scores, at least `minPeople` over the window, best first. */
export function combineTrending(
  hours: readonly HourCounts[],
  { halfLifeHours = TRENDING_HALF_LIFE_HOURS, minPeople = TRENDING_MIN_PEOPLE, limit = 6 } = {},
): { term: string; score: number; people: number }[] {
  const totals = new Map<string, { score: number; people: number }>();
  for (const hour of hours) {
    const weight = 0.5 ** (hour.ageHours / halfLifeHours);
    for (const { member, score: count } of hour.counts) {
      const total = totals.get(member) ?? { score: 0, people: 0 };
      total.score += count * weight;
      total.people += count;
      totals.set(member, total);
    }
  }
  return [...totals.entries()]
    .filter(([, total]) => total.people >= minPeople)
    .map(([term, total]) => ({ term, score: Math.round(total.score * 1000) / 1000, people: total.people }))
    .sort((a, b) => b.score - a.score || a.term.localeCompare(b.term))
    .slice(0, limit);
}

const hourBucket = (now: number) => Math.floor(now / HOUR_MS);

/** Counts one person's search, at most once per term and hour. `who` must already be anonymous. */
export async function recordTrending(store: KeyValue, query: string, who: string, results: number, now = Date.now()): Promise<boolean> {
  if (results <= 0) return false;
  const term = trendingTerm(query);
  if (term === null) return false;
  const hour = hourBucket(now);
  const first = await store.setIfAbsent(`vt:trend:seen:${hour}:${who}:${term}`, "1", 60 * 60);
  if (!first) return false;
  await store.zincrby(`vt:trend:hour:${hour}`, term, 1, (TRENDING_WINDOW_HOURS + 2) * 60 * 60);
  return true;
}

export async function readTrending(store: KeyValue, now = Date.now(), limit = 6) {
  const current = hourBucket(now);
  const hours = await Promise.all(
    Array.from({ length: TRENDING_WINDOW_HOURS }, async (_, age) => ({ ageHours: age, counts: await store.ztop(`vt:trend:hour:${current - age}`, 100) })),
  );
  return combineTrending(hours, { limit });
}
