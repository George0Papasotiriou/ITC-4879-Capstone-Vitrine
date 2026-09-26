/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Unit tests for splitting a passage into sentences to read aloud, in English and Greek.
 */

import { describe, expect, it } from "vitest";

import { sentenceSpans } from "@/lib/comfort/sentences";

describe("sentences to read aloud", () => {
  it("splits English at full stops, question and exclamation marks", () => {
    const text = "Solid oak, oiled by hand. Will it fit? It measures 120 cm!";
    expect(sentenceSpans(text).map((span) => span.text)).toEqual(["Solid oak, oiled by hand.", "Will it fit?", "It measures 120 cm!"]);
  });

  it("splits Greek at its question mark, the semicolon", () => {
    expect(sentenceSpans("Χωράει στο σαλόνι σου; Μετράει 120 εκ.").map((span) => span.text)).toEqual(["Χωράει στο σαλόνι σου;", "Μετράει 120 εκ."]);
  });

  it("does not split inside a number or a word, and keeps a last sentence without a full stop", () => {
    expect(sentenceSpans("Priced at €1.299,00 today. Ships in 3–5 days").map((span) => span.text)).toEqual(["Priced at €1.299,00 today.", "Ships in 3–5 days"]);
  });

  it("points back at the exact place in the text, whitespace trimmed", () => {
    const text = "  First one.\n\n  Second one.  ";
    for (const span of sentenceSpans(text)) expect(text.slice(span.start, span.end)).toBe(span.text);
  });

  it("skips fragments with no words, and folds line breaks into spaces", () => {
    expect(sentenceSpans("… . ! Real words\nacross lines.").map((span) => span.text)).toEqual(["Real words across lines."]);
  });
});
