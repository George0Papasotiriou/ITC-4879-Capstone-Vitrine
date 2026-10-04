/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Checks on the committed wearables fixture: enough pieces, catalogued as a shop would, and nothing that clashes with the rest of the catalogue.
 */

import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { catalogFixtureSchema } from "@/lib/catalog/input";
import { ABO_PRODUCT_KINDS, WEAR_CATEGORIES } from "@/lib/catalog/taxonomy";
import { HAT_SIZES, ONE_SIZE, SHOE_SIZES } from "@/lib/catalog/wear";

/**
 * docs/adr/061. `pnpm catalog wear-fixture` writes these from ABO; this test
 * is what any later run of it has to keep true, since `pnpm db:setup` syncs
 * the file into production on every deploy.
 */

const read = (file: string) => catalogFixtureSchema.parse(JSON.parse(readFileSync(`src/lib/catalog/fixtures/${file}`, "utf8"))).products;
const wear = read("abo-wear.json");
const specimen = read("wear-specimen.json");
const SHOE_KINDS = new Set(["SHOES", "BOOT", "SANDAL"]);

describe("the wearables fixture", () => {
  it("holds at least 300 pieces, each once", () => {
    expect(wear.length).toBeGreaterThanOrEqual(300);
    expect(new Set(wear.map((product) => product.sourceId)).size).toBe(wear.length);
    expect(new Set(wear.map((product) => product.slug)).size).toBe(wear.length);
  });

  it("never clashes with the furniture catalogue it is synced beside", () => {
    const furniture = read("abo.json");
    const slugs = new Set(furniture.map((product) => product.slug));
    const ids = new Set(furniture.map((product) => product.sourceId));
    expect(wear.filter((product) => slugs.has(product.slug) || ids.has(product.sourceId))).toEqual([]);
  });

  it("files every piece under a wear category, as its kind says, at a price inside the kind's band", () => {
    for (const product of wear) {
      const kind = ABO_PRODUCT_KINDS[product.kind];
      expect(kind, product.kind).toBeDefined();
      expect(WEAR_CATEGORIES.has(product.category), product.slug).toBe(true);
      expect(product.category).toBe(kind!.category);
      expect(product.priceCents, product.slug).toBeGreaterThanOrEqual(kind!.bands.minCents - 100);
      expect(product.priceCents, product.slug).toBeLessThanOrEqual(kind!.bands.maxCents);
    }
  });

  it("shows each piece in at least two photographs, the first on a white studio ground", () => {
    for (const product of wear) {
      expect(product.media.length, product.slug).toBeGreaterThanOrEqual(2);
      expect(product.media[0]!.whiteGround, product.slug).toBe(true);
      expect(product.media.every((image) => image.altEn !== null && image.altEn !== ""), product.slug).toBe(true);
    }
  });

  it("sells shoes in EU sizes, hats in S/M/L or one size, the rest in one size, with stock that adds up", () => {
    for (const product of wear) {
      const sizes = (product.variants ?? []).map((variant) => variant.size);
      if (SHOE_KINDS.has(product.kind)) expect(Object.values(SHOE_SIZES).map((list) => list.join())).toContain(sizes.join());
      else if (product.kind === "HAT") expect([HAT_SIZES.join(), ONE_SIZE]).toContain(sizes.join());
      else expect(sizes).toEqual([ONE_SIZE]);
      expect(product.stock).toBe((product.variants ?? []).reduce((sum, variant) => sum + variant.stock, 0));
    }
  });

  it("prints titles a shop would: no retailer prefixes, codes, underscores or sizes", () => {
    for (const product of wear) {
      expect(product.titleEn, product.slug).not.toMatch(/amazon|_|#|\b(US|UK|EU)\s?\d|\bsize\b/i);
      expect(product.titleEn.length, product.slug).toBeLessThanOrEqual(90);
      if (product.brand !== null) expect(product.titleEn.toLowerCase().startsWith(product.brand.toLowerCase()), product.slug).toBe(false);
    }
  });

  it("credits ABO under its licence", () => {
    for (const product of wear) {
      expect(product.license).toBe("CC BY 4.0");
      expect(product.attribution).toMatch(/Amazon Berkeley Objects/);
    }
  });
});

describe("the wear specimen the local stack and tests seed", () => {
  it("is twelve pieces of the fixture, with their photographs in public/", () => {
    expect(specimen).toHaveLength(12);
    const ids = new Set(wear.map((product) => product.sourceId));
    for (const product of specimen) {
      expect(ids.has(product.sourceId), product.slug).toBe(true);
      for (const image of product.media) {
        expect(image.src, product.slug).toMatch(/^\/products\/wear\/[a-z0-9-]+\.webp$/);
        expect(existsSync(`public${image.src}`), image.src).toBe(true);
      }
    }
  });
});
