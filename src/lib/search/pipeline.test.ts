/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Tests for query expansion: Greek piece names searched in English too, Greeklish and misspellings as before.
 */

import { describe, expect, it } from "vitest";

import { expandTerms } from "@/lib/search/pipeline";
import { TrigramIndex } from "@/lib/search/trigram";

/** A catalogue whose words are English, as most titles are. */
const WORDS = ["armchair", "chair", "lamp", "bookcase", "sofa", "leather", "black", "καναπεσ"];
const vocabulary = { index: new TrigramIndex(WORDS), words: new Set(WORDS) };

describe("expandTerms", () => {
  it("searches a Greek piece name by its English names too, and says so (docs/adr/047)", () => {
    const expanded = expandTerms(["πολυθρονα"], vocabulary);
    expect(expanded.terms).toEqual(["πολυθρονα", "armchair"]);
    expect(expanded.translations).toEqual([{ term: "πολυθρονα", words: ["armchair"] }]);
    expect(expanded.corrections).toEqual([]);
  });

  it("keeps the Greek word, so products described in Greek are still found", () => {
    const expanded = expandTerms(["καναπεσ"], vocabulary);
    expect(expanded.terms).toEqual(["καναπεσ", "sofa", "couch"]);
  });

  it("adds an English name once, however many Greek words ask for it", () => {
    expect(expandTerms(["λαμπα", "φωτιστικο"], vocabulary).terms).toEqual(["λαμπα", "lamp", "φωτιστικο"]);
  });

  it("leaves other words to Greeklish and spelling, as before", () => {
    const expanded = expandTerms(["chiar", "leather"], vocabulary);
    expect(expanded.translations).toEqual([]);
    expect(expanded.corrections).toEqual([{ term: "chiar", words: ["chair"] }]);
    expect(expanded.terms).toEqual(["chiar", "chair", "leather"]);
  });
});
