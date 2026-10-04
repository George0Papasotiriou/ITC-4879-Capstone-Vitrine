/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Integration tests for the job that builds the shop's own 3D models ahead of shoppers, and for the AI model desk.
 */

import { readFile } from "node:fs/promises";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { uuidv7 } from "uuidv7";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { canMakeModel } from "@/lib/catalog/model/family";
import { createAiModelStore } from "@/lib/catalog/model/ai-store";
import { catalogFixtureSchema } from "@/lib/catalog/input";
import { upsertCatalog } from "@/lib/catalog/write";
import * as schema from "@/lib/db/schema";
import { buildPendingMadeModels } from "@/worker/processors/made-models";

/**
 * docs/adr/058, docs/adr/059. The job compares the key each piece's model
 * should have with the one recorded, builds the next few that differ, stores
 * them and records them; a second run finds nothing to do, and an edit to a
 * piece makes its model again. Photographs are not fetched in tests: the
 * specimen products' own pictures are not reachable, so `photo` answers null
 * and those pieces are deferred, exactly as in production when a fetch fails.
 */

const url = process.env.DATABASE_URL;

describe.skipIf(url === undefined || url === "")("made models job", () => {
  let connection: ReturnType<typeof postgres>;
  const stored = new Map<string, number>();
  const files = {
    putObject: async ({ key, body }: { key: string; body: Uint8Array }) => {
      stored.set(key, body.byteLength);
    },
    exists: async (key: string) => stored.has(key),
  };
  let placeable = 0;

  beforeAll(async () => {
    connection = postgres(url as string, { max: 2, onnotice: () => {} });
    const db = drizzle(connection, { schema });
    await migrate(db, { migrationsFolder: "./drizzle" });
    await connection`TRUNCATE products, brands, categories CASCADE`;
    const specimen = catalogFixtureSchema.parse(JSON.parse(await readFile("src/lib/catalog/fixtures/specimen.json", "utf8"))).products;
    placeable = specimen.filter((product) => product.dimsCm != null && canMakeModel(product.kind, product.dimsCm)).length;
    await upsertCatalog(db, specimen);
    // The specimen pieces carry no photograph the test can fetch: make them photograph-less so they are built.
    await connection`DELETE FROM product_media WHERE kind = 'image'`;
  }, 120_000);

  afterAll(async () => {
    await connection?.end();
  });

  const recorded = () => connection<{ slug: string; storage_key: string; status: string }[]>`
    SELECT p.slug, pm.storage_key, pm.status FROM product_models pm JOIN products p ON p.id = pm.product_id WHERE pm.origin = 'made' ORDER BY p.slug
  `;

  it("builds the next few, stores them and records each one", async () => {
    expect(placeable).toBeGreaterThan(3);
    const stats = await buildPendingMadeModels({ sql: connection, files, photo: async () => null }, 3);
    expect(stats).toMatchObject({ built: 3, found: 0, deferred: 0, remaining: placeable - 3 });
    const rows = await recorded();
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.status).toBe("ready");
      expect(stored.has(row.storage_key)).toBe(true);
    }
  }, 120_000);

  it("finishes the rest, then finds nothing to do", async () => {
    await buildPendingMadeModels({ sql: connection, files, photo: async () => null }, 60);
    expect(await recorded()).toHaveLength(placeable);
    expect(await buildPendingMadeModels({ sql: connection, files, photo: async () => null }, 60)).toMatchObject({ built: 0, found: 0, remaining: 0 });
  }, 300_000);

  it("makes a piece's model again when the piece is edited — under a new key, keeping the old file", async () => {
    const [before] = await recorded();
    await connection`UPDATE products SET title_en = title_en || ' (walnut)' WHERE slug = ${before!.slug}`;
    const stats = await buildPendingMadeModels({ sql: connection, files, photo: async () => null }, 60);
    expect(stats).toMatchObject({ built: 1, remaining: 0 });
    const after = (await recorded()).find((row) => row.slug === before!.slug)!;
    expect(after.storage_key).not.toBe(before!.storage_key);
    expect(stored.has(before!.storage_key)).toBe(true);
  }, 120_000);

  it("lets staff hide an AI model and show it again, each change in the audit log", async () => {
    const [piece] = await connection<{ id: string }[]>`SELECT id FROM products ORDER BY slug LIMIT 1`;
    const id = uuidv7();
    await connection`
      INSERT INTO product_models (id, product_id, origin, status, provider, model, storage_key, fit)
      VALUES (${id}, ${piece!.id}, 'ai', 'ready', 'fal', 'fal-ai/trellis', 'catalog/ai-3d/trellis/test.glb', 0.71)
    `;
    const store = createAiModelStore(connection);
    expect((await store.list("ready")).map((row) => row.id)).toContain(id);
    expect(await store.setShown(id, false, null)).toEqual({ ok: true });
    expect((await store.list("hidden")).map((row) => row.id)).toContain(id);
    expect(await store.setShown(id, true, null)).toEqual({ ok: true });
    const audit = await connection<{ action: string }[]>`SELECT action FROM audit_log WHERE entity_id = ${piece!.id} ORDER BY created_at`;
    expect(audit.map((row) => row.action)).toEqual(["model.hide", "model.show"]);
    // A model with no file cannot be shown.
    const empty = uuidv7();
    const [other] = await connection<{ id: string }[]>`SELECT id FROM products ORDER BY slug OFFSET 1 LIMIT 1`;
    await connection`INSERT INTO product_models (id, product_id, origin, status, provider, model) VALUES (${empty}, ${other!.id}, 'ai', 'failed', 'fal', 'fal-ai/trellis')`;
    expect(await store.setShown(empty, true, null)).toEqual({ ok: false, reason: "no_file" });
  });
});
