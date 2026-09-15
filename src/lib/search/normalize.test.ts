/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Unit tests for search text normalisation.
 */

import { describe, expect, it } from "vitest";

import { fold, normalize, scriptOf, tokenize } from "@/lib/search/normalize";

describe("fold", () => {
  it("makes accents, case and the final sigma irrelevant in Greek", () => {
    const forms = ["Καφές", "καφές", "ΚΑΦΕΣ", "καφες", "Καφεσ"];
    expect(new Set(forms.map(fold))).toEqual(new Set(["καφεσ"]));
  });

  it("removes tonos and dialytika", () => {
    expect(fold("Ταΐζω")).toBe("ταιζω");
    expect(fold("ΰ")).toBe("υ");
    expect(fold("Άλφα Έψιλον Ήτα Ίωτα Όμικρον Ύψιλον Ωμέγα")).toBe("αλφα εψιλον ητα ιωτα ομικρον υψιλον ωμεγα");
  });

  it("changes every sigma to σ, not only the final one", () => {
    // Both shapes must map to one code point, wherever they appear.
    expect(fold("σεισμός")).toBe("σεισμοσ");
  });

  it("removes accents from Latin text too", () => {
    expect(fold("Café crème")).toBe("cafe creme");
  });

  it("folds compatibility forms such as full-width digits", () => {
    expect(fold("３００")).toBe("300");
  });

  it("keeps punctuation and spacing, which the query parser needs", () => {
    expect(fold("Κάτω από 300€")).toBe("κατω απο 300€");
  });
});

describe("tokenize", () => {
  it("splits on anything that is not a letter or digit", () => {
    expect(tokenize("Mid-century, oak/walnut (2 seats)")).toEqual(["mid", "century", "oak", "walnut", "2", "seats"]);
  });

  it("keeps Greek and Latin terms in one query", () => {
    expect(tokenize("Καναπές IKEA 3θέσιος")).toEqual(["καναπεσ", "ikea", "3θεσιοσ"]);
  });

  it("returns nothing for input with no terms", () => {
    expect(tokenize("  —  ,, !! ")).toEqual([]);
    expect(tokenize("")).toEqual([]);
  });
});

describe("normalize", () => {
  it("joins the terms with single spaces", () => {
    expect(normalize("  Φωτιστικό   δαπέδου!! ")).toBe("φωτιστικο δαπεδου");
  });

  it("is idempotent", () => {
    const once = normalize("Δερμάτινη ΠΟΛΥΘΡΌΝΑ, καφέ");
    expect(normalize(once)).toBe(once);
  });
});

describe("scriptOf", () => {
  it("tells Greek, Latin, mixed and neither apart", () => {
    expect(scriptOf("καναπεσ")).toBe("greek");
    expect(scriptOf("kanapes")).toBe("latin");
    expect(scriptOf("3θεσιοσ")).toBe("greek");
    expect(scriptOf("iphoneκ")).toBe("mixed");
    expect(scriptOf("300")).toBe("other");
  });
});
