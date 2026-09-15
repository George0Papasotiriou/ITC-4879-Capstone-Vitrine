/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Integration tests for catalogue queries against PostgreSQL.
 */

import { readFile } from "node:fs/promises";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { catalogFixtureSchema, type ProductInput } from "@/lib/catalog/input";
import { EMPTY_LISTING, parseListing } from "@/lib/catalog/listing";
import { createCatalogQueries, type CatalogQueries } from "@/lib/catalog/queries";
import { ROOM_PLACEMENT } from "@/lib/catalog/taxonomy";
import { upsertCatalog } from "@/lib/catalog/write";
import * as schema from "@/lib/db/schema";
import { colorLabel, materialLabel } from "@/lib/search/vocabulary";

/**
 * Catalogue reads against the specimen fixture: filters, facets, sorting,
 * pagination and ordering, on the real database.
 */

const url = process.env.DATABASE_URL;

describe.skipIf(url === undefined || url === "")("catalogue queries", () => {
  let connection: ReturnType<typeof postgres>;
  let queries: CatalogQueries;
  let fixture: ProductInput[];

  const labels = { color: (id: string) => colorLabel(id, "en"), material: (id: string) => materialLabel(id, "en") };
  const list = (category: string | null, params: Record<string, string | string[]> = {}, pageSize = 24) =>
    queries.listProducts({ category, state: parseListing(params), locale: "en", pageSize, labels });

  beforeAll(async () => {
    connection = postgres(url as string, { max: 4, onnotice: () => {} });
    const db = drizzle(connection, { schema });
    await migrate(db, { migrationsFolder: "./drizzle" });
    await connection`TRUNCATE products, brands, categories CASCADE`;
    fixture = catalogFixtureSchema.parse(JSON.parse(await readFile("src/lib/catalog/fixtures/specimen.json", "utf8"))).products;
    await upsertCatalog(db, fixture);
    queries = createCatalogQueries(connection);
  });

  afterAll(async () => {
    await connection?.end();
  });

  it("lists a category with its total and cards ready to render", async () => {
    const listing = await list("lighting");
    expect(listing.total).toBe(12);
    expect(listing.products).toHaveLength(12);
    const card = listing.products[0]!;
    expect(card.category).toBe("lighting");
    expect(card.price.currency).toBe("EUR");
    expect(Number.isInteger(card.price.cents)).toBe(true);
    expect(card.image?.src).toMatch(/^\/products\/.+\.webp$/);
    expect(card.kindLabel).toMatch(/Lamp|Light fixture/);
  });

  it("counts products per category in both languages", async () => {
    const en = await queries.listCategories("en");
    const el = await queries.listCategories("el");
    expect(en.find((c) => c.slug === "lighting")).toMatchObject({ name: "Lighting", productCount: 12 });
    expect(el.find((c) => c.slug === "lighting")?.name).toBe("Φωτισμός");
    expect(en.reduce((sum, c) => sum + c.productCount, 0)).toBe(25);
  });

  it("filters by colour, and a facet's counts ignore its own selection", async () => {
    const unfiltered = await list(null);
    const greyCount = unfiltered.facets.colors.find((facet) => facet.value === "grey")?.count ?? 0;
    expect(greyCount).toBeGreaterThan(0);

    const grey = await list(null, { color: "grey" });
    expect(grey.total).toBe(greyCount);
    // Selecting grey must not make the other colours disappear from the colour facet.
    expect(grey.facets.colors.map((facet) => facet.value)).toEqual(unfiltered.facets.colors.map((facet) => facet.value));
    expect(grey.facets.colors.find((facet) => facet.value === "grey")?.label).toBe("Grey");
  });

  it("combines values within a facet with OR and across facets with AND", async () => {
    const all = await list(null);
    const [first, second] = all.facets.colors;
    const either = await list(null, { color: [first!.value, second!.value] });
    expect(either.total).toBeGreaterThanOrEqual(Math.max(first!.count, second!.count));

    const material = all.facets.materials[0]!;
    const both = await list(null, { color: first!.value, material: material.value });
    expect(both.total).toBeLessThanOrEqual(Math.min(first!.count, material.count));
  });

  it("filters by price range and availability", async () => {
    const cheap = await list(null, { max: "150" });
    for (const card of cheap.products) expect(card.price.cents).toBeLessThanOrEqual(15_000);

    const available = await list(null, { stock: "1" });
    for (const card of available.products) expect(card.inStock).toBe(true);
    expect(available.total).toBe(fixture.filter((product) => product.stock > 0).length);
  });

  it("sorts by price in both directions", async () => {
    const ascending = (await list(null, { sort: "price-asc" })).products.map((card) => card.price.cents);
    const descending = (await list(null, { sort: "price-desc" })).products.map((card) => card.price.cents);
    expect(ascending).toEqual([...ascending].sort((a, b) => a - b));
    expect(descending).toEqual([...descending].sort((a, b) => b - a));
  });

  it("paginates without overlap and reports the page count", async () => {
    const page1 = await list(null, {}, 10);
    const page3 = await list(null, { page: "3" }, 10);
    expect(page1.pageCount).toBe(3);
    expect(page1.products).toHaveLength(10);
    expect(page3.products).toHaveLength(5);
    const ids = new Set(page1.products.map((card) => card.id));
    for (const card of page3.products) expect(ids.has(card.id)).toBe(false);
  });

  it("reports the real total on a page past the end", async () => {
    const beyond = await list("lighting", { page: "9" });
    expect(beyond.products).toHaveLength(0);
    expect(beyond.total).toBe(12);
  });

  it("returns cards in the order the caller ranked them", async () => {
    const some = (await list(null)).products.slice(0, 5).map((card) => card.id);
    const reversed = [...some].reverse();
    expect((await queries.cardsByIds(reversed, "en")).map((card) => card.id)).toEqual(reversed);
    expect(await queries.cardsByIds([], "en")).toEqual([]);
  });

  it("loads a product page with all media, and marks untranslated Greek copy", async () => {
    const product = fixture[0]!;
    const en = await queries.productBySlug(product.slug, "en");
    const el = await queries.productBySlug(product.slug, "el");
    expect(en?.title).toBe(product.titleEn);
    expect(en?.media).toHaveLength(product.media.length);
    expect(en?.highlights).toEqual(product.highlightsEn);
    expect(en?.translated).toBe(true);
    expect(el?.categoryName).toMatch(/[α-ω]/i);
    expect(el?.translated).toBe(false);
    expect(await queries.productBySlug("no-such-product", "en")).toBeNull();
  });

  it("lists featured products, excluding the ones already shown", async () => {
    const [hero] = await queries.featured({ locale: "en", limit: 1, category: "lighting" });
    const rail = await queries.featured({ locale: "en", limit: 6, excludeIds: [hero!.id] });
    expect(hero?.category).toBe("lighting");
    expect(rail).toHaveLength(6);
    expect(rail.some((card) => card.id === hero!.id)).toBe(false);
  });

  it("offers for room placement only measured pieces that stand or lie on a floor", async () => {
    const cards = await queries.placeable({ locale: "en", limit: 50 });
    const expected = fixture.filter((product) => product.dimsCm != null && ROOM_PLACEMENT[product.kind] !== undefined);
    expect(cards.map((card) => card.slug).sort()).toEqual(expected.map((product) => product.slug).sort());
    expect(cards.every((card) => ROOM_PLACEMENT[card.kind] !== undefined)).toBe(true);
    // Wall sconces and ceiling pendants have dimensions but hang: never offered.
    expect(cards.some((card) => card.kind === "LIGHT_FIXTURE")).toBe(false);
  });

  it("handles the empty listing state", async () => {
    const listing = await queries.listProducts({ category: null, state: EMPTY_LISTING, locale: "el", pageSize: 24, labels });
    expect(listing.total).toBe(25);
    expect(listing.facets.price?.minCents).toBeLessThan(listing.facets.price!.maxCents);
  });
});
