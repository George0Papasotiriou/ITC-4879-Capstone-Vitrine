/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Integration tests for the hybrid search pipeline against PostgreSQL.
 */

import { readFile } from "node:fs/promises";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { catalogFixtureSchema } from "@/lib/catalog/input";
import { createCatalogQueries, type CatalogQueries, type ProductCard } from "@/lib/catalog/queries";
import { upsertCatalog } from "@/lib/catalog/write";
import * as schema from "@/lib/db/schema";
import { resetSearchVocabulary, searchProducts, type SearchOptions } from "@/lib/search/pipeline";
import { createRetrievers, type Retrievers } from "@/lib/search/retrieve";

/**
 * The A1 pipeline end to end on the specimen catalogue (25 products, English
 * titles, Greek kind and category names). These are behaviour checks, not the
 * quality evaluation — that is E1, on labelled queries — but each one pins a
 * capability the plan promises: English, Greek, Greeklish, typos, constraints
 * in natural language, and graceful handling of queries that find nothing.
 */

const url = process.env.DATABASE_URL;

describe.skipIf(url === undefined || url === "")("hybrid search", () => {
  let connection: ReturnType<typeof postgres>;
  let retrievers: Retrievers;
  let queries: CatalogQueries;

  async function search(query: string, options?: SearchOptions): Promise<{ cards: ProductCard[]; result: Awaited<ReturnType<typeof searchProducts>> }> {
    const result = await searchProducts(retrievers, query, options);
    return { cards: await queries.cardsByIds(result.ids, "en"), result };
  }

  beforeAll(async () => {
    connection = postgres(url as string, { max: 6, onnotice: () => {} });
    const db = drizzle(connection, { schema });
    await migrate(db, { migrationsFolder: "./drizzle" });
    await connection`TRUNCATE products, brands, categories CASCADE`;
    const fixture = catalogFixtureSchema.parse(JSON.parse(await readFile("src/lib/catalog/fixtures/specimen.json", "utf8")));
    await upsertCatalog(db, fixture.products);
    retrievers = createRetrievers(connection);
    queries = createCatalogQueries(connection);
    resetSearchVocabulary();
  });

  afterAll(async () => {
    await connection?.end();
  });

  it("finds lamps for an English query and puts them first", async () => {
    const { cards, result } = await search("lamp");
    expect(cards.length).toBeGreaterThanOrEqual(7);
    expect(cards.slice(0, 5).every((card) => card.category === "lighting")).toBe(true);
    expect(result.retrieversUsed).toEqual(["fuzzy", "lexical"]);
  });

  it("finds the same products for the Greek word, through the indexed kind names", async () => {
    const { cards } = await search("φωτιστικό");
    expect(cards.length).toBeGreaterThanOrEqual(7);
    expect(cards.every((card) => card.category === "lighting")).toBe(true);
  });

  it("reads Greeklish as Greek", async () => {
    const { cards, result } = await search("fotistiko");
    expect(result.readings[0]?.readings[0]?.greek).toBe("φωτιστικο");
    expect(cards.length).toBeGreaterThan(0);
    expect(cards.every((card) => card.category === "lighting")).toBe(true);

    const sofas = await search("kanapes");
    expect(sofas.cards.length).toBeGreaterThanOrEqual(3);
    expect(sofas.cards.slice(0, 3).every((card) => card.kindLabel === "Sofa")).toBe(true);
  });

  it("corrects a swapped pair of letters, which trigrams cannot see", async () => {
    const { cards, result } = await search("chiar");
    expect(result.corrections).toEqual([{ term: "chiar", words: ["chair"] }]);
    expect(cards.slice(0, 3).every((card) => card.kindLabel === "Chair")).toBe(true);
  });

  it("forgives a misspelling through fuzzy retrieval alone", async () => {
    const { cards, result } = await search("sconse", { retrievers: { lexical: false } });
    expect(result.retrieversUsed).toEqual(["fuzzy"]);
    expect(cards[0]?.title).toMatch(/Sconce/);
  });

  it("ranks a product matching every word above ones matching some", async () => {
    const { cards } = await search("leather sofa");
    expect(cards[0]?.title).toBe("Westview Extra-Deep Down-Filled Leather Sofa Couch");
  });

  it("applies constraints written in Greek as hard filters", async () => {
    const { cards, result } = await search("δερμάτινος καναπές κάτω από 1300€");
    expect(result.filters).toMatchObject({ materials: ["leather"], categories: ["seating"], maxCents: 130_000 });
    expect(cards.map((card) => card.title)).toEqual(["Westview Extra-Deep Down-Filled Leather Sofa Couch"]);
  });

  it("treats a query of constraints alone as a filtered browse", async () => {
    const { cards, result } = await search("silver under 200");
    expect(result.retrieversUsed).toEqual(["browse"]);
    expect(cards.length).toBeGreaterThan(0);
    for (const card of cards) expect(card.price.cents).toBeLessThanOrEqual(20_000);
  });

  it("relaxes the category when it alone empties the results, and says so", async () => {
    const { cards, result } = await search("lamp", { filters: { categories: ["rugs"] } });
    expect(result.relaxed).toEqual(["categories"]);
    expect(cards.some((card) => card.category === "lighting")).toBe(true);
  });

  it("relaxes colour after category when the words match but the constraints do not, never price", async () => {
    // There are no grey chairs in the specimen catalogue.
    const { cards, result } = await search("gkri karekla");
    expect(result.query.colors).toEqual(["grey"]);
    expect(result.relaxed).toEqual(["categories", "colors"]);
    expect(cards.length).toBeGreaterThan(0);
    expect(cards.slice(0, 3).every((card) => card.kindLabel === "Chair")).toBe(true);

    const tooCheap = await search("leather sofa under 50");
    expect(tooCheap.cards).toHaveLength(0);
    expect(tooCheap.result.relaxed).toEqual([]);
  });

  it("lets a category chosen on the page replace the one read from the words", async () => {
    const { cards, result } = await search("wood", { filters: { categories: ["tables"] } });
    expect(result.filters.categories).toEqual(["tables"]);
    expect(cards.length).toBeGreaterThan(0);
    expect(cards.every((card) => card.category === "tables")).toBe(true);
  });

  it("returns nothing for a query the catalogue cannot answer, without inventing matches", async () => {
    const none = await search("xylophone");
    expect(none.cards).toHaveLength(0);
    expect(none.result.suggestions).toEqual([]);
  });

  it("never returns a product twice and keeps timings for each stage", async () => {
    const { result } = await search("modern table lamp");
    expect(new Set(result.ids).size).toBe(result.ids.length);
    expect(result.timings).toHaveProperty("lexical");
    expect(result.timings).toHaveProperty("fuzzy");
  });

  it("answers within the latency budget on the local database", async () => {
    await search("glass wall sconce");
    const started = performance.now();
    await search("glass wall sconce");
    // The plan's budget is p95 ≤ 200 ms on production; PGlite in WebAssembly is slower, so this is a generous floor.
    expect(performance.now() - started).toBeLessThan(1500);
  });
});
