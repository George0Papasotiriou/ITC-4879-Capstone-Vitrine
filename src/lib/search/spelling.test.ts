/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Unit tests for edit distance and spelling corrections.
 */

import { describe, expect, it } from "vitest";

import { allowedEdits, corrections, editDistance } from "@/lib/search/spelling";
import { trigramSimilarity } from "@/lib/search/trigram";

describe("editDistance", () => {
  it.each([
    ["chair", "chair", 0],
    ["chiar", "chair", 1], // adjacent swap
    ["lamp", "lamb", 1], // substitution
    ["sofa", "soffa", 1], // insertion
    ["table", "tabe", 1], // deletion
    ["kitten", "sitting", 3],
    ["", "abc", 3],
    ["abc", "", 3],
    ["καρεκλα", "καρελκα", 1], // Greek swap
  ])("%s → %s is %i", (a, b, expected) => {
    expect(editDistance(a, b)).toBe(expected);
    expect(editDistance(b, a)).toBe(expected);
  });

  it("counts a swap as one edit where plain Levenshtein counts two", () => {
    // The whole reason for this module: trigrams barely see the swap.
    expect(trigramSimilarity("chiar", "chair")).toBeCloseTo(0.2, 5);
    expect(editDistance("chiar", "chair")).toBe(1);
  });

  it("stops early above the ceiling and reports ceiling + 1", () => {
    expect(editDistance("wardrobe", "lamp", 2)).toBe(3);
    expect(editDistance("a", "abcdef", 1)).toBe(2);
  });

  it("satisfies the triangle inequality on a sample", () => {
    const words = ["chair", "chiar", "chairs", "stair", "char", "chain"];
    for (const a of words) {
      for (const b of words) {
        for (const c of words) {
          expect(editDistance(a, c)).toBeLessThanOrEqual(editDistance(a, b) + editDistance(b, c));
        }
      }
    }
  });
});

describe("corrections", () => {
  const vocabulary = ["chair", "chairs", "stair", "lamp", "sconce", "leather", "sofa", "table", "καρεκλα"];

  it("corrects a swapped pair of letters", () => {
    expect(corrections("chiar", vocabulary)[0]).toEqual({ word: "chair", distance: 1 });
  });

  it("allows two edits for long words and one for short words", () => {
    expect(allowedEdits("sofa")).toBe(1);
    expect(allowedEdits("leather")).toBe(2);
    expect(corrections("lether", vocabulary)[0]?.word).toBe("leather");
    expect(corrections("lethr", vocabulary)).toEqual([]);
  });

  it("never corrects words under four letters", () => {
    expect(corrections("sfa", vocabulary)).toEqual([]);
  });

  it("offers nothing for a word the vocabulary already has", () => {
    expect(corrections("chair", vocabulary)).toEqual([]);
  });

  it("offers nothing when no word is close enough", () => {
    expect(corrections("xylophone", vocabulary)).toEqual([]);
  });

  it("works in Greek", () => {
    expect(corrections("καρελκα", vocabulary)[0]?.word).toBe("καρεκλα");
  });

  it("orders words at the same distance by shared trigrams", () => {
    // "chairz" is one edit from both "chair" (delete z) and "chairs" (z → s).
    // It shares 5 of 8 trigrams with "chair" (0.625) and 5 of 9 with "chairs" (0.556).
    expect(corrections("chairz", vocabulary)).toEqual([
      { word: "chair", distance: 1 },
      { word: "chairs", distance: 1 },
    ]);
  });
});
