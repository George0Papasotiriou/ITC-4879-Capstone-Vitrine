/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Integration tests for the Taste Graph store against PostgreSQL.
 */

import { readFile } from "node:fs/promises";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { uuidv7 } from "uuidv7";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { catalogFixtureSchema } from "@/lib/catalog/input";
import { upsertCatalog } from "@/lib/catalog/write";
import * as schema from "@/lib/db/schema";
import { createTasteGraph, type TasteGraph } from "@/lib/reco/store";

/**
 * The Taste Graph against the database: rebuilding neighbour lists from
 * interactions, personalised shelves, "pairs well with", recording and
 * forgetting.
 */

const url = process.env.DATABASE_URL;

describe.skipIf(url === undefined || url === "")("taste graph", () => {
  let connection: ReturnType<typeof postgres>;
  let graph: TasteGraph;
  let ids: Map<string, string>; // source id → product id
  let categoryOf: Map<string, string>;
  const now = Date.now();

  const insertEvents = async (rows: { actor: string; session: string; source: string; kind: string; minutesAgo: number; synthetic?: boolean }[]) => {
    for (const row of rows) {
      await connection`
        INSERT INTO interactions (id, actor_id, session_id, product_id, kind, synthetic, occurred_at)
        VALUES (${uuidv7()}, ${row.actor}, ${row.session}, ${ids.get(row.source)!}, ${row.kind}, ${row.synthetic ?? true}, ${new Date(now - row.minutesAgo * 60_000).toISOString()}::timestamptz)
      `;
    }
  };

  beforeAll(async () => {
    connection = postgres(url as string, { max: 4, onnotice: () => {} });
    const db = drizzle(connection, { schema });
    await migrate(db, { migrationsFolder: "./drizzle" });
    await connection`TRUNCATE products, brands, categories, interactions, item_neighbors CASCADE`;
    const fixture = catalogFixtureSchema.parse(JSON.parse(await readFile("src/lib/catalog/fixtures/specimen.json", "utf8"))).products;
    await upsertCatalog(db, fixture);
    const rows = await connection<{ id: string; source_id: string; category: string }[]>`
      SELECT p.id, p.source_id, c.slug AS category FROM products p JOIN categories c ON c.id = p.category_id
    `;
    ids = new Map(rows.map((row) => [row.source_id, row.id]));
    categoryOf = new Map(rows.map((row) => [row.id, row.category]));
    graph = createTasteGraph(connection);
  });

  afterAll(async () => {
    await connection?.end();
  });

  // Specimen ids: a Westview sofa (B082VLYQWX), a ceramic lamp (B07MBFDJQ3),
  // a Hayes dining table (B07SJ75Y1M), a Pinzon chair (B001BQ1Q9G).
  const SOFA = "B082VLYQWX";
  const LAMP = "B07MBFDJQ3";
  const TABLE = "B07SJ75Y1M";
  const CHAIR = "B001BQ1Q9G";

  it("builds content lists for every product even with no behaviour (cold start)", async () => {
    const stats = await graph.rebuild({ now });
    expect(stats.events).toBe(0);
    const [row] = await connection<{ products: number }[]>`
      SELECT count(DISTINCT product_id)::int AS products FROM item_neighbors WHERE kind = 'content'
    `;
    expect(row!.products).toBeGreaterThan(20);
    const pairs = await graph.pairsWith(ids.get(LAMP)!);
    expect(pairs.source).toBe("content");
    expect(pairs.ids.length).toBeGreaterThan(0);
    for (const id of pairs.ids) expect(categoryOf.get(id)).toBe("lighting");
  });

  it("learns behavioural edges and prefers them for pairs well with", async () => {
    const sessions = Array.from({ length: 12 }, (_, i) => [
      { actor: `a${i}`, session: `s${i}`, source: SOFA, kind: "view", minutesAgo: 30 },
      { actor: `a${i}`, session: `s${i}`, source: LAMP, kind: "view", minutesAgo: 28 },
      { actor: `a${i}`, session: `s${i}`, source: LAMP, kind: "cart", minutesAgo: 27 },
    ]).flat();
    await insertEvents(sessions);
    await graph.rebuild({ now });

    const pairs = await graph.pairsWith(ids.get(SOFA)!);
    expect(pairs.source).toBe("behavior");
    expect(pairs.ids[0]).toBe(ids.get(LAMP));

    const rows = await connection<{ total: number }[]>`
      SELECT sum(score)::float8 AS total FROM item_neighbors WHERE kind = 'blend' AND product_id = ${ids.get(SOFA)!}
    `;
    expect(rows[0]!.total).toBeCloseTo(1, 6);
  });

  it("updates popularity from recent carts, purchases and views", async () => {
    const [lamp] = await connection<{ popularity: number }[]>`SELECT popularity FROM products WHERE id = ${ids.get(LAMP)!}`;
    expect(lamp!.popularity).toBe(12 * 1 + 12 * 3);
  });

  it("recommends for a shopper from their recent views, explained, never what they just saw", async () => {
    await insertEvents([{ actor: "shopper", session: "x", source: SOFA, kind: "view", minutesAgo: 5, synthetic: false }]);
    const shelf = await graph.forActor("shopper", { now, limit: 6 });
    expect(shelf.length).toBeGreaterThan(0);
    expect(shelf.map((item) => item.productId)).not.toContain(ids.get(SOFA));
    expect(shelf[0]!.productId).toBe(ids.get(LAMP));
    expect(shelf[0]!.because).toBe(ids.get(SOFA));
  });

  it("does not recommend what the shopper already bought", async () => {
    await insertEvents([
      { actor: "buyer", session: "b", source: SOFA, kind: "view", minutesAgo: 10, synthetic: false },
      { actor: "buyer", session: "b", source: LAMP, kind: "purchase", minutesAgo: 9, synthetic: false },
    ]);
    const shelf = await graph.forActor("buyer", { now });
    expect(shelf.map((item) => item.productId)).not.toContain(ids.get(LAMP));
  });

  it("records events only for active products, and forgets a shopper completely", async () => {
    expect(await graph.record({ actorId: "privacy", sessionId: "p1", productId: ids.get(TABLE)!, kind: "view" })).toBe(true);
    expect(await graph.record({ actorId: "privacy", sessionId: "p1", productId: ids.get(CHAIR)!, kind: "dwell", dwellSeconds: 45 })).toBe(true);
    expect(await graph.record({ actorId: "privacy", sessionId: "p1", productId: uuidv7(), kind: "view" })).toBe(false);

    expect(await graph.forget("privacy")).toBe(2);
    const [left] = await connection<{ n: number }[]>`SELECT count(*)::int AS n FROM interactions WHERE actor_id = 'privacy'`;
    expect(left!.n).toBe(0);
    expect(await graph.forActor("privacy")).toEqual([]);
  });
});
