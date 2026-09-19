/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Verified reviews in the database: writing one for a delivered order line, listing a product's, and moderation.
 */

import type postgres from "postgres";
import { uuidv7 } from "uuidv7";

import { diffFields, recordAudit } from "@/lib/admin/audit";
import { authorDisplayName, summarizeRatings, type RatingSummary, type ReviewInput } from "@/lib/commerce/reviews";

/**
 * Reviews (docs/adr/017). Each write keeps the product's `rating_sum` and
 * `rating_count` exact in the same transaction — adding a review, changing its
 * stars, hiding or restoring it — because search ranks by them (the Bayesian
 * average in src/lib/search/rerank.ts) and the product page shows them.
 * `recount` rebuilds them from the reviews, and the tests check it agrees.
 */

type Sql = postgres.Sql;

export type ReviewStatus = "published" | "hidden";

export type SaveReviewResult =
  | { ok: true; reviewId: string; created: boolean }
  | { ok: false; reason: "not_found" | "not_delivered" | "product_gone" };

export type PublicReview = {
  id: string;
  rating: number;
  title: string | null;
  body: string;
  authorName: string;
  locale: string;
  createdAt: Date;
  edited: boolean;
};

export type OwnReview = { orderItemId: string; rating: number; title: string | null; body: string; status: ReviewStatus };

export type DeskReview = {
  id: string;
  status: ReviewStatus;
  rating: number;
  title: string | null;
  body: string;
  authorName: string;
  createdAt: Date;
  productTitle: string;
  productSlug: string;
  orderNumber: string;
  moderationReason: string | null;
};

