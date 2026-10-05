/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The Fit Engine's evidence in the database: a piece's reviewers' fit remarks and its kept and returned sizes, read into a belief about how it fits.
 */

import type postgres from "postgres";

import { RETURN_WINDOW_DAYS } from "@/lib/commerce/order-state";
import { describeItem, itemBelief, outcomeOf, typicalTolerance, type FitCut, type FitLean, type SizedOutcome } from "@/lib/fit/size/evidence";
import { SHOP_FIT_PARAMS } from "@/lib/fit/size/model";
import type { FitCounts, ItemBelief } from "@/lib/fit/size/ordinal";

type Sql = postgres.Sql;

/** What a size finder needs about a piece: the belief, and what it was learned from, in words and numbers. */
export type ProductFit = { item: ItemBelief; remarks: number; outcomes: number; lean: FitLean; cut: FitCut };

/** The garments the shop's size charts cover (src/lib/catalog/capsule.ts `sizeChartFor`). */
const CHARTED_KINDS = ["TOP", "SHIRT", "KNIT", "JACKET", "COAT", "TROUSERS", "SKIRT", "DRESS"];

/** The typical piece's tolerance changes only when the remarks are synced (each deploy), so it is worked out at most every ten minutes. */
const TYPICAL_FOR_MS = 10 * 60 * 1000;

export function createFitStore(sql: Sql, now: () => Date = () => new Date()) {
  let typical: { value: number; at: number } | null = null;

  async function typicalOfCatalogue(): Promise<number> {
    if (typical !== null && now().getTime() - typical.at < TYPICAL_FOR_MS) return typical.value;
    const rows = await sql<{ runs_small: number; true_to_size: number; runs_large: number }[]>`
      SELECT s.runs_small, s.true_to_size, s.runs_large FROM external_review_summaries s
      JOIN products p ON p.id = s.product_id
      WHERE p.status = 'active' AND p.kind = ANY(${CHARTED_KINDS}::text[])
    `;
    const value = typicalTolerance(
      SHOP_FIT_PARAMS,
      rows.map((row) => ({ small: row.runs_small, trueToSize: row.true_to_size, large: row.runs_large })),
    );
    typical = { value, at: now().getTime() };
    return value;
  }

  /**
   * The piece's sized lines from delivered orders, oldest first, with the
   * reason of the order's return if one was asked for. A size the piece no
   * longer has is left out (its place on the ladder is gone).
   */
  async function outcomesOf(productId: string, sizes: readonly string[]): Promise<SizedOutcome[]> {
    const rows = await sql<{ size: string; delivered_at: string | Date; return_reason: string | null }[]>`
      SELECT v.size, o.delivered_at,
        (SELECT e.reason FROM order_events e WHERE e.order_id = o.id AND e.event = 'request_return' ORDER BY e.created_at DESC LIMIT 1) AS return_reason
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      JOIN product_variants v ON v.id = oi.variant_id
      WHERE oi.product_id = ${productId} AND v.size IS NOT NULL AND o.delivered_at IS NOT NULL
      ORDER BY o.delivered_at, oi.id
    `;
    const windowMs = RETURN_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    const outcomes: SizedOutcome[] = [];
    for (const row of rows) {
      const sizeIndex = sizes.indexOf(row.size);
      if (sizeIndex < 0) continue;
      const deliveredAt = new Date(row.delivered_at);
      const outcome = outcomeOf({ returnReason: row.return_reason, deliveredAt, windowClosed: now().getTime() - deliveredAt.getTime() > windowMs });
      if (outcome !== null) outcomes.push({ sizeIndex, outcome });
    }
    return outcomes;
  }

  /** How the shop believes this piece fits, for sizes in this order. `stretch` is the fabric's elastane in percent. */
  async function forProduct(productId: string, sizes: readonly string[], stretch: number): Promise<ProductFit> {
    const [[summary], typicalTolerance, outcomes] = await Promise.all([
      sql<{ runs_small: number; true_to_size: number; runs_large: number }[]>`
        SELECT runs_small, true_to_size, runs_large FROM external_review_summaries WHERE product_id = ${productId}
      `,
      typicalOfCatalogue(),
      outcomesOf(productId, sizes),
    ]);
    const remarks: FitCounts | null = summary === undefined ? null : { small: summary.runs_small, trueToSize: summary.true_to_size, large: summary.runs_large };
    const item = itemBelief(SHOP_FIT_PARAMS, { remarks, typicalTolerance, stretch, outcomes });
    return {
      item,
      remarks: remarks === null ? 0 : remarks.small + remarks.trueToSize + remarks.large,
      outcomes: outcomes.length,
      ...describeItem(item),
    };
  }

  return { forProduct, outcomesOf };
}

export type FitStore = ReturnType<typeof createFitStore>;
