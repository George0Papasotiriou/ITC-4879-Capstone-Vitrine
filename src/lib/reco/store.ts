/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Taste Graph database store: rebuild, record events and recommend.
 */

import type postgres from "postgres";
import { uuidv7 } from "uuidv7";

import { contentVector, dot, SIMILARITY_WEIGHTS, type ProductFeatures } from "@/lib/reco/content-vector";
import { behaviourEdges, blend, contentEdges, type InteractionEvent, type InteractionKind, type Neighbours } from "@/lib/reco/graph";
import { recommend, type Recommendation } from "@/lib/reco/recommend";
import { seedVector } from "@/lib/reco/walk";

/**
 * The Taste Graph in the database (A2, Phase 8 steps 1, 3 and 5).
 *
 *   rebuild         interactions + product content → item_neighbors (three
 *                   kinds, top lists) and products.popularity. A worker job,
 *                   nightly in production, on demand locally.
 *   forActor        a shopper's recent events → seeds → random walk over the
 *                   stored blend lists, two hops deep → a balanced, explained shelf
 *   pairsWith       what goes with one product: products bought or browsed
 *                   together with it, or, before there is behaviour, the most
 *                   similar products
 *   record / forget consented events, and deleting a shopper's history
 */

type Sql = postgres.Sql;

const DAY = 24 * 3_600_000;
export const BEHAVIOUR_HORIZON_DAYS = 90;
export const POPULARITY_HORIZON_DAYS = 30;
const LIST_LENGTH = { behavior: 50, content: 20, blend: 50 } as const;

type FeatureRow = {
  id: string;
  kind: string;
  category: string;
  brand: string | null;
  colors: string[];
  materials: string[];
  attributes: Record<string, string>;
  price_cents: number;
};

function features(row: FeatureRow): ProductFeatures {
  return {
    category: row.category,
    kind: row.kind,
    brand: row.brand,
    colors: row.colors,
    materials: row.materials,
    attributes: row.attributes,
    priceCents: row.price_cents,
  };
}

