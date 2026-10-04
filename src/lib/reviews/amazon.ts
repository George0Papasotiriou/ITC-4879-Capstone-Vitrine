/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Real Amazon.com reviews of the ABO wearables: their shape, their source, and what they say about fit.
 */

import { z } from "zod";

/**
 * docs/adr/061 (George, 2026-10-04: "Real Amazon reviews, labelled").
 *
 * The ABO wearables are real Amazon products, and Amazon Reviews 2023 holds
 * the reviews Amazon.com customers wrote of those very products (same ASIN).
 * The shop shows a few of them, and the totals, in their own block on the
 * product page — labelled with where they come from, apart from Vitrine's own
 * reviews, which only buyers of the shop write (docs/adr/017).
 *
 * They are never mixed into the shop's own rating: not the stars on a tile,
 * not search's Bayesian ranking (docs/adr/009), not the page's structured
 * data. Nothing about the reviewer is kept — no id, no name, no photograph.
 *
 * What they say about fit is counted over every review of the piece ("runs
 * small", "true to size", "runs large"), and is one of the Fit Engine's
 * signals for how a brand's sizes run (docs/adr/061, slice W3).
 */

export const AMAZON_REVIEWS_CITATION =
  "Reviews by Amazon.com customers, from Amazon Reviews 2023 (Y. Hou, J. Li, Z. He, A. Yan, X. Chen, J. McAuley, McAuley Lab, UC San Diego), a public research dataset; shown for the same product on Amazon.com.";

export const amazonReviewSchema = z.object({
  rating: z.number().min(1).max(5),
  title: z.string().max(140),
  text: z.string().min(1).max(1300),
  /** The review's date, YYYY-MM-DD. */
  at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  helpful: z.number().int().nonnegative(),
  verified: z.boolean(),
});
export type AmazonReview = z.infer<typeof amazonReviewSchema>;

export const amazonProductReviewsSchema = z.object({
  /** Every review of the piece in the dataset, not only those shown. */
  count: z.number().int().positive(),
  ratingSum: z.number().nonnegative(),
  /** Reviews that say it runs small, true to size, or large. */
  small: z.number().int().nonnegative(),
  trueToSize: z.number().int().nonnegative(),
  large: z.number().int().nonnegative(),
  /** The most helpful few, as shown. */
  reviews: z.array(amazonReviewSchema).max(12),
});
export type AmazonProductReviews = z.infer<typeof amazonProductReviewsSchema>;

export const amazonReviewsFixtureSchema = z.object({
  version: z.literal(1),
  citation: z.string(),
  /** Keyed by the ABO item id (the ASIN). */
  products: z.record(z.string().regex(/^[A-Z0-9]{10}$/), amazonProductReviewsSchema),
});

/** The mean rating to one decimal, as shown. */
export const meanRating = (entry: Pick<AmazonProductReviews, "count" | "ratingSum">) => Math.round((entry.ratingSum / entry.count) * 10) / 10;

export type FitLean = "small" | "true" | "large" | "unknown";

/**
 * Which way a piece runs, from what its reviewers say about fit: the side
 * that clearly outweighs the others, among reviews that say anything at all.
 * "Clearly" is a share of at least 0.5 of the fit remarks and at least five
 * of them, so a single grumble does not label a shoe.
 */
export function fitLean(entry: Pick<AmazonProductReviews, "small" | "trueToSize" | "large">): { lean: FitLean; share: number; remarks: number } {
  const remarks = entry.small + entry.trueToSize + entry.large;
  if (remarks < 5) return { lean: "unknown", share: 0, remarks };
  const sides: [FitLean, number][] = [
    ["small", entry.small],
    ["true", entry.trueToSize],
    ["large", entry.large],
  ];
  const [lean, count] = sides.sort((a, b) => b[1] - a[1])[0]!;
  const share = count / remarks;
  return share >= 0.5 ? { lean, share, remarks } : { lean: "unknown", share, remarks };
}
