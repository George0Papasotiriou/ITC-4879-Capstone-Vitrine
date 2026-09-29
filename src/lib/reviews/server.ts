/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Review intelligence for a product, from its published reviews.
 */

import { reviewsStore } from "@/lib/commerce/server";
import { reviewInsights, type ReviewInsights } from "@/lib/reviews/insights";

/** Every published review counts, not only the page's first ten; a hidden one is simply not read (docs/adr/041). */
const READ_AT_MOST = 200;

export async function productInsights(productId: string): Promise<ReviewInsights> {
  const { reviews } = await (await reviewsStore()).productReviews(productId, { limit: READ_AT_MOST });
  return reviewInsights(reviews);
}
