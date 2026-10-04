/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Reviews written elsewhere of the same product, in the database: synced from the fixture, shown apart, hidden by staff.
 */

import { createHash } from "node:crypto";

import type postgres from "postgres";
import { uuidv7 } from "uuidv7";

import { recordAudit, type AuditActor } from "@/lib/admin/audit";
import type { AmazonProductReviews } from "@/lib/reviews/amazon";

type Sql = postgres.Sql;

/** The only outside source so far (docs/adr/061). */
export const AMAZON_SOURCE = "amazon_reviews_2023";

export type ExternalReview = { id: string; rating: number; title: string | null; body: string; reviewedOn: string; helpful: number; verified: boolean; hidden: boolean };
export type DeskExternalReview = { id: string; rating: number; title: string | null; body: string; reviewedOn: string; hidden: boolean; hiddenReason: string | null; productSlug: string; productTitle: string };
export type ExternalSummary = { source: string; count: number; ratingSum: number; runsSmall: number; trueToSize: number; runsLarge: number };

/** A review's identity: the same review gets the same id on every sync, so staff decisions about it last. */
export function externalReviewId(sourceId: string, review: { at: string; title: string; text: string }): string {
  return createHash("sha1").update(`${sourceId}|${review.at}|${review.title}|${review.text.slice(0, 400)}`).digest("hex").slice(0, 20);
}

