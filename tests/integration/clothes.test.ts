/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Integration tests for the real clothes against PostgreSQL: they replace the drawn capsule, keep their reviews, and filter by who they are for.
 */

import { readFile } from "node:fs/promises";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { uuidv7 } from "uuidv7";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { catalogFixtureSchema, type ProductInput } from "@/lib/catalog/input";
import { parseListing } from "@/lib/catalog/listing";
import { createCatalogQueries } from "@/lib/catalog/queries";
import { archiveMissing, archiveSource, upsertCatalog } from "@/lib/catalog/write";
import * as schema from "@/lib/db/schema";
import { amazonReviewsFixtureSchema } from "@/lib/reviews/amazon";
import { createExternalReviewStore } from "@/lib/reviews/external-store";
import { colorLabel, materialLabel } from "@/lib/search/vocabulary";

/**
 * docs/adr/062. The deploy's seed puts the clothes on sale and archives the
 * drawn capsule in the same run; this does the same with the full clothes
 * fixture, whose photographs live on Amazon's image CDN.
 */

const url = process.env.DATABASE_URL;

describe.skipIf(url === undefined || url === "")("real clothes in place of the drawn capsule", () => {
  let connection: ReturnType<typeof postgres>;
  let clothes: ProductInput[];
  let capsule: ProductInput[];
  const labels = { color: (id: string) => colorLabel(id, "en"), material: (id: string) => materialLabel(id, "en") };

  beforeAll(async () => {
    connection = postgres(url as string, { max: 4, onnotice: () => {} });
    const db = drizzle(connection, { schema });
    await migrate(db, { migrationsFolder: "./drizzle" });
    const read = async (file: string) => catalogFixtureSchema.parse(JSON.parse(await readFile(`src/lib/catalog/fixtures/${file}`, "utf8"))).products;
    capsule = await read("capsule.json");
    clothes = await read("amazon-clothes.json");
    // A shop that sold the capsule, then a deploy that brings the clothes.
    await upsertCatalog(db, capsule);
    await upsertCatalog(db, clothes);
    await archiveSource(db, "capsule");
  });

  afterAll(async () => {
    await connection?.end();
  });

  it("archives every drawn piece, deleting none, and lists only real garments under Clothing", async () => {
    const [counts] = await connection<{ archived: number; total: number }[]>`
      SELECT count(*) FILTER (WHERE status = 'archived')::int AS archived, count(*)::int AS total FROM products WHERE source = 'capsule'
    `;
    expect(counts).toEqual({ archived: capsule.length, total: capsule.length });

    const queries = createCatalogQueries(connection);
    const listing = await queries.listProducts({ category: "wear", state: parseListing({}), locale: "en", pageSize: 200, labels });
    expect(listing.total).toBe(clothes.length);
    // An archived piece has no page; an order that bought one still names it from its own line.
    expect(await queries.productBySlug(capsule[0]!.slug, "en")).toBeNull();
    expect(await queries.productBySlug(clothes[0]!.slug, "en")).not.toBeNull();
  });

  it("filters Clothing by who it is for, and counts both sides whichever is chosen", async () => {
    const queries = createCatalogQueries(connection);
    const all = await queries.listProducts({ category: "wear", state: parseListing({}), locale: "en", pageSize: 200, labels });
    const men = clothes.filter((product) => product.attributes.department === "men").length;
    expect(all.facets.departments).toEqual([
      { value: "women", label: "women", count: clothes.length - men },
      { value: "men", label: "men", count: men },
    ]);
    const forMen = await queries.listProducts({ category: "wear", state: parseListing({ for: "men" }), locale: "en", pageSize: 200, labels });
    expect(forMen.total).toBe(men);
    expect(forMen.facets.departments.map((facet) => facet.value)).toEqual(["women", "men"]);
    // Sizes come in a run, and only those in stock.
    expect(forMen.facets.sizes.map((facet) => facet.value)).toEqual(["XS", "S", "M", "L", "XL"].filter((size) => forMen.facets.sizes.some((facet) => facet.value === size)));
  });

  it("gives the garments their Amazon.com reviews, synced with the wearables' in one pass", async () => {
    const read = async (file: string) => amazonReviewsFixtureSchema.parse(JSON.parse(await readFile(`src/lib/catalog/fixtures/${file}`, "utf8"))).products;
    const merged = { ...(await read("amazon-reviews.json")), ...(await read("amazon-clothes-reviews.json")) };
    const store = createExternalReviewStore(connection);
    const synced = await store.syncAmazon(merged);
    expect(synced.products).toBeGreaterThanOrEqual(clothes.length);
    const [row] = await connection<{ id: string }[]>`SELECT id FROM products WHERE source = 'amazon' AND source_id = ${clothes[0]!.sourceId}`;
    const shown = await store.forProduct(row!.id);
    expect(shown?.reviews.length).toBeGreaterThanOrEqual(3);
    // Still never the shop's own rating.
    const [rating] = await connection<{ rating_count: number }[]>`SELECT rating_count FROM products WHERE id = ${row!.id}`;
    expect(rating?.rating_count).toBe(0);
  });

  it("archives a garment a rebuilt fixture no longer holds, and nothing else", async () => {
    const db = drizzle(connection, { schema });
    const kept = clothes.slice(1).map((product) => product.sourceId);
    expect(await archiveMissing(db, "amazon", kept)).toBe(1);
    const [row] = await connection<{ status: string }[]>`SELECT status FROM products WHERE source = 'amazon' AND source_id = ${clothes[0]!.sourceId}`;
    expect(row?.status).toBe("archived");
    // Run again: nothing more to archive.
    expect(await archiveMissing(db, "amazon", kept)).toBe(0);
    await connection`UPDATE products SET status = 'active' WHERE source = 'amazon' AND source_id = ${clothes[0]!.sourceId}`;
  });

  it("keeps product photographs to the shop's own files, ABO's bucket and Amazon's image CDN", async () => {
    const [product] = await connection<{ id: string }[]>`SELECT id FROM products WHERE source = 'amazon' LIMIT 1`;
    const insert = (src: string) => connection`
      INSERT INTO product_media (id, product_id, kind, position, src, alt_en, white_ground)
      VALUES (${uuidv7()}, ${product!.id}, 'image', 90, ${src}, 'test', false)
    `;
    await expect(insert("https://example.com/images/I/shirt.jpg")).rejects.toThrow(/product_media_src_allowed/);
    await insert("https://m.media-amazon.com/images/I/61KIZjb54AL._AC_UL1500_.jpg");
    await connection`DELETE FROM product_media WHERE product_id = ${product!.id} AND position = 90`;
  });
});
