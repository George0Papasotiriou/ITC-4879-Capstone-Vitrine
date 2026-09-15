/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Unit tests for product content vectors.
 */

import { describe, expect, it } from "vitest";

import { contentVector, dot, SIMILARITY_WEIGHTS, STYLE_WEIGHTS, VECTOR_LENGTH, type ProductFeatures } from "@/lib/reco/content-vector";

const base: ProductFeatures = {
  category: "seating",
  kind: "SOFA",
  colors: ["grey"],
  materials: ["velvet"],
  brand: "Rivet",
  attributes: { style: "Mid-Century Modern" },
  priceCents: 129_900,
};

const vec = (overrides: Partial<ProductFeatures>, weights = SIMILARITY_WEIGHTS) => contentVector({ ...base, ...overrides }, weights);

describe("contentVector", () => {
  it("is unit length and of fixed size", () => {
    const v = vec({});
    expect(v.length).toBe(VECTOR_LENGTH);
    expect(dot(v, v)).toBeCloseTo(1, 12);
  });

  it("is deterministic", () => {
    expect([...vec({})]).toEqual([...vec({})]);
  });

  it("scores a near-identical product above one that shares only the category", () => {
    const same = dot(vec({}), vec({ colors: ["grey", "white"] }));
    const sameCategory = dot(vec({}), vec({ kind: "CHAIR", colors: ["red"], materials: ["wood"], brand: "Other", attributes: {} }));
    const different = dot(vec({}), vec({ category: "lighting", kind: "LAMP", colors: ["gold"], materials: ["metal"], brand: "Other", attributes: {}, priceCents: 4_900 }));
    expect(same).toBeGreaterThan(sameCategory);
    expect(sameCategory).toBeGreaterThan(different);
  });

  it("brings price levels closer the closer the prices are on a log scale", () => {
    const priceOnly = { ...STYLE_WEIGHTS, colors: 0, materials: 0, style: 0, brand: 0 };
    const at = (cents: number) => contentVector({ ...base, priceCents: cents }, priceOnly);
    expect(dot(at(8_000), at(12_000))).toBeGreaterThan(dot(at(8_000), at(120_000)));
    expect(dot(at(8_000), at(8_000))).toBeCloseTo(1, 12);
  });

  it("ignores category and kind in the style weighting, so a sofa can go with a rug", () => {
    const sofa = contentVector(base, STYLE_WEIGHTS);
    const rug = contentVector({ ...base, category: "rugs", kind: "RUG" }, STYLE_WEIGHTS);
    expect(dot(sofa, rug)).toBeCloseTo(1, 12);
  });

  it("uses style words from attributes, so two mid-century pieces are closer than a mid-century and a farmhouse piece", () => {
    const styleOnly = { ...STYLE_WEIGHTS, colors: 0, materials: 0, brand: 0, price: 0 };
    const mid = contentVector({ ...base, attributes: { style: "Mid-Century Modern" } }, styleOnly);
    const alsoMid = contentVector({ ...base, attributes: { style: "Modern mid-century" } }, styleOnly);
    const farmhouse = contentVector({ ...base, attributes: { style: "Rustic Farmhouse" } }, styleOnly);
    expect(dot(mid, alsoMid)).toBeGreaterThan(dot(mid, farmhouse));
  });

  it("handles products with no colours, materials, brand or attributes", () => {
    const bare = contentVector({ ...base, colors: [], materials: [], brand: null, attributes: {} }, STYLE_WEIGHTS);
    expect(dot(bare, bare)).toBeCloseTo(1, 12);
  });
});
