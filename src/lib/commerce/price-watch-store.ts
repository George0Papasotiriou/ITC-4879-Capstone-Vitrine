/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Price watches in the database: setting one, listing a person's, and finding the ones a price drop has answered.
 */

import type postgres from "postgres";
import { uuidv7 } from "uuidv7";

import { MAX_WATCHES, watchDecisions, type WatchState } from "@/lib/commerce/price-watch";

/**
 * The store behind the watches (docs/adr/020). One watch per person and
 * product — asking twice moves the target rather than adding a row — and a
 * cap per person, so the nightly pass stays small.
 *
 * The nightly pass reads every watch with its product's price, decides in
 * price-watch.ts, and marks what it sent. Marking is what makes it safe to
 * run twice: a watch already emailed is not emailed again until the price
 * goes back above the target.
 */

type Sql = postgres.Sql;

export type SetWatchResult = { ok: true; watchId: string; created: boolean } | { ok: false; reason: "not_found" | "not_below_price" | "too_many" };

export type PersonWatch = {
  id: string;
  productId: string;
  targetCents: number;
  priceCents: number;
  notifiedAt: Date | null;
  createdAt: Date;
};

/** A watch the price has answered, with everything the email needs. */
export type DueWatch = {
  id: string;
  email: string;
  name: string;
  locale: string;
  productId: string;
  slug: string;
  title: string;
  targetCents: number;
  priceCents: number;
};

export function createPriceWatchStore(sql: Sql) {
  /** Sets or moves the target. The price is read here, so a stale page cannot set a target above it. */
  async function set({ userId, productId, targetCents, locale }: { userId: string; productId: string; targetCents: number; locale: string }): Promise<SetWatchResult> {
    return sql.begin(async (tx) => {
      const [product] = await tx<{ price_cents: number }[]>`SELECT price_cents FROM products WHERE id = ${productId} AND status = 'active' LIMIT 1`;
      if (product === undefined) return { ok: false, reason: "not_found" } as const;
      if (targetCents >= product.price_cents) return { ok: false, reason: "not_below_price" } as const;

      const [existing] = await tx<{ id: string }[]>`SELECT id FROM price_watches WHERE user_id = ${userId} AND product_id = ${productId} LIMIT 1`;
      if (existing === undefined) {
        const [counted] = await tx<{ count: number }[]>`SELECT count(*)::int AS count FROM price_watches WHERE user_id = ${userId}`;
        if ((counted?.count ?? 0) >= MAX_WATCHES) return { ok: false, reason: "too_many" } as const;
      }

      const id = existing?.id ?? uuidv7();
      await tx`
        INSERT INTO price_watches (id, user_id, product_id, target_cents, locale, notified_at, created_at, updated_at)
        VALUES (${id}, ${userId}, ${productId}, ${targetCents}, ${locale}, NULL, now(), now())
        ON CONFLICT (user_id, product_id)
        DO UPDATE SET target_cents = EXCLUDED.target_cents, locale = EXCLUDED.locale, notified_at = NULL, updated_at = now()
      `;
      return { ok: true, watchId: id, created: existing === undefined } as const;
    });
  }

  /** Removes a watch by its product, the way the product page and the Concierge ask for it. */
  async function remove({ userId, productId }: { userId: string; productId: string }): Promise<boolean> {
    const rows = await sql<{ id: string }[]>`DELETE FROM price_watches WHERE user_id = ${userId} AND product_id = ${productId} RETURNING id`;
    return rows.length > 0;
  }

  /** The watch on one product, for the form's starting state. */
  async function forProduct({ userId, productId }: { userId: string; productId: string }): Promise<PersonWatch | null> {
    const [row] = await rowsFor(sql`w.user_id = ${userId} AND w.product_id = ${productId}`, 1);
    return row ?? null;
  }

  /** Everything this person is waiting for, newest first. */
  async function forPerson(userId: string): Promise<PersonWatch[]> {
    return rowsFor(sql`w.user_id = ${userId}`, MAX_WATCHES);
  }

  async function rowsFor(where: postgres.PendingQuery<postgres.Row[]>, limit: number): Promise<PersonWatch[]> {
    const rows = await sql<{ id: string; product_id: string; target_cents: number; price_cents: number; notified_at: Date | null; created_at: Date }[]>`
      SELECT w.id, w.product_id, w.target_cents, p.price_cents, w.notified_at, w.created_at
      FROM price_watches w JOIN products p ON p.id = w.product_id
      WHERE ${where}
      ORDER BY w.created_at DESC
      LIMIT ${limit}
    `;
    return rows.map((row) => ({
      id: row.id,
      productId: row.product_id,
      targetCents: row.target_cents,
      priceCents: row.price_cents,
      notifiedAt: row.notified_at === null ? null : new Date(row.notified_at),
      createdAt: new Date(row.created_at),
    }));
  }

  /**
   * One pass: the watches to email and the ones to arm again. The decision
   * itself is in price-watch.ts; this only reads and writes.
   */
  async function pass(): Promise<{ due: DueWatch[]; rearmed: number }> {
    const rows = await sql<{
      id: string;
      email: string;
      name: string | null;
      locale: string;
      product_id: string;
      slug: string;
      title_en: string;
      title_el: string | null;
      status: string;
      stock: number;
      target_cents: number;
      price_cents: number;
      notified_at: Date | null;
    }[]>`
      SELECT w.id, u.email, u.name, w.locale, p.id AS product_id, p.slug, p.title_en, p.title_el, p.status, w.target_cents, p.price_cents, w.notified_at,
             COALESCE((SELECT sum(v.stock)::int FROM product_variants v WHERE v.product_id = p.id), 0) AS stock
      FROM price_watches w
      JOIN users u ON u.id = w.user_id
      JOIN products p ON p.id = w.product_id
      ORDER BY w.created_at
    `;

    const states: WatchState[] = rows.map((row) => ({
      id: row.id,
      targetCents: row.target_cents,
      priceCents: row.price_cents,
      available: row.status === "active" && row.stock > 0,
      notifiedAt: row.notified_at === null ? null : new Date(row.notified_at),
    }));
    const { notify, reset } = watchDecisions(states);

    if (reset.length > 0) await sql`UPDATE price_watches SET notified_at = NULL, updated_at = now() WHERE id = ANY(${[...reset]}::uuid[])`;

    const byId = new Map(rows.map((row) => [row.id, row]));
    const due = notify.map((id) => {
      const row = byId.get(id)!;
      return {
        id: row.id,
        email: row.email,
        name: row.name ?? row.email.split("@")[0]!,
        locale: row.locale,
        productId: row.product_id,
        slug: row.slug,
        title: row.locale === "el" ? (row.title_el ?? row.title_en) : row.title_en,
        targetCents: row.target_cents,
        priceCents: row.price_cents,
      };
    });
    return { due, rearmed: reset.length };
  }

  /** Marks the watches whose email was written, so tomorrow's pass leaves them alone. */
  async function markNotified(ids: readonly string[], at = new Date()): Promise<void> {
    if (ids.length === 0) return;
    await sql`UPDATE price_watches SET notified_at = ${at.toISOString()}::timestamptz, updated_at = now() WHERE id = ANY(${[...ids]}::uuid[])`;
  }

  return { set, remove, forProduct, forPerson, pass, markNotified };
}

export type PriceWatchStore = ReturnType<typeof createPriceWatchStore>;