export function createTasteGraph(sql: Sql) {
  const featureColumns = sql`
    p.id, p.kind, c.slug AS category, b.name AS brand, p.colors, p.materials, p.attributes, p.price_cents
  `;
  const featureFrom = sql`
    FROM products p JOIN categories c ON c.id = p.category_id LEFT JOIN brands b ON b.id = p.brand_id
  `;

  async function rebuild({ now = Date.now() }: { now?: number } = {}) {
    const started = performance.now();
    // ISO strings, not Date objects: when the same postgres.js client is also
    // wrapped by Drizzle, Drizzle replaces its date serialiser and a Date
    // parameter in a raw query fails to encode.
    const since = new Date(now - BEHAVIOUR_HORIZON_DAYS * DAY).toISOString();

    const [events, products] = await Promise.all([
      sql<{ session_id: string; product_id: string; kind: InteractionKind; occurred_at: Date; dwell_seconds: number | null }[]>`
        SELECT i.session_id, i.product_id, i.kind, i.occurred_at, i.dwell_seconds
        FROM interactions i JOIN products p ON p.id = i.product_id
        WHERE i.occurred_at >= ${since}::timestamptz AND p.status = 'active'
      `,
      sql<FeatureRow[]>`SELECT ${featureColumns} ${featureFrom} WHERE p.status = 'active'`,
    ]);

    const interactionEvents: InteractionEvent[] = events.map((row) => ({
      sessionId: row.session_id,
      productId: row.product_id,
      kind: row.kind,
      at: new Date(row.occurred_at).getTime(),
      dwellSeconds: row.dwell_seconds,
    }));
    const { normalised, counts } = behaviourEdges(interactionEvents, { now });
    const content = contentEdges(
      products.map((row) => ({ id: row.id, vector: contentVector(features(row), SIMILARITY_WEIGHTS), group: row.category })),
      { topM: LIST_LENGTH.content },
    );
    const blended = blend(normalised, content, counts, { topK: LIST_LENGTH.blend });

    const rows: { product_id: string; kind: "behavior" | "content" | "blend"; neighbor_id: string; score: number; rank: number }[] = [];
    const push = (kind: "behavior" | "content" | "blend", edges: Neighbours, limit: number) => {
      for (const [product, row] of edges) {
        [...row]
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
          .slice(0, limit)
          .forEach(([neighbour, score], rank) => rows.push({ product_id: product, kind, neighbor_id: neighbour, score, rank }));
      }
    };
    push("behavior", normalised, LIST_LENGTH.behavior);
    push("content", content, LIST_LENGTH.content);
    push("blend", blended, LIST_LENGTH.blend);

    const popularitySince = now - POPULARITY_HORIZON_DAYS * DAY;
    const popularity = new Map<string, number>();
    for (const event of interactionEvents) {
      if (event.at < popularitySince) continue;
      const weight = event.kind === "purchase" ? 6 : event.kind === "cart" ? 3 : event.kind === "view" ? 1 : 0;
      popularity.set(event.productId, (popularity.get(event.productId) ?? 0) + weight);
    }

    await sql.begin(async (tx) => {
      await tx`DELETE FROM item_neighbors`;
      for (let start = 0; start < rows.length; start += 1_000) {
        await tx`INSERT INTO item_neighbors ${tx(rows.slice(start, start + 1_000), "product_id", "kind", "neighbor_id", "score", "rank")}`;
      }
      await tx`UPDATE products SET popularity = 0 WHERE popularity <> 0`;
      const updates = [...popularity].filter(([, value]) => value > 0);
      if (updates.length > 0) {
        await tx`
          UPDATE products p SET popularity = v.value
          FROM unnest(${updates.map(([id]) => id)}::uuid[], ${updates.map(([, value]) => Math.round(value))}::int[]) AS v(id, value)
          WHERE p.id = v.id
        `;
      }
    });

    return {
      events: interactionEvents.length,
      products: products.length,
      behaviourProducts: normalised.size,
      neighbourRows: rows.length,
      elapsedMs: Math.round(performance.now() - started),
    };
  }

  /** Blend rows for the given products: the transition probabilities the walk follows. */
  async function transitionsFor(productIds: readonly string[]): Promise<Neighbours> {
    const transitions: Neighbours = new Map();
    if (productIds.length === 0) return transitions;
    const rows = await sql<{ product_id: string; neighbor_id: string; score: number }[]>`
      SELECT product_id, neighbor_id, score FROM item_neighbors
      WHERE kind = 'blend' AND product_id = ANY(${[...productIds]}::uuid[])
    `;
    for (const row of rows) {
      let map = transitions.get(row.product_id);
      if (map === undefined) {
        map = new Map();
        transitions.set(row.product_id, map);
      }
      map.set(row.neighbor_id, row.score);
    }
    return transitions;
  }

  async function forActor(actorId: string, { limit = 8, now = Date.now() }: { limit?: number; now?: number } = {}): Promise<Recommendation[]> {
    const events = await sql<{ product_id: string; kind: InteractionKind; occurred_at: Date; dwell_seconds: number | null }[]>`
      SELECT i.product_id, i.kind, i.occurred_at, i.dwell_seconds
      FROM interactions i JOIN products p ON p.id = i.product_id
      WHERE i.actor_id = ${actorId} AND p.status = 'active' AND i.occurred_at >= ${new Date(now - 60 * DAY).toISOString()}::timestamptz
      ORDER BY i.occurred_at DESC
      LIMIT 200
    `;
    if (events.length === 0) return [];

    const seeds = seedVector(
      events.map((row) => ({ productId: row.product_id, kind: row.kind, at: new Date(row.occurred_at).getTime(), dwellSeconds: row.dwell_seconds })),
      { now },
    );
    const purchased = new Set(events.filter((row) => row.kind === "purchase").map((row) => row.product_id));

    // Two hops of stored lists: the seeds' neighbours, then theirs. Mass that
    // walks beyond is treated as dangling and returns to the seeds (walk.ts).
    const firstHop = await transitionsFor([...seeds.keys()]);
    const reached = new Set<string>();
    for (const row of firstHop.values()) for (const id of row.keys()) if (!firstHop.has(id)) reached.add(id);
    const secondHop = await transitionsFor([...reached]);
    const transitions: Neighbours = new Map([...firstHop, ...secondHop]);

    const candidateIds = new Set<string>();
    for (const row of transitions.values()) for (const id of row.keys()) candidateIds.add(id);
    const featureRows = await sql<(FeatureRow & { in_stock: boolean })[]>`
      SELECT ${featureColumns},
             EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id AND v.stock > 0) AS in_stock
      ${featureFrom}
      WHERE p.status = 'active' AND p.id = ANY(${[...candidateIds]}::uuid[])
    `;
    const byId = new Map(featureRows.map((row) => [row.id, row]));
    const vectors = new Map(featureRows.map((row) => [row.id, contentVector(features(row), SIMILARITY_WEIGHTS)]));

    return recommend(transitions, seeds, {
      limit,
      exclude: new Set([...purchased, ...featureRows.filter((row) => !row.in_stock).map((row) => row.id)]),
      categoryOf: (id) => byId.get(id)?.category,
      similarity: (a, b) => {
        const va = vectors.get(a);
        const vb = vectors.get(b);
        return va === undefined || vb === undefined ? 0 : Math.max(0, dot(va, vb));
      },
    });
  }

  /** What goes with a product: behaviour when it exists, otherwise the most similar products. */
  async function pairsWith(productId: string, limit = 4): Promise<{ source: "behavior" | "content"; ids: string[] }> {
    const rows = await sql<{ neighbor_id: string; kind: "behavior" | "content" }[]>`
      SELECT n.neighbor_id, n.kind
      FROM item_neighbors n
      JOIN products p ON p.id = n.neighbor_id
      WHERE n.product_id = ${productId} AND n.kind IN ('behavior', 'content') AND p.status = 'active'
        AND EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id AND v.stock > 0)
      ORDER BY n.kind, n.rank
    `;
    const behaviour = rows.filter((row) => row.kind === "behavior").map((row) => row.neighbor_id);
    if (behaviour.length > 0) return { source: "behavior", ids: behaviour.slice(0, limit) };
    return { source: "content", ids: rows.filter((row) => row.kind === "content").map((row) => row.neighbor_id).slice(0, limit) };
  }

  async function record(event: { actorId: string; sessionId: string; productId: string; kind: InteractionKind; dwellSeconds?: number | null }): Promise<boolean> {
    const rows = await sql`
      INSERT INTO interactions (id, actor_id, session_id, product_id, kind, dwell_seconds)
      SELECT ${uuidv7()}, ${event.actorId}, ${event.sessionId}, p.id, ${event.kind}, ${event.dwellSeconds ?? null}
      FROM products p WHERE p.id = ${event.productId} AND p.status = 'active'
      RETURNING id
    `;
    return rows.length === 1;
  }

  async function forget(actorId: string): Promise<number> {
    const rows = await sql`DELETE FROM interactions WHERE actor_id = ${actorId} RETURNING id`;
    return rows.length;
  }

  /**
   * What the shop has recorded for this shopper, newest first (docs/adr/033):
   * the product, what they did and when, for them to read and delete. Their
   * own events only, found by the id in their cookie.
   */
  async function history(actorId: string, locale: "en" | "el", limit = 200): Promise<{ id: string; productId: string; title: string; slug: string; kind: InteractionKind; at: Date }[]> {
    const rows = await sql<{ id: string; product_id: string; title: string; slug: string; kind: InteractionKind; occurred_at: Date }[]>`
      SELECT i.id, i.product_id, COALESCE(CASE WHEN ${locale} = 'el' THEN p.title_el END, p.title_en) AS title, p.slug, i.kind, i.occurred_at
      FROM interactions i JOIN products p ON p.id = i.product_id
      WHERE i.actor_id = ${actorId}
      ORDER BY i.occurred_at DESC
      LIMIT ${limit}
    `;
    return rows.map((row) => ({ id: row.id, productId: row.product_id, title: row.title, slug: row.slug, kind: row.kind, at: new Date(row.occurred_at) }));
  }

  /** Forgets one recorded event, only if it is this shopper's. */
  async function forgetOne(actorId: string, id: string): Promise<boolean> {
    const rows = await sql`DELETE FROM interactions WHERE id = ${id} AND actor_id = ${actorId} RETURNING id`;
    return rows.length === 1;
  }

  return { rebuild, forActor, pairsWith, record, forget, history, forgetOne };
}

export type TasteGraph = ReturnType<typeof createTasteGraph>;
