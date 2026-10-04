/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Integration tests for the wearables against PostgreSQL: Amazon.com reviews kept apart from the shop's own, staff hiding that lasts, and the size filter.
 */

import { readFile } from "node:fs/promises";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { catalogFixtureSchema, type ProductInput } from "@/lib/catalog/input";
import { parseListing } from "@/lib/catalog/listing";
import { createCatalogQueries } from "@/lib/catalog/queries";
import { upsertCatalog } from "@/lib/catalog/write";
import * as schema from "@/lib/db/schema";
import { amazonReviewsFixtureSchema, type AmazonProductReviews } from "@/lib/reviews/amazon";
import { createExternalReviewStore } from "@/lib/reviews/external-store";
import { colorLabel, materialLabel } from "@/lib/search/vocabulary";

/**
 * docs/adr/061. The wear specimen (12 real ABO wearables) and the reviews the
 * committed fixture holds for them. The promise under test: Amazon.com
 * reviews are shown beside the shop's verified ones and never become them.
 */

const url = process.env.DATABASE_URL;
const SANDAL = "B01N4OPIRU";
// No signed-in person: the audit log records the change as the system's, as scripts do.
const staff = null;

describe.skipIf(url === undefined || url === "")("wearables and their Amazon.com reviews", () => {
  let connection: ReturnType<typeof postgres>;
  let store: ReturnType<typeof createExternalReviewStore>;
  let wear: ProductInput[];
  let reviews: Record<string, AmazonProductReviews>;
  let sandalId: string;

  beforeAll(async () => {
    connection = postgres(url as string, { max: 4, onnotice: () => {} });
    const db = drizzle(connection, { schema });
    await migrate(db, { migrationsFolder: "./drizzle" });
    wear = catalogFixtureSchema.parse(JSON.parse(await readFile("src/lib/catalog/fixtures/wear-specimen.json", "utf8"))).products;
    await upsertCatalog(db, wear);
    const all = amazonReviewsFixtureSchema.parse(JSON.parse(await readFile("src/lib/catalog/fixtures/amazon-reviews.json", "utf8"))).products;
    reviews = Object.fromEntries(wear.flatMap((product) => (all[product.sourceId] === undefined ? [] : [[product.sourceId, all[product.sourceId]!]])));
    store = createExternalReviewStore(connection);
    sandalId = (await connection<{ id: string }[]>`SELECT id FROM products WHERE source = 'abo' AND source_id = ${SANDAL}`)[0]!.id;
  });

  afterAll(async () => {
    await connection?.end();
  });

  it("writes the reviews of the pieces the shop has, with their totals", async () => {
    expect(Object.keys(reviews).length).toBeGreaterThanOrEqual(3);
    const synced = await store.syncAmazon(reviews);
    expect(synced.products).toBe(Object.keys(reviews).length);
    expect(synced.reviews).toBe(Object.values(reviews).reduce((sum, entry) => sum + entry.reviews.length, 0));

    const shown = await store.forProduct(sandalId);
    const entry = reviews[SANDAL]!;
    expect(shown?.summary).toMatchObject({ source: "amazon_reviews_2023", count: entry.count, runsSmall: entry.small, trueToSize: entry.trueToSize, runsLarge: entry.large });
    expect(shown?.reviews.map((review) => review.body)).toEqual(entry.reviews.map((review) => review.text));
    expect(shown?.reviews[0]?.reviewedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("never counts them in the shop's own rating, which search ranks by and JSON-LD publishes", async () => {
    await store.syncAmazon(reviews);
    const [row] = await connection<{ rating_count: number; rating_sum: number }[]>`SELECT rating_count, rating_sum FROM products WHERE id = ${sandalId}`;
    expect(row).toEqual({ rating_count: 0, rating_sum: 0 });
    const [own] = await connection<{ n: number }[]>`SELECT count(*)::int AS n FROM reviews WHERE product_id = ${sandalId}`;
    expect(own?.n).toBe(0);
  });

  it("keeps a review staff hid hidden through the next sync, with the reason and the audit row", async () => {
    await store.syncAmazon(reviews);
    const before = await store.forProduct(sandalId);
    const target = before!.reviews[1]!;
    expect(await store.setHidden(target.id, { hidden: true, reason: "Names a different product", actor: staff })).toBe(true);

    await store.syncAmazon(reviews);
    const after = await store.forProduct(sandalId);
    expect(after!.reviews.map((review) => review.id)).not.toContain(target.id);
    expect(after!.reviews).toHaveLength(before!.reviews.length - 1);

    const hidden = await store.deskList({ hidden: true });
    expect(hidden.find((review) => review.id === target.id)).toMatchObject({ hidden: true, hiddenReason: "Names a different product", productSlug: expect.stringContaining("b01n4opiru") });
    const [audit] = await connection<{ action: string; entity_type: string; reason: string | null }[]>`
      SELECT action, entity_type, reason FROM audit_log WHERE entity_id = ${target.id} ORDER BY created_at DESC LIMIT 1
    `;
    expect(audit).toEqual({ action: "review.hide", entity_type: "review", reason: "Names a different product" });

    expect(await store.setHidden(target.id, { hidden: false, reason: null, actor: staff })).toBe(true);
    expect((await store.forProduct(sandalId))!.reviews.map((review) => review.id)).toContain(target.id);
    expect(await store.setHidden("01900000-0000-7000-8000-000000000000", { hidden: true, reason: "x", actor: staff })).toBe(false);
  });

  it("removes a review the fixture no longer holds, and keeps the rest in place", async () => {
    await store.syncAmazon(reviews);
    const entry = reviews[SANDAL]!;
    const fewer = { ...reviews, [SANDAL]: { ...entry, reviews: entry.reviews.slice(1) } };
    await store.syncAmazon(fewer);
    const shown = await store.forProduct(sandalId);
    expect(shown!.reviews.map((review) => review.body)).toEqual(entry.reviews.slice(1).map((review) => review.text));
    await store.syncAmazon(reviews);
    expect((await store.forProduct(sandalId))!.reviews).toHaveLength(entry.reviews.length);

    // A piece the fixture drops altogether loses its block, totals and all.
    const without = Object.fromEntries(Object.entries(reviews).filter(([sourceId]) => sourceId !== SANDAL));
    await store.syncAmazon(without);
    expect(await store.forProduct(sandalId)).toBeNull();
    const [left] = await connection<{ n: number }[]>`SELECT count(*)::int AS n FROM external_reviews WHERE product_id = ${sandalId}`;
    expect(left?.n).toBe(0);
    await store.syncAmazon(reviews);
    expect((await store.forProduct(sandalId))!.reviews).toHaveLength(entry.reviews.length);
  });

  it("finds one product's reviews at the desk by words of its title or its slug, wildcards read literally", async () => {
    await store.syncAmazon(reviews);
    const byWords = await store.deskList({ hidden: null, product: "hurrache" });
    expect(byWords.length).toBe(reviews[SANDAL]!.reviews.length);
    expect(new Set(byWords.map((review) => review.productSlug)).size).toBe(1);
    const [slug] = await connection<{ slug: string }[]>`SELECT slug FROM products WHERE id = ${sandalId}`;
    expect(await store.deskList({ hidden: null, product: slug!.slug })).toHaveLength(byWords.length);
    expect(await store.deskList({ hidden: null, product: "%" })).toEqual([]);
    expect(await store.deskList({ hidden: null, product: "_" })).toEqual([]);
  });

  it("has nothing to show for a piece no one reviewed", async () => {
    const unreviewed = wear.find((product) => reviews[product.sourceId] === undefined)!;
    const [row] = await connection<{ id: string }[]>`SELECT id FROM products WHERE source = 'abo' AND source_id = ${unreviewed.sourceId}`;
    expect(await store.forProduct(row!.id)).toBeNull();
  });

  it("filters shoes by a size in stock, and offers the sizes in order", async () => {
    const queries = createCatalogQueries(connection);
    const labels = { color: (id: string) => colorLabel(id, "en"), material: (id: string) => materialLabel(id, "en") };
    const shoes = await queries.listProducts({ category: "shoes", state: parseListing({}), locale: "en", pageSize: 48, labels });
    const sizes = shoes.facets.sizes.map((facet) => facet.value);
    expect(sizes).toEqual([...sizes].sort((a, b) => Number(a) - Number(b)));
    expect(sizes).toContain("38");
    expect(sizes).not.toContain("One size");

    const in38 = await queries.listProducts({ category: "shoes", state: parseListing({ size: "38" }), locale: "en", pageSize: 48, labels });
    const expected = wear.filter((product) => product.category === "shoes" && (product.variants ?? []).some((variant) => variant.size === "38" && variant.stock > 0));
    expect(in38.total).toBe(expected.length);
    expect(in38.total).toBeLessThan(shoes.total);
    // The size facet ignores its own selection, so other sizes stay offered.
    expect(in38.facets.sizes.length).toBe(shoes.facets.sizes.length);
  });
});
