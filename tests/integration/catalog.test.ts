/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Integration tests for the catalogue migration and writer.
 */

import { readFile } from "node:fs/promises";

import { eq, sql as dsql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { catalogFixtureSchema, type ProductInput } from "@/lib/catalog/input";
import { archiveExcluded, upsertCatalog, type CatalogDatabase } from "@/lib/catalog/write";
import * as schema from "@/lib/db/schema";

/**
 * The catalogue migration and writer, against real PostgreSQL with the real
 * extensions: the generated search vector, the trigram and GIN indexes, the
 * money constraints, and idempotent re-imports.
 */

const url = process.env.DATABASE_URL;

describe.skipIf(url === undefined || url === "")("catalogue", () => {
  let connection: ReturnType<typeof postgres>;
  let db: CatalogDatabase;
  let fixture: ProductInput[];

  beforeAll(async () => {
    connection = postgres(url as string, { max: 2, onnotice: () => {} });
    db = drizzle(connection, { schema });
    await migrate(db, { migrationsFolder: "./drizzle" });
    await connection`TRUNCATE products, brands, categories CASCADE`;
    fixture = catalogFixtureSchema.parse(JSON.parse(await readFile("src/lib/catalog/fixtures/specimen.json", "utf8"))).products;
  });

  afterAll(async () => {
    await connection?.end();
  });

  it("writes the specimen fixture: products, media, variants, brands, categories", async () => {
    const summary = await upsertCatalog(db, fixture);
    expect(summary.products).toBe(25);

    const [counts] = await connection<{ products: number; media: number; variants: number; categories: number }[]>`
      SELECT (SELECT count(*)::int FROM products) AS products,
             (SELECT count(*)::int FROM product_media) AS media,
             (SELECT count(*)::int FROM product_variants) AS variants,
             (SELECT count(*)::int FROM categories) AS categories
    `;
    const mediaInFixture = fixture.reduce((sum, product) => sum + product.media.length, 0);
    expect(counts).toEqual({ products: 25, media: mediaInFixture, variants: 25, categories: 8 });
  });

  it("is idempotent: a second import updates in place and keeps product ids", async () => {
    const before = await connection<{ id: string; source_id: string }[]>`SELECT id, source_id FROM products ORDER BY source_id`;
    const changed = fixture.map((product, i) => (i === 0 ? { ...product, priceCents: product.priceCents + 1000, stock: 0 } : product));
    await upsertCatalog(db, changed);
    const after = await connection<{ id: string; source_id: string }[]>`SELECT id, source_id FROM products ORDER BY source_id`;
    expect(after).toEqual(before);

    const [first] = await db.select().from(schema.products).where(eq(schema.products.sourceId, fixture[0]!.sourceId));
    expect(first?.priceCents).toBe(fixture[0]!.priceCents + 1000);
    const [media] = await connection<{ n: number }[]>`SELECT count(*)::int AS n FROM product_media`;
    expect(media?.n).toBe(fixture.reduce((sum, product) => sum + product.media.length, 0));
    const [variant] = await connection<{ stock: number }[]>`
      SELECT v.stock FROM product_variants v JOIN products p ON p.id = v.product_id WHERE p.source_id = ${fixture[0]!.sourceId}
    `;
    expect(variant?.stock).toBe(0);
  });

  it("builds the weighted search vector with English and Greek stems", async () => {
    const rows = await connection<{ title_en: string; rank: number }[]>`
      SELECT title_en, ts_rank_cd(search_tsv, query) AS rank
      FROM products, (SELECT websearch_to_tsquery('greek', 'φωτιστικά') AS query) q
      WHERE search_tsv @@ query
      ORDER BY rank DESC
    `;
    // No product has a Greek title yet; Greek finds them through the indexed kind noun.
    expect(rows.length).toBe(12);

    const english = await connection<{ n: number }[]>`
      SELECT count(*)::int AS n FROM products WHERE search_tsv @@ websearch_to_tsquery('english', 'chairs')
    `;
    expect(english[0]!.n).toBeGreaterThan(0);
  });

  it("ranks a title match above a description match", async () => {
    const rows = await connection<{ where_found: string; rank: number }[]>`
      SELECT CASE WHEN search_title LIKE '%lamp%' THEN 'title' ELSE 'elsewhere' END AS where_found,
             ts_rank_cd(search_tsv, websearch_to_tsquery('english', 'lamp')) AS rank
      FROM products
      WHERE search_tsv @@ websearch_to_tsquery('english', 'lamp')
      ORDER BY rank DESC
    `;
    expect(rows[0]?.where_found).toBe("title");
  });

  it("serves fuzzy matches from the trigram index", async () => {
    const rows = await connection<{ title_en: string }[]>`
      SELECT title_en FROM products WHERE search_title % 'chiar' OR word_similarity('chiar', search_title) > 0.3
    `;
    expect(rows.some((row) => /chair/i.test(row.title_en))).toBe(true);
  });

  it("filters by canonical colours and materials with array operators", async () => {
    const rows = await db
      .select({ colors: schema.products.colors })
      .from(schema.products)
      .where(dsql`${schema.products.colors} && ARRAY['grey']::text[]`);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.colors).toContain("grey");
  });

  it("refuses negative prices and a compare-at price below the price", async () => {
    const [category] = await db.select().from(schema.categories).limit(1);
    const base = {
      slug: "constraint-probe",
      source: "abo" as const,
      sourceId: "PROBE",
      categoryId: category!.id,
      kind: "CHAIR",
      titleEn: "Probe",
      license: "test",
      attribution: "test",
    };
    await expect(db.insert(schema.products).values({ ...base, priceCents: -1 })).rejects.toThrow();
    await expect(db.insert(schema.products).values({ ...base, priceCents: 1000, compareAtCents: 900 })).rejects.toThrow();
  });

  it("archives excluded listings without deleting them, and a re-import does not revive them", async () => {
    const target = fixture[1]!;
    expect(await archiveExcluded(db, "abo", [target.sourceId])).toBe(1);
    expect(await archiveExcluded(db, "abo", [target.sourceId])).toBe(0);

    await upsertCatalog(db, [target]);
    const [row] = await db.select({ status: schema.products.status }).from(schema.products).where(eq(schema.products.sourceId, target.sourceId));
    expect(row?.status).toBe("archived");

    await connection`UPDATE products SET status = 'active' WHERE source_id = ${target.sourceId}`;
  });

  it("uses the indexes the retrievers depend on", async () => {
    const indexes = await connection<{ indexname: string; indexdef: string }[]>`
      SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'products'
    `;
    const byName = Object.fromEntries(indexes.map((index) => [index.indexname, index.indexdef]));
    expect(byName["products_search_tsv_idx"]).toMatch(/USING gin/);
    expect(byName["products_search_title_trgm_idx"]).toMatch(/gin_trgm_ops/);
    expect(byName["products_text_embedding_idx"]).toMatch(/USING hnsw .*vector_cosine_ops/);
  });
});
