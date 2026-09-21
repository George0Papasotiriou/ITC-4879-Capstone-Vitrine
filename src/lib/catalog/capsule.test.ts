/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Tests for the Wear capsule: its pieces, the stock of each size, the size chart, and the drawings.
 */

import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { CAPSULE, CAPSULE_COLOURS, capsuleSizes, capsuleStock, sizeChartFor, suggestSize } from "@/lib/catalog/capsule";
import { garmentSvg } from "@/lib/catalog/capsule-drawing";
import { catalogFixtureSchema } from "@/lib/catalog/input";
import { CAPSULE_PRODUCT_KINDS, CAPSULE_SIZES } from "@/lib/catalog/taxonomy";

describe("the capsule", () => {
  it("is twenty-four pieces, each with an id nothing else uses", () => {
    expect(CAPSULE).toHaveLength(24);
    expect(new Set(CAPSULE.map((piece) => piece.id)).size).toBe(24);
  });

  it("is written in both languages, in a kind and a colour the shop knows", () => {
    for (const piece of CAPSULE) {
      expect(CAPSULE_PRODUCT_KINDS[piece.kind], piece.id).toBeDefined();
      expect(CAPSULE_COLOURS[piece.color], piece.id).toBeDefined();
      expect(piece.titleEl.length, piece.id).toBeGreaterThan(2);
      expect(piece.fabricEl.length, piece.id).toBeGreaterThan(2);
      expect(piece.careEl.length, piece.id).toBeGreaterThan(2);
      expect(piece.compareAtCents === null || piece.compareAtCents > piece.priceCents, piece.id).toBe(true);
    }
  });

  it("covers every kind the capsule names", () => {
    const kinds = new Set(CAPSULE.map((piece) => piece.kind));
    expect([...kinds].sort()).toEqual(Object.keys(CAPSULE_PRODUCT_KINDS).sort());
  });
});

describe("stock per size", () => {
  it("is the same on every run", () => {
    expect(capsuleStock("poplin-shirt-ecru", "M")).toBe(capsuleStock("poplin-shirt-ecru", "M"));
    expect(capsuleStock("poplin-shirt-ecru", "M")).not.toBe(capsuleStock("linen-shirt-oat", "M"));
  });

  it("gives every piece five sizes, and leaves something to buy", () => {
    for (const piece of CAPSULE) {
      const sizes = capsuleSizes(piece.id);
      expect(sizes.map((size) => size.size)).toEqual([...CAPSULE_SIZES]);
      expect(sizes.some((size) => size.stock > 0), piece.id).toBe(true);
      for (const size of sizes) expect(size.stock).toBeLessThanOrEqual(14);
    }
  });

  it("sells a few sizes out, so the size picker has something to say", () => {
    const soldOut = CAPSULE.flatMap((piece) => capsuleSizes(piece.id)).filter((size) => size.stock === 0);
    expect(soldOut.length).toBeGreaterThan(2);
  });
});

describe("the size chart", () => {
  it("covers the kinds that are worn, and nothing else", () => {
    expect(sizeChartFor("SHIRT")).not.toBeNull();
    expect(sizeChartFor("TROUSERS")).not.toBeNull();
    expect(sizeChartFor("DRESS")).not.toBeNull();
    expect(sizeChartFor("SOFA")).toBeNull();
  });

  it("grows with the size, measurement by measurement", () => {
    for (const kind of Object.keys(CAPSULE_PRODUCT_KINDS)) {
      for (const row of sizeChartFor(kind)!) {
        const values = CAPSULE_SIZES.map((size) => row.values[size]);
        expect(values, `${kind} ${row.measure.en}`).toEqual([...values].sort((a, b) => a - b));
      }
    }
  });

  it("suggests the smallest size that fits, and says when a body is past the chart", () => {
    expect(suggestSize("SHIRT", 84)).toEqual({ size: "XS", beyondChart: false });
    expect(suggestSize("SHIRT", 92)).toEqual({ size: "S", beyondChart: false });
    expect(suggestSize("SHIRT", 99)).toEqual({ size: "L", beyondChart: false });
    expect(suggestSize("SHIRT", 130)).toEqual({ size: "XL", beyondChart: true });
    expect(suggestSize("RUG", 92)).toBeNull();
  });
});

describe("the drawings", () => {
  it("draw every piece on a white ground, with nothing undefined in the path", () => {
    for (const piece of CAPSULE) {
      for (const view of ["flat", "folded"] as const) {
        const svg = garmentSvg(piece, view);
        expect(svg.startsWith("<svg"), piece.id).toBe(true);
        expect(svg).toContain('fill="#ffffff"');
        expect(svg, `${piece.id} ${view}`).not.toContain("NaN");
        expect(svg, `${piece.id} ${view}`).not.toContain("undefined");
        // The fabric's colour is what the piece is drawn in.
        expect(svg).toContain(CAPSULE_COLOURS[piece.color]!.fill);
      }
    }
  });

  it("gives each kind its own shape", () => {
    const shirt = garmentSvg({ kind: "SHIRT", color: "ecru", titleEn: "Shirt" });
    const trousers = garmentSvg({ kind: "TROUSERS", color: "ecru", titleEn: "Trousers" });
    expect(shirt).not.toBe(trousers);
  });
});

describe("the fixture on disk", () => {
  const file = "src/lib/catalog/fixtures/capsule.json";

  it("is a catalogue fixture with one product per piece, in five sizes", () => {
    const fixture = catalogFixtureSchema.parse(JSON.parse(readFileSync(file, "utf8")));
    expect(fixture.products).toHaveLength(CAPSULE.length);
    for (const product of fixture.products) {
      expect(product.source).toBe("capsule");
      expect(product.category).toBe("wear");
      expect(product.variants, product.slug).toHaveLength(CAPSULE_SIZES.length);
      expect(product.stock, product.slug).toBe(product.variants!.reduce((sum, variant) => sum + variant.stock, 0));
      // A garment is not placed in a room, so it carries no dimensions.
      expect(product.dimsCm).toBeNull();
    }
  });

  it("names images that are really there", () => {
    const fixture = catalogFixtureSchema.parse(JSON.parse(readFileSync(file, "utf8")));
    for (const product of fixture.products) {
      for (const media of product.media) {
        expect(existsSync(`public${media.src}`), media.src).toBe(true);
      }
    }
  });

  it("says in both languages that the images are drawings", () => {
    const fixture = catalogFixtureSchema.parse(JSON.parse(readFileSync(file, "utf8")));
    for (const product of fixture.products) {
      expect(product.highlightsEn.some((line) => line.includes("drawings")), product.slug).toBe(true);
      expect(product.highlightsEl!.some((line) => line.includes("σχέδια")), product.slug).toBe(true);
    }
  });
});
