/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Integration tests for the Budget Stylist against PostgreSQL.
 */

import { readFile } from "node:fs/promises";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { catalogFixtureSchema, type ProductInput } from "@/lib/catalog/input";
import { upsertCatalog } from "@/lib/catalog/write";
import * as schema from "@/lib/db/schema";
import { resetSearchVocabulary } from "@/lib/search/pipeline";
import { createRetrievers } from "@/lib/search/retrieve";
import { createStylist, type Stylist } from "@/lib/stylist/stylist";
import { localizeCents } from "@/lib/commerce/vat";

/**
 * The Budget Stylist against the specimen catalogue: real prices, stock and
 * dimensions from the database, and every hard constraint checked on the result.
 */

const url = process.env.DATABASE_URL;

describe.skipIf(url === undefined || url === "")("budget stylist", () => {
  let connection: ReturnType<typeof postgres>;
  let stylist: Stylist;
  let products: Map<string, ProductInput & { id: string }>;

  beforeAll(async () => {
    connection = postgres(url as string, { max: 6, onnotice: () => {} });
    const db = drizzle(connection, { schema });
    await migrate(db, { migrationsFolder: "./drizzle" });
    await connection`TRUNCATE products, brands, categories CASCADE`;
    const fixture = catalogFixtureSchema.parse(JSON.parse(await readFile("src/lib/catalog/fixtures/specimen.json", "utf8"))).products;
    await upsertCatalog(db, fixture);
    const ids = await connection<{ id: string; source_id: string }[]>`SELECT id, source_id FROM products`;
    products = new Map(ids.map((row) => [row.id, { ...fixture.find((product) => product.sourceId === row.source_id)!, id: row.id }]));
    stylist = createStylist(connection, createRetrievers(connection));
    resetSearchVocabulary();
  });

  afterAll(async () => {
    await connection?.end();
  });

  it("keeps a German budget in German prices", async () => {
    const result = await stylist.build({ template: "reading-corner", budgetCents: 150_000 }, { country: "DE" });
    expect(result.bundles.length).toBeGreaterThan(0);
    for (const bundle of result.bundles) {
      expect(bundle.totalCents).toBeLessThanOrEqual(150_000);
      for (const pick of bundle.picks) {
        const product = products.get(pick.productId)!;
        expect(pick.unitPriceCents).toBe(localizeCents(product.priceCents, "DE"));
        expect(pick.lineTotalCents).toBe(pick.unitPriceCents * pick.quantity);
      }
    }
  });

  it("builds three different reading corners within budget, each with a chair, a lamp and a side table", async () => {
    const result = await stylist.build({ template: "reading-corner", budgetCents: 150_000 });
    expect(result.missingRequired).toEqual([]);
    expect(result.bundles).toHaveLength(3);

    for (const bundle of result.bundles) {
      expect(bundle.totalCents).toBeLessThanOrEqual(150_000);
      expect(bundle.remainingCents).toBe(150_000 - bundle.totalCents);
      const slots = bundle.picks.map((pick) => pick.slotId);
      expect(slots).toEqual(expect.arrayContaining(["chair", "lamp", "side-table"]));
      expect(bundle.totalCents).toBe(bundle.picks.reduce((sum, pick) => sum + pick.lineTotalCents, 0));

      for (const pick of bundle.picks) {
        const product = products.get(pick.productId)!;
        expect(pick.unitPriceCents).toBe(product.priceCents);
        expect(product.stock).toBeGreaterThanOrEqual(pick.quantity);
        if (pick.slotId === "chair") expect(product.kind).toBe("CHAIR");
        if (pick.slotId === "lamp") expect(product.kind).toBe("LAMP");
        if (pick.slotId === "side-table") {
          expect(product.kind).toBe("TABLE");
          expect(product.dimsCm!.w).toBeLessThanOrEqual(75);
        }
      }
    }
    expect(result.stats.exact).toBe(true);
  });

  it("multiplies a slot's quantity into its price: four dining chairs", async () => {
    const result = await stylist.build({ template: "dining", budgetCents: 500_000 });
    const chairs = result.bundles[0]!.picks.find((pick) => pick.slotId === "chairs")!;
    expect(chairs.quantity).toBe(4);
    expect(chairs.lineTotalCents).toBe(chairs.unitPriceCents * 4);
  });

  it("never picks a product in an avoided colour", async () => {
    const result = await stylist.build({ template: "living-room", budgetCents: 400_000, avoidColors: ["grey"] });
    for (const bundle of result.bundles) {
      for (const pick of bundle.picks) expect(products.get(pick.productId)!.colors).not.toContain("grey");
    }
  });

  it("respects a measured width limit for every piece, excluding unmeasured ones", async () => {
    const result = await stylist.build({ template: "reading-corner", budgetCents: 200_000, maxWidthCm: 60 });
    for (const bundle of result.bundles) {
      for (const pick of bundle.picks) {
        const dims = products.get(pick.productId)!.dimsCm;
        expect(dims).not.toBeNull();
        expect(dims!.w).toBeLessThanOrEqual(60);
      }
    }
  });

  it("says which required slot has nothing to offer instead of returning an empty page silently", async () => {
    const bedroom = await stylist.build({ template: "bedroom", budgetCents: 300_000 });
    expect(bedroom.bundles).toEqual([]);
    expect(bedroom.missingRequired).toEqual(["bed"]);

    const tooCheap = await stylist.build({ template: "living-room", budgetCents: 5_000 });
    expect(tooCheap.bundles).toEqual([]);
    expect(tooCheap.missingRequired).toContain("sofa");
  });

  it("uses the words of the request, through hybrid search", async () => {
    const plain = await stylist.build({ template: "reading-corner", budgetCents: 200_000 });
    const worded = await stylist.build({ template: "reading-corner", budgetCents: 200_000, query: "leather dining chair" });
    const chairOf = (result: typeof plain) => products.get(result.bundles[0]!.picks.find((pick) => pick.slotId === "chair")!.productId)!;
    expect(chairOf(worded).titleEn).toMatch(/Leather Dining Chair/);
    expect(plain.bundles.length).toBeGreaterThan(0);
  });

  it("offers swaps for one slot that stay within budget", async () => {
    const request = { template: "reading-corner", budgetCents: 150_000 };
    const result = await stylist.build(request);
    const swaps = await stylist.swaps(request, 0, "lamp");
    expect(swaps.length).toBeGreaterThan(0);
    const current = result.bundles[0]!.picks.find((pick) => pick.slotId === "lamp")!.productId;
    for (const swap of swaps) {
      expect(swap.productId).not.toBe(current);
      expect(swap.bundleTotalCents).toBeLessThanOrEqual(150_000);
    }
  });

  it("rejects malformed requests", async () => {
    await expect(stylist.build({ template: "outfit", budgetCents: 10_000 })).rejects.toThrow();
    await expect(stylist.build({ template: "reading-corner", budgetCents: 12.5 })).rejects.toThrow();
    await expect(stylist.build({ template: "reading-corner", budgetCents: 50_000, avoidColors: ["neon"] })).rejects.toThrow();
  });
});
