/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Unit tests for the controlled search vocabulary.
 */

import { describe, expect, it } from "vitest";

import { CATEGORIES } from "@/lib/catalog/taxonomy";
import {
  CATEGORY_TERMS,
  colorLabel,
  COLORS,
  extractTerms,
  lookup,
  materialLabel,
  MATERIALS,
} from "@/lib/search/vocabulary";

describe("extractTerms on catalogue text", () => {
  it("maps source colour names onto canonical ids", () => {
    expect(extractTerms("Light Blue", COLORS, { greeklish: false })).toEqual(["blue"]);
    expect(extractTerms("Espresso", COLORS, { greeklish: false })).toEqual(["brown"]);
    expect(extractTerms("Charcoal Gray / Ivory", COLORS, { greeklish: false })).toEqual(["grey", "beige"]);
  });

  it("maps source materials, including several in one field", () => {
    expect(extractTerms("Solid Oak, Powder-Coated Steel", MATERIALS, { greeklish: false })).toEqual(["oak", "metal"]);
    expect(extractTerms("LeatherSoft", MATERIALS, { greeklish: false })).toEqual(["leather"]);
  });

  it("never reads an English word as Greeklish when Greeklish is off", () => {
    // "kafe" is Greeklish for brown; with Greeklish off, a Latin word must be English to count.
    expect(extractTerms("kafe", COLORS, { greeklish: false })).toEqual([]);
    expect(extractTerms("kafe", COLORS)).toEqual(["brown"]);
  });

  it("returns nothing for text without dictionary words", () => {
    expect(extractTerms("Mid-century lounge", COLORS)).toEqual([]);
  });
});

describe("lookup", () => {
  it("matches Greek inflections by stem and indeclinable words exactly", () => {
    expect(lookup("μαυρεσ", COLORS)).toBe("black");
    expect(lookup("γκρι", COLORS)).toBe("grey");
    expect(lookup("ραφια", CATEGORY_TERMS)).toBe("storage");
  });

  it("does not treat light as a lighting word, since it usually describes a colour", () => {
    expect(lookup("light", CATEGORY_TERMS)).toBeNull();
    expect(lookup("lamps", CATEGORY_TERMS)).toBe("lighting");
  });
});

describe("the vocabulary as a whole", () => {
  it("names every catalogue category", () => {
    for (const category of CATEGORIES) {
      expect(CATEGORY_TERMS[category.slug].english.length, category.slug).toBeGreaterThan(0);
    }
  });

  it("keeps Greek stems at four letters or more, so they cannot match unrelated words", () => {
    for (const dictionary of [COLORS, MATERIALS, CATEGORY_TERMS]) {
      for (const [id, entry] of Object.entries(dictionary)) {
        for (const stem of entry.greekStems) expect(stem.length, `${id}: ${stem}`).toBeGreaterThanOrEqual(4);
      }
    }
  });

  it("stores Greek already folded, as the tokens it is compared with are", () => {
    for (const dictionary of [COLORS, MATERIALS, CATEGORY_TERMS]) {
      for (const entry of Object.values(dictionary)) {
        const greek: readonly string[] = [...entry.greekStems, ...(("greekWords" in entry ? entry.greekWords : undefined) ?? [])];
        for (const word of greek) expect(word).toMatch(/^[α-ω]+$/u);
        for (const word of greek) expect(word).not.toContain("ς");
      }
    }
  });

  it("has no English word that means two things within one dictionary", () => {
    for (const dictionary of [COLORS, MATERIALS, CATEGORY_TERMS]) {
      const seen = new Map<string, string>();
      for (const [id, entry] of Object.entries(dictionary)) {
        for (const word of entry.english) {
          expect(seen.get(word), `${word} in ${id} and ${seen.get(word)}`).toBeUndefined();
          seen.set(word, id);
        }
      }
    }
  });

  it("labels colours and materials in both languages", () => {
    expect(colorLabel("black", "el")).toBe("Μαύρο");
    expect(colorLabel("black", "en")).toBe("Black");
    expect(materialLabel("oak", "el")).toBe("Δρυς");
    expect(materialLabel("unknown", "en")).toBe("unknown");
  });
});