export function createReviewStore(sql: Sql) {
  /** The reviews already written for an order's lines, for its order page. */
  async function orderReviews(orderId: string): Promise<Map<string, OwnReview>> {
    const rows = await sql<{ order_item_id: string; rating: number; title: string | null; body: string; status: ReviewStatus }[]>`
      SELECT r.order_item_id, r.rating, r.title, r.body, r.status
      FROM reviews r JOIN order_items i ON i.id = r.order_item_id
      WHERE i.order_id = ${orderId}
    `;
    return new Map(rows.map((row) => [row.order_item_id, { orderItemId: row.order_item_id, rating: row.rating, title: row.title, body: row.body, status: row.status }]));
  }

  /**
   * Writes or rewrites the review of one order line. Allowed only once the
   * order was delivered (it may since have been returned: the person still had
   * the piece). The caller has already checked the person may see the order.
   */
  async function saveReview({
    orderId,
    orderItemId,
    input,
    userId,
    locale,
    now = new Date(),
  }: {
    orderId: string;
    orderItemId: string;
    input: ReviewInput;
    userId: string | null;
    locale: string;
    /** When it was written; demo orders set it in the past. */
    now?: Date;
  }): Promise<SaveReviewResult> {
    const at = now.toISOString();
    return sql.begin(async (tx) => {
      const [line] = await tx<{ product_id: string | null; delivered_at: Date | null; name: string | null }[]>`
        SELECT i.product_id, o.delivered_at, o.shipping_address->>'name' AS name
        FROM order_items i JOIN orders o ON o.id = i.order_id
        WHERE i.id = ${orderItemId} AND i.order_id = ${orderId}
        FOR UPDATE OF i
      `;
      if (line === undefined) return { ok: false, reason: "not_found" } as const;
      if (line.delivered_at === null) return { ok: false, reason: "not_delivered" } as const;
      if (line.product_id === null) return { ok: false, reason: "product_gone" } as const;

      const [existing] = await tx<{ id: string; rating: number; status: ReviewStatus }[]>`
        SELECT id, rating, status FROM reviews WHERE order_item_id = ${orderItemId} FOR UPDATE
      `;
      if (existing !== undefined) {
        await tx`
          UPDATE reviews SET rating = ${input.rating}, title = ${input.title}, body = ${input.body}, locale = ${locale},
                 user_id = COALESCE(user_id, ${userId}), updated_at = ${at}::timestamptz
          WHERE id = ${existing.id}
        `;
        if (existing.status === "published" && existing.rating !== input.rating) {
          await tx`UPDATE products SET rating_sum = rating_sum + ${input.rating - existing.rating} WHERE id = ${line.product_id}`;
        }
        return { ok: true, reviewId: existing.id, created: false } as const;
      }

      const reviewId = uuidv7();
      await tx`
        INSERT INTO reviews (id, product_id, order_item_id, user_id, rating, title, body, author_name, locale, created_at, updated_at)
        VALUES (${reviewId}, ${line.product_id}, ${orderItemId}, ${userId}, ${input.rating}, ${input.title}, ${input.body},
                ${authorDisplayName(line.name ?? "") || "—"}, ${locale}, ${at}::timestamptz, ${at}::timestamptz)
      `;
      await tx`UPDATE products SET rating_sum = rating_sum + ${input.rating}, rating_count = rating_count + 1 WHERE id = ${line.product_id}`;
      return { ok: true, reviewId, created: true } as const;
    });
  }

  /** A product's published reviews, newest first, with the summary of all of them. */
  async function productReviews(productId: string, { limit = 20 } = {}): Promise<{ summary: RatingSummary; reviews: PublicReview[] }> {
    const counts = await sql<{ rating: 1 | 2 | 3 | 4 | 5; count: number }[]>`
      SELECT rating, count(*)::int AS count FROM reviews WHERE product_id = ${productId} AND status = 'published' GROUP BY rating
    `;
    const rows = await sql<{ id: string; rating: number; title: string | null; body: string; author_name: string; locale: string; created_at: Date; updated_at: Date }[]>`
      SELECT id, rating, title, body, author_name, locale, created_at, updated_at
      FROM reviews WHERE product_id = ${productId} AND status = 'published'
      ORDER BY created_at DESC, id DESC LIMIT ${limit}
    `;
    return {
      summary: summarizeRatings(Object.fromEntries(counts.map((row) => [row.rating, row.count]))),
      reviews: rows.map((row) => ({
        id: row.id,
        rating: row.rating,
        title: row.title,
        body: row.body,
        authorName: row.author_name,
        locale: row.locale,
        createdAt: new Date(row.created_at),
        // Edited after the first minute: saying so keeps a changed review honest.
        edited: new Date(row.updated_at).getTime() - new Date(row.created_at).getTime() > 60_000,
      })),
    };
  }

  /** Hides or restores a review, keeping the product's totals exact; audited (docs/adr/018). */
  async function moderate(reviewId: string, { status, reason, actor }: { status: ReviewStatus; reason: string | null; actor: { userId: string; email: string } }) {
    return sql.begin(async (tx) => {
      const [review] = await tx<{ product_id: string; rating: number; status: ReviewStatus; moderation_reason: string | null }[]>`
        SELECT product_id, rating, status, moderation_reason FROM reviews WHERE id = ${reviewId} FOR UPDATE
      `;
      if (review === undefined) return { ok: false, reason: "not_found" } as const;
      if (review.status !== status) {
        const sign = status === "published" ? 1 : -1;
        await tx`
          UPDATE products SET rating_sum = rating_sum + ${sign * review.rating}, rating_count = rating_count + ${sign}
          WHERE id = ${review.product_id}
        `;
      }
      await tx`
        UPDATE reviews SET status = ${status}, moderation_reason = ${reason}, moderated_by = ${actor.userId}, moderated_at = now(), updated_at = updated_at
        WHERE id = ${reviewId}
      `;
      const changes = diffFields({ status: review.status, moderationReason: review.moderation_reason }, { status, moderationReason: reason });
      if (Object.keys(changes).length > 0) {
        await recordAudit(tx, { actor, action: status === "hidden" ? "review.hide" : "review.restore", entityType: "review", entityId: reviewId, changes, reason });
      }
      return { ok: true, productId: review.product_id } as const;
    });
  }

  /** The newest reviews for staff, optionally only published or only hidden ones. */
  async function deskReviews({ status = null, limit = 100 }: { status?: ReviewStatus | null; limit?: number } = {}): Promise<DeskReview[]> {
    const filter = status === null ? sql`TRUE` : sql`r.status = ${status}`;
    const rows = await sql<{
      id: string;
      status: ReviewStatus;
      rating: number;
      title: string | null;
      body: string;
      author_name: string;
      created_at: Date;
      title_en: string;
      slug: string;
      number: string;
      moderation_reason: string | null;
    }[]>`
      SELECT r.id, r.status, r.rating, r.title, r.body, r.author_name, r.created_at, p.title_en, p.slug, o.number, r.moderation_reason
      FROM reviews r
      JOIN products p ON p.id = r.product_id
      JOIN order_items i ON i.id = r.order_item_id
      JOIN orders o ON o.id = i.order_id
      WHERE ${filter}
      ORDER BY r.created_at DESC, r.id DESC LIMIT ${limit}
    `;
    return rows.map((row) => ({
      id: row.id,
      status: row.status,
      rating: row.rating,
      title: row.title,
      body: row.body,
      authorName: row.author_name,
      createdAt: new Date(row.created_at),
      productTitle: row.title_en,
      productSlug: row.slug,
      orderNumber: row.number,
      moderationReason: row.moderation_reason,
    }));
  }

  /** Rebuilds a product's rating totals from its published reviews; returns them. */
  async function recount(productId: string): Promise<{ ratingSum: number; ratingCount: number }> {
    const [row] = await sql<{ rating_sum: number; rating_count: number }[]>`
      UPDATE products SET
        rating_sum = COALESCE((SELECT sum(rating) FROM reviews WHERE product_id = ${productId} AND status = 'published'), 0),
        rating_count = (SELECT count(*) FROM reviews WHERE product_id = ${productId} AND status = 'published')
      WHERE id = ${productId}
      RETURNING rating_sum, rating_count
    `;
    return { ratingSum: row?.rating_sum ?? 0, ratingCount: row?.rating_count ?? 0 };
  }

  return { orderReviews, saveReview, productReviews, moderate, deskReviews, recount };
}

export type ReviewStore = ReturnType<typeof createReviewStore>;