export function createExternalReviewStore(sql: Sql) {
  /**
   * Writes the fixture into the database for the products the shop has, by
   * their ABO id: totals replaced, reviews added or refreshed in place (a
   * hidden one stays hidden), and those no longer in the fixture removed.
   * Returns how many products and reviews were written.
   */
  async function syncAmazon(products: Readonly<Record<string, AmazonProductReviews>>): Promise<{ products: number; reviews: number }> {
    const sourceIds = Object.keys(products);
    if (sourceIds.length === 0) return { products: 0, reviews: 0 };
    const rows = await sql<{ id: string; source_id: string }[]>`SELECT id, source_id FROM products WHERE source = 'abo' AND source_id = ANY(${sourceIds}::text[])`;
    let reviews = 0;
    for (const row of rows) {
      const entry = products[row.source_id]!;
      await sql`
        INSERT INTO external_review_summaries (product_id, source, count, rating_sum, runs_small, true_to_size, runs_large)
        VALUES (${row.id}, ${AMAZON_SOURCE}, ${entry.count}, ${Math.round(entry.ratingSum)}, ${entry.small}, ${entry.trueToSize}, ${entry.large})
        ON CONFLICT (product_id) DO UPDATE SET source = excluded.source, count = excluded.count, rating_sum = excluded.rating_sum,
          runs_small = excluded.runs_small, true_to_size = excluded.true_to_size, runs_large = excluded.runs_large, updated_at = now()
      `;
      const kept: string[] = [];
      for (const [position, review] of entry.reviews.entries()) {
        const externalId = externalReviewId(row.source_id, review);
        kept.push(externalId);
        await sql`
          INSERT INTO external_reviews (id, product_id, source, external_id, position, rating, title, body, reviewed_on, helpful, verified)
          VALUES (${uuidv7()}, ${row.id}, ${AMAZON_SOURCE}, ${externalId}, ${position}, ${Math.round(review.rating)}, ${review.title === "" ? null : review.title},
                  ${review.text}, ${review.at}, ${review.helpful}, ${review.verified})
          ON CONFLICT (product_id, source, external_id) DO UPDATE SET position = excluded.position, rating = excluded.rating, title = excluded.title,
            body = excluded.body, reviewed_on = excluded.reviewed_on, helpful = excluded.helpful, verified = excluded.verified, updated_at = now()
        `;
        reviews += 1;
      }
      await sql`DELETE FROM external_reviews WHERE product_id = ${row.id} AND source = ${AMAZON_SOURCE} AND NOT (external_id = ANY(${kept}::text[]))`;
    }
    // A product the fixture no longer holds keeps no reviews from it.
    const synced = rows.map((row) => row.id);
    await sql`DELETE FROM external_reviews WHERE source = ${AMAZON_SOURCE} AND NOT (product_id = ANY(${synced}::uuid[]))`;
    await sql`DELETE FROM external_review_summaries WHERE source = ${AMAZON_SOURCE} AND NOT (product_id = ANY(${synced}::uuid[]))`;
    return { products: rows.length, reviews };
  }

  /** What a product page shows: the totals, and the reviews staff have not hidden, the most helpful first. */
  async function forProduct(productId: string): Promise<{ summary: ExternalSummary; reviews: ExternalReview[] } | null> {
    const [summary] = await sql<{ source: string; count: number; rating_sum: number; runs_small: number; true_to_size: number; runs_large: number }[]>`
      SELECT source, count, rating_sum, runs_small, true_to_size, runs_large FROM external_review_summaries WHERE product_id = ${productId}
    `;
    if (summary === undefined) return null;
    const rows = await sql<{ id: string; rating: number; title: string | null; body: string; reviewed_on: string | Date; helpful: number; verified: boolean }[]>`
      SELECT id, rating, title, body, reviewed_on, helpful, verified FROM external_reviews
      WHERE product_id = ${productId} AND hidden_at IS NULL ORDER BY position
    `;
    return {
      summary: { source: summary.source, count: summary.count, ratingSum: summary.rating_sum, runsSmall: summary.runs_small, trueToSize: summary.true_to_size, runsLarge: summary.runs_large },
      reviews: rows.map((row) => ({
        id: row.id,
        rating: row.rating,
        title: row.title,
        body: row.body,
        reviewedOn: typeof row.reviewed_on === "string" ? row.reviewed_on.slice(0, 10) : row.reviewed_on.toISOString().slice(0, 10),
        helpful: row.helpful,
        verified: row.verified,
        hidden: false,
      })),
    };
  }

  /**
   * Hides one (with the reason staff give) or shows it again, and writes the
   * audit log in the same transaction, as the shop's own reviews are
   * moderated (docs/adr/017). False when there is no such review.
   */
  async function setHidden(id: string, change: { hidden: boolean; reason: string | null; actor: AuditActor }): Promise<boolean> {
    return sql.begin(async (tx) => {
      const [before] = await tx<{ hidden_at: Date | string | null; hidden_reason: string | null }[]>`SELECT hidden_at, hidden_reason FROM external_reviews WHERE id = ${id} FOR UPDATE`;
      if (before === undefined) return false;
      await tx`
        UPDATE external_reviews SET hidden_at = ${change.hidden ? new Date().toISOString() : null}::timestamptz, hidden_by = ${change.hidden ? (change.actor?.userId ?? null) : null},
          hidden_reason = ${change.hidden ? change.reason : null}, updated_at = now()
        WHERE id = ${id}
      `;
      await recordAudit(tx, {
        actor: change.actor,
        action: change.hidden ? "review.hide" : "review.restore",
        entityType: "review",
        entityId: id,
        changes: { status: { before: before.hidden_at === null ? "published" : "hidden", after: change.hidden ? "hidden" : "published" }, source: { before: AMAZON_SOURCE, after: AMAZON_SOURCE } },
        reason: change.reason,
      });
      return true;
    });
  }

  /**
   * The staff desk's list: newest review first, with its product, shown or
   * hidden as asked. `product` narrows it to pieces whose title contains those
   * words, or whose slug is exactly it, so staff can reach any piece's
   * reviews, not only the newest hundred.
   */
  async function deskList(options: { hidden: boolean | null; limit?: number; product?: string | null }): Promise<DeskExternalReview[]> {
    const product = options.product?.trim() ?? "";
    // ILIKE's own wildcards and its escape character, taken literally.
    const pattern = `%${product.replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
    const rows = await sql<{ id: string; rating: number; title: string | null; body: string; reviewed_on: string | Date; hidden_at: Date | string | null; hidden_reason: string | null; slug: string; title_en: string }[]>`
      SELECT r.id, r.rating, r.title, r.body, r.reviewed_on, r.hidden_at, r.hidden_reason, p.slug, p.title_en
      FROM external_reviews r JOIN products p ON p.id = r.product_id
      WHERE ${options.hidden === null ? sql`true` : options.hidden ? sql`r.hidden_at IS NOT NULL` : sql`r.hidden_at IS NULL`}
        AND ${product === "" ? sql`true` : sql`(p.title_en ILIKE ${pattern} OR p.slug = ${product})`}
      ORDER BY r.reviewed_on DESC, r.id LIMIT ${options.limit ?? 100}
    `;
    return rows.map((row) => ({
      id: row.id,
      rating: row.rating,
      title: row.title,
      body: row.body,
      reviewedOn: typeof row.reviewed_on === "string" ? row.reviewed_on.slice(0, 10) : row.reviewed_on.toISOString().slice(0, 10),
      hidden: row.hidden_at !== null,
      hiddenReason: row.hidden_reason,
      productSlug: row.slug,
      productTitle: row.title_en,
    }));
  }

  return { syncAmazon, forProduct, setHidden, deskList };
}

export type ExternalReviewStore = ReturnType<typeof createExternalReviewStore>;
