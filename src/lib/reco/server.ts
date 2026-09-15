/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Taste Graph access and consent cookies for pages and route handlers.
 */

import { cookies } from "next/headers";
import { connection } from "next/server";

import { sql } from "@/lib/db/client";
import { createTasteGraph, type TasteGraph } from "@/lib/reco/store";

/**
 * The Taste Graph for pages and route handlers.
 *
 * Personalisation is opt-in (docs/PLAN.md 2.8). The anonymous shopper id lives
 * in an httpOnly cookie that exists only after the shopper turns
 * personalisation on; without it nothing is recorded and nothing personal is
 * shown. A readable companion cookie tells the browser whether to send events.
 */

export const ACTOR_COOKIE = "vt_aid";
export const CONSENT_COOKIE = "vt_personalize";

let graph: TasteGraph | undefined;
export const tasteGraph = () => (graph ??= createTasteGraph(sql));

/** The consenting shopper's anonymous id, or null. */
export async function currentActor(): Promise<string | null> {
  const value = (await cookies()).get(ACTOR_COOKIE)?.value;
  return value !== undefined && /^[0-9a-f-]{36}$/.test(value) ? value : null;
}

export async function recommendationsForCurrentShopper(limit = 8) {
  await connection();
  const actor = await currentActor();
  if (actor === null) return { personalised: false as const, items: [] };
  return { personalised: true as const, items: await tasteGraph().forActor(actor, { limit }) };
}

export async function pairsWith(productId: string, limit = 4) {
  await connection();
  return tasteGraph().pairsWith(productId, limit);
}

type PoolRow = {
  id: string;
  kind: string;
  category: string;
  brand: string | null;
  colors: string[];
  materials: string[];
  attributes: Record<string, string>;
  price_cents: number;
};

/**
 * The products This-or-That compares: up to 40, in stock, with a photograph,
 * taken in turn from each category so the pairs span the collection. Their
 * content vectors use the similarity weighting, the same space
 * recommendations are scored in.
 */
export async function tastePool(limit = 40) {
  await connection();
  const [{ contentVector, SIMILARITY_WEIGHTS }] = await Promise.all([import("@/lib/reco/content-vector")]);
  const rows = await sql<(PoolRow & { position: number })[]>`
    SELECT * FROM (
      SELECT p.id, p.kind, c.slug AS category, b.name AS brand, p.colors, p.materials, p.attributes, p.price_cents,
             row_number() OVER (PARTITION BY c.slug ORDER BY p.popularity DESC, p.source_id) AS position
      FROM products p
      JOIN categories c ON c.id = p.category_id
      LEFT JOIN brands b ON b.id = p.brand_id
      WHERE p.status = 'active'
        AND EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id AND v.stock > 0)
        AND EXISTS (SELECT 1 FROM product_media m WHERE m.product_id = p.id AND m.kind = 'image')
    ) ranked
    ORDER BY position, category
    LIMIT ${limit}
  `;
  return rows.map((row) => ({
    id: row.id,
    vector: contentVector(
      { category: row.category, kind: row.kind, brand: row.brand, colors: row.colors, materials: row.materials, attributes: row.attributes, priceCents: row.price_cents },
      SIMILARITY_WEIGHTS,
    ),
  }));
}
