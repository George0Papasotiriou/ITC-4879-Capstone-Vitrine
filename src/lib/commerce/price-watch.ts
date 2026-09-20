/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Price watches: what a valid target is, and which watches a price change should email about.
 */

import { parseEuros } from "@/lib/admin/catalog";

/**
 * A price watch is a standing question: "tell me when this falls to X"
 * (docs/adr/020). The rules live here, away from the database and the
 * request, so they can be read and tested on their own.
 *
 * The prices compared are the ones on the product page: the shop shows one
 * price everywhere and states the VAT of the shopper's country beside it
 * (ADR-013), so a watch means the same thing in every country.
 */

/** Enough for a wish list, few enough that the nightly pass stays small and nobody can fill the table. */
export const MAX_WATCHES = 20;

/** Below a euro is never a real target; it is a typo or a joke. */
export const MIN_TARGET_CENTS = 100;

export type TargetProblem = "invalid" | "too_low" | "not_below_price";
export type TargetResult = { ok: true; cents: number } | { ok: false; problem: TargetProblem };

/** The target as typed ("399", "399,50", "€399.50") in cents, or why it is not a target. */
export function parseTargetCents(text: string, priceCents: number): TargetResult {
  const cents = parseEuros(text);
  if (cents === null) return { ok: false, problem: "invalid" };
  if (cents < MIN_TARGET_CENTS) return { ok: false, problem: "too_low" };
  // A target at or above today's price would fire at once and mean nothing.
  if (cents >= priceCents) return { ok: false, problem: "not_below_price" };
  return { ok: true, cents };
}

/** What the form starts with: a tenth below the current price, at a whole euro. */
export function suggestedTargetCents(priceCents: number): number {
  const suggestion = Math.floor((priceCents * 0.9) / 100) * 100;
  return Math.max(MIN_TARGET_CENTS, Math.min(suggestion, priceCents - 100));
}

export type WatchState = {
  id: string;
  targetCents: number;
  priceCents: number;
  /** A watch on a product that is no longer for sale waits rather than emails. */
  available: boolean;
  notifiedAt: Date | null;
};

/**
 * One pass over the watches: who to email, and whose turn comes round again.
 *
 * A watch emails once. It is armed again only when the price goes back above
 * the target, so a long sale cannot send the same message every night.
 */
export function watchDecisions(rows: readonly WatchState[]): { notify: string[]; reset: string[] } {
  const notify: string[] = [];
  const reset: string[] = [];
  for (const row of rows) {
    const reached = row.priceCents <= row.targetCents;
    if (reached && row.available && row.notifiedAt === null) notify.push(row.id);
    if (!reached && row.notifiedAt !== null) reset.push(row.id);
  }
  return { notify, reset };
}
