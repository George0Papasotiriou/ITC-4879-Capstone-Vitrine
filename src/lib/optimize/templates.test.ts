/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Unit tests for Budget Stylist templates and compatibility scores.
 */

import { describe, expect, it } from "vitest";

import { ABO_PRODUCT_KINDS } from "@/lib/catalog/taxonomy";
import { affinity, compatibility, strongestPair, type StylistCandidate } from "@/lib/optimize/compatibility";
import { fitsSize, isTemplateId, TEMPLATE_IDS, TEMPLATES } from "@/lib/optimize/templates";
import { contentVector, STYLE_WEIGHTS } from "@/lib/reco/content-vector";

describe("templates", () => {
  it("only name product kinds the catalogue sells", () => {
    for (const id of TEMPLATE_IDS) {
      for (const slot of TEMPLATES[id].slots) {
        for (const kind of slot.kinds) expect(ABO_PRODUCT_KINDS[kind], `${id}/${slot.id}: ${kind}`).toBeDefined();
        expect(slot.quantity).toBeGreaterThanOrEqual(1);
      }
      expect(TEMPLATES[id].slots.some((slot) => slot.required), id).toBe(true);
      expect(new Set(TEMPLATES[id].slots.map((slot) => slot.id)).size).toBe(TEMPLATES[id].slots.length);
    }
  });

  it("recognises template ids", () => {
    expect(isTemplateId("reading-corner")).toBe(true);
    expect(isTemplateId("outfit")).toBe(false);
  });
});

describe("fitsSize", () => {
  it("passes anything when no limit applies, including unknown dimensions", () => {
    expect(fitsSize(null, [])).toBe(true);
    expect(fitsSize(null, [undefined, {}])).toBe(true);
  });

  it("refuses unknown dimensions once a limit applies", () => {
    expect(fitsSize(null, [{ maxWidthCm: 80 }])).toBe(false);
  });

  it("applies the template's and the shopper's limits together", () => {
    const table = { w: 70, d: 45, h: 55 };
    expect(fitsSize(table, [{ maxWidthCm: 75 }])).toBe(true);
    expect(fitsSize(table, [{ maxWidthCm: 75 }, { maxWidthCm: 60 }])).toBe(false);
    expect(fitsSize(table, [{ minWidthCm: 90 }])).toBe(false);
    expect(fitsSize(table, [{ maxHeightCm: 60, maxDepthCm: 50 }])).toBe(true);
  });
});

describe("scores", () => {
  const candidate = (colors: string[], style: string, materials: string[]): StylistCandidate => ({
    id: `${colors.join("-")}-${style}`,
    priceCents: 20_000,
    affinity: 1,
    colors,
    styleVector: contentVector(
      { category: "seating", kind: "CHAIR", colors, materials, brand: null, attributes: { style }, priceCents: 20_000 },
      STYLE_WEIGHTS,
    ),
  });

  it("weights affinity parts and clamps them", () => {
    expect(affinity({ relevance: 1, taste: 0, rating: 0 })).toBe(1);
    expect(affinity({ relevance: 2, taste: -1, rating: 1 })).toBe(1.5);
  });

  it("is symmetric and bounded to [-0.4, 1]", () => {
    const a = candidate(["red"], "Modern", ["metal"]);
    const b = candidate(["green"], "Rustic Farmhouse", ["wood"]);
    expect(compatibility(a, b)).toBeCloseTo(compatibility(b, a), 12);
    for (const [x, y] of [[a, b], [a, a], [b, b]] as const) {
      expect(compatibility(x, y)).toBeGreaterThanOrEqual(-0.4);
      expect(compatibility(x, y)).toBeLessThanOrEqual(1 + 1e-12);
    }
  });

  it("prefers matching material and style with harmonious colours over a clash", () => {
    const greyVelvet = candidate(["grey"], "Mid-Century Modern", ["velvet"]);
    const blueVelvet = candidate(["blue"], "Mid-Century Modern", ["velvet"]);
    const redWood = candidate(["red"], "Rustic Farmhouse", ["wood"]);
    const greenMetal = candidate(["green"], "Industrial", ["metal"]);
    expect(compatibility(greyVelvet, blueVelvet)).toBeGreaterThan(compatibility(redWood, greenMetal));
  });

  it("names the strongest pairing in a bundle", () => {
    const a = candidate(["grey"], "Mid-Century Modern", ["velvet"]);
    const b = candidate(["grey"], "Mid-Century Modern", ["velvet"]);
    const c = candidate(["red"], "Industrial", ["metal"]);
    const pair = strongestPair([a, c, { ...b, id: "twin" }]);
    expect([pair?.first, pair?.second].sort()).toEqual([a.id, "twin"].sort());
    expect(strongestPair([a])).toBeNull();
  });
});
