/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Verified reviews, the pure part: what a review may contain, how its author is shown, and a product's rating summary.
 */

import { z } from "zod";

/**
 * Reviews (docs/PLAN.md Phase 5 step 6, docs/adr/017). A review is written by
 * someone who received the piece; this module holds the rules that do not need
 * the database, so they can be tested exactly.
 */

export const REVIEW_TITLE_MAX = 120;
export const REVIEW_BODY_MIN = 20;
export const REVIEW_BODY_MAX = 2000;

/**
 * Review text is kept as plain text: control characters (other than line
 * breaks) are removed, runs of blank lines are shortened, and nothing is ever
 * interpreted as markup. It is also untrusted input for the Concierge
 * (CLAUDE.md conventions), which only ever sees it as quoted data.
 */
export function cleanReviewText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/(?!\n)[\p{Cc}\p{Cf}]/gu, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export const reviewInputSchema = z.object({
  rating: z.number().int().min(1).max(5),
  title: z
    .string()
    .max(REVIEW_TITLE_MAX * 2)
    .optional()
    .transform((value) => {
      const clean = cleanReviewText(value ?? "").replace(/\n/g, " ");
      return clean === "" ? null : clean.slice(0, REVIEW_TITLE_MAX);
    }),
  body: z
    .string()
    .max(REVIEW_BODY_MAX * 2)
    .transform(cleanReviewText)
    .pipe(z.string().min(REVIEW_BODY_MIN, "too_short").max(REVIEW_BODY_MAX, "too_long")),
});

export type ReviewInput = z.infer<typeof reviewInputSchema>;

/**
 * How the author appears: first name and the initial of the last, from the
 * delivery name — enough to feel like a person, not enough to find them.
 * "Eleni Papadopoulou" → "Eleni P."; one word stays as it is.
 */
export function authorDisplayName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter((part) => part !== "");
  if (parts.length === 0) return "";
  const first = parts[0]!;
  if (parts.length === 1) return first;
  const initial = [...parts[parts.length - 1]!][0]!.toLocaleUpperCase();
  return `${first} ${initial}.`;
}

export type RatingSummary = {
  count: number;
  /** Plain mean of the published ratings; 0 when there are none. What the product page shows. */
  average: number;
  /** How many reviews gave each number of stars, index 0 = one star. */
  distribution: [number, number, number, number, number];
};

/**
 * The summary shown with the reviews. The product page shows the plain mean,
 * as shoppers expect; ranking in search uses the Bayesian average instead
 * (src/lib/search/rerank.ts), so one five-star review cannot outrank two
 * hundred reviews averaging 4.6.
 */
export function summarizeRatings(counts: Partial<Record<1 | 2 | 3 | 4 | 5, number>>): RatingSummary {
  const distribution = [1, 2, 3, 4, 5].map((stars) => counts[stars as 1 | 2 | 3 | 4 | 5] ?? 0) as RatingSummary["distribution"];
  const count = distribution.reduce((sum, n) => sum + n, 0);
  const total = distribution.reduce((sum, n, index) => sum + n * (index + 1), 0);
  return { count, average: count === 0 ? 0 : total / count, distribution };
}
