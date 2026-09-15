/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Unit tests for building a product's weighted search document.
 */

import { describe, expect, it } from "vitest";

import { buildSearchDocument } from "@/lib/catalog/search-document";
import { tokenize } from "@/lib/search/normalize";

const sofa = {
  kind: "SOFA",
  category: "seating" as const,
  titleEn: "Emerly Modern Sofa",
  brand: "Rivet",
  colorLabel: "Steel Grey",
  colors: ["grey"],
  materials: ["velvet", "wood"],
  attributes: { style: "Mid-Century" },
  descriptionEn: null,
  highlightsEn: ["Kiln-dried hardwood frame", "Stain-resistant velvet"],
};

describe("buildSearchDocument", () => {
  it("indexes the kind and category in both languages, so Greek finds an English title", () => {
    const document = buildSearchDocument(sofa);
    expect(document.searchMeta).toBe("sofa καναπεσ rivet seating καθισματα");
  });

  it("folds every field the way queries are folded", () => {
    const document = buildSearchDocument({ ...sofa, titleEl: "Μοντέρνος Καναπές Emerly" });
    expect(document.searchTitle).toBe("emerly modern sofa μοντερνοσ καναπεσ emerly");
    for (const field of Object.values(document)) {
      expect(field).toBe(field.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/ς/g, "σ"));
    }
  });

  it("adds canonical colour and material labels in both languages to the source wording", () => {
    const { searchAttributes } = buildSearchDocument(sofa);
    expect(tokenize(searchAttributes)).toEqual(
      expect.arrayContaining(["steel", "grey", "γκρι", "velvet", "βελουδο", "wood", "ξυλο", "mid", "century"]),
    );
  });

  it("puts selling points in the description field", () => {
    expect(buildSearchDocument(sofa).searchDescription).toBe("kiln dried hardwood frame stain resistant velvet");
  });

  it("caps a long description at a word boundary", () => {
    const long = Array.from({ length: 2000 }, (_, i) => `word${i}`).join(" ");
    const { searchDescription } = buildSearchDocument({ ...sofa, descriptionEn: long, highlightsEn: [] });
    expect(searchDescription.length).toBeLessThanOrEqual(4000);
    expect(long.startsWith(searchDescription)).toBe(true);
    expect(searchDescription.endsWith(" ")).toBe(false);
  });

  it("tolerates missing optional fields", () => {
    const document = buildSearchDocument({
      kind: "UNKNOWN_KIND",
      category: "accents",
      titleEn: "Stoneware Vase",
      brand: null,
      colorLabel: null,
      colors: [],
      materials: [],
    });
    expect(document).toEqual({
      searchTitle: "stoneware vase",
      searchMeta: "accents διακοσμητικα",
      searchAttributes: "",
      searchDescription: "",
    });
  });
});
