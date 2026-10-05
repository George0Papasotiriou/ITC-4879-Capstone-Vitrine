/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Checks on the committed clothes fixture: 124 real garments, catalogued as a shop would, each with its reviews, nothing clashing with the rest.
 */

import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { sizeChartFor } from "@/lib/catalog/capsule";
import { EXCLUDED_LISTINGS, MAX_TITLE } from "@/lib/catalog/clothes";
import { AMAZON_MEDIA_URL, catalogFixtureSchema } from "@/lib/catalog/input";
import { CAPSULE_PRODUCT_KINDS, CAPSULE_SIZES } from "@/lib/catalog/taxonomy";
import { amazonReviewsFixtureSchema } from "@/lib/reviews/amazon";

/**
 * docs/adr/062. `scripts/catalog-clothes.ts fixture` writes these from Amazon
 * Reviews 2023's listings; `pnpm db:setup` syncs them on every deploy, so
 * what this test checks is what production sells.
 */

const read = (file: string) => catalogFixtureSchema.parse(JSON.parse(readFileSync(`src/lib/catalog/fixtures/${file}`, "utf8"))).products;
const clothes = read("amazon-clothes.json");
const specimen = read("clothes-specimen.json");
const reviews = amazonReviewsFixtureSchema.parse(JSON.parse(readFileSync("src/lib/catalog/fixtures/amazon-clothes-reviews.json", "utf8"))).products;

describe("the clothes fixture", () => {
  it("holds 124 garments across the eight kinds, each once, for women and for men", () => {
    expect(clothes).toHaveLength(124);
    expect(new Set(clothes.map((product) => product.sourceId)).size).toBe(clothes.length);
    expect(new Set(clothes.map((product) => product.slug)).size).toBe(clothes.length);
    const kinds = new Set(clothes.map((product) => product.kind));
    expect([...kinds].sort()).toEqual(["COAT", "DRESS", "JACKET", "KNIT", "SHIRT", "SKIRT", "TOP", "TROUSERS"]);
    const men = clothes.filter((product) => product.attributes.department === "men").length;
    expect(men).toBeGreaterThan(30);
    expect(clothes.length - men).toBeGreaterThan(60);
    for (const product of clothes) expect(["women", "men"]).toContain(product.attributes.department);
  });

  it("never clashes with the furniture or the wearables synced beside it, and holds none refused by eye", () => {
    const others = [...read("abo.json"), ...read("abo-wear.json")];
    const slugs = new Set(others.map((product) => product.slug));
    expect(clothes.filter((product) => slugs.has(product.slug))).toEqual([]);
    for (const product of clothes) expect(EXCLUDED_LISTINGS.has(product.sourceId), product.slug).toBe(false);
  });

  it("files every garment under Clothing, in a kind with a size chart, sized XS–XL with stock that adds up, at a price in its band", () => {
    for (const product of clothes) {
      expect(product.source).toBe("amazon");
      expect(product.category).toBe("wear");
      expect(sizeChartFor(product.kind), product.slug).not.toBeNull();
      expect((product.variants ?? []).map((variant) => variant.size)).toEqual([...CAPSULE_SIZES]);
      expect(product.stock).toBe((product.variants ?? []).reduce((sum, variant) => sum + variant.stock, 0));
      const band = CAPSULE_PRODUCT_KINDS[product.kind]!.bands;
      expect(product.priceCents, product.slug).toBeGreaterThanOrEqual(band.minCents - 100);
      expect(product.priceCents, product.slug).toBeLessThanOrEqual(band.maxCents);
    }
  });

  it("shows each garment in at least three of its listing's photographs, the first checked on white", () => {
    for (const product of clothes) {
      expect(product.media.length, product.slug).toBeGreaterThanOrEqual(3);
      expect(product.media[0]!.whiteGround, product.slug).toBe(true);
      for (const image of product.media) expect(AMAZON_MEDIA_URL.test(image.src), image.src).toBe(true);
    }
  });

  it("prints names a shop would, short enough for a tile", () => {
    for (const product of clothes) {
      expect(product.titleEn.length, product.slug).toBeLessThanOrEqual(MAX_TITLE);
      expect(product.titleEn, product.slug).not.toMatch(/\b(wom[ae]n'?s?|men'?s|for (wo)?men|pack|multipack|amazon)\b|[[\]()【】,|]/i);
      if (product.brand !== null) expect(product.titleEn.toLowerCase().startsWith(product.brand.toLowerCase()), product.slug).toBe(false);
    }
  });

  it("credits the dataset, and has reviews of every garment, with no reviewer named", () => {
    for (const product of clothes) {
      expect(product.attribution).toMatch(/Amazon Reviews 2023/);
      const entry = reviews[product.sourceId];
      expect(entry, product.slug).toBeDefined();
      expect(entry!.count).toBeGreaterThanOrEqual(20);
      expect(entry!.reviews.length).toBeGreaterThanOrEqual(3);
      expect(entry!.reviews.length).toBeLessThanOrEqual(8);
    }
    expect(readFileSync("src/lib/catalog/fixtures/amazon-clothes-reviews.json", "utf8")).not.toMatch(/"user_id"|"userId"|"author"|"name"\s*:/);
  });
});

describe("the clothes specimen the local stack and tests seed", () => {
  it("is twelve garments of the fixture, every kind and a men's shirt among them, with their photographs in public/", () => {
    expect(specimen).toHaveLength(12);
    const ids = new Set(clothes.map((product) => product.sourceId));
    expect(new Set(specimen.map((product) => product.kind)).size).toBe(8);
    expect(specimen.some((product) => product.kind === "SHIRT" && product.attributes.department === "men")).toBe(true);
    for (const product of specimen) {
      expect(ids.has(product.sourceId), product.slug).toBe(true);
      for (const image of product.media) {
        expect(image.src, product.slug).toMatch(/^\/products\/clothes\/[a-z0-9-]+\.webp$/);
        expect(existsSync(`public${image.src}`), image.src).toBe(true);
      }
    }
  });
});
