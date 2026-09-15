/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Unit tests for trigram similarity and the trigram index.
 */

import { describe, expect, it } from "vitest";

import { TrigramIndex, trigramSimilarity, trigrams } from "@/lib/search/trigram";

describe("trigrams", () => {
  it("pads each word with two spaces in front and one behind", () => {
    expect([...trigrams("cat")].sort()).toEqual(["  c", " ca", "at ", "cat"].sort());
  });

  it("gives a one-letter word two trigrams", () => {
    expect([...trigrams("a")].sort()).toEqual(["  a", " a "].sort());
  });

  it("collects the trigrams of every word into one set", () => {
    const set = trigrams("oak oak");
    // The repeated word adds nothing: it is a set.
    expect(set).toEqual(trigrams("oak"));
  });

  it("counts a Greek letter as one character, not two UTF-16 units", () => {
    expect([...trigrams("χαλι")].sort()).toEqual(["  χ", " χα", "χαλ", "αλι", "λι "].sort());
  });

  it("normalises before splitting, so case and accents do not matter", () => {
    expect(trigrams("Χαλί")).toEqual(trigrams("χαλι"));
  });
});

describe("trigramSimilarity", () => {
  it("reproduces the worked example in the module comment", () => {
    expect(trigramSimilarity("chair", "chiar")).toBeCloseTo(2 / 10, 10);
  });

  it("is 1 for identical text and 0 for nothing in common", () => {
    expect(trigramSimilarity("lamp", "lamp")).toBe(1);
    expect(trigramSimilarity("lamp", "rug")).toBe(0);
  });

  it("is symmetric", () => {
    expect(trigramSimilarity("walnut", "wallnut")).toBe(trigramSimilarity("wallnut", "walnut"));
  });

  it("ranks a one-letter typo above an unrelated word", () => {
    expect(trigramSimilarity("sofa", "soffa")).toBeGreaterThan(trigramSimilarity("sofa", "stool"));
  });

  it("is 0 for two empty strings rather than dividing by zero", () => {
    expect(trigramSimilarity("", "")).toBe(0);
  });
});

describe("TrigramIndex", () => {
  const index = new TrigramIndex(["καρεκλα", "καναπεσ", "κουρτινα", "lamp", "lampshade", "rug"]);

  it("finds the intended word behind a misspelling", () => {
    expect(index.similar("καρεκλλα")[0]?.term).toBe("καρεκλα");
  });

  it("orders matches by similarity", () => {
    const matches = index.similar("lamp", 0.1);
    expect(matches.map((match) => match.term)).toEqual(["lamp", "lampshade"]);
  });

  it("returns nothing below the threshold", () => {
    expect(index.similar("zzzz", 0.3)).toEqual([]);
  });

  it("answers exact membership", () => {
    expect(index.has("rug")).toBe(true);
    expect(index.has("rugs")).toBe(false);
    expect(index.size).toBe(6);
  });
});
