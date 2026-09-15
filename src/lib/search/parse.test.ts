/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Unit tests for search query parsing.
 */

import { describe, expect, it } from "vitest";

import { amountToCents, parseQuery } from "@/lib/search/parse";

const price = (query: string) => parseQuery(query).price;

describe("amounts", () => {
  it("reads a separator before exactly three digits as thousands", () => {
    expect(amountToCents("1.200")).toBe(120_000);
    expect(amountToCents("1,200")).toBe(120_000);
    expect(amountToCents("1.200.000")).toBe(120_000_000);
  });

  it("reads a separator before one or two digits as the decimal point", () => {
    expect(amountToCents("149,99")).toBe(14_999);
    expect(amountToCents("149.99")).toBe(14_999);
    expect(amountToCents("1,5")).toBe(150);
  });

  it("reads plain integers", () => {
    expect(amountToCents("300")).toBe(30_000);
  });
});

describe("price ceilings", () => {
  it.each([
    ["sofa under 300", 30_000],
    ["lamp below €150", 15_000],
    ["rug less than 99.90", 9_990],
    ["chair up to 1.200€", 120_000],
    ["desk max 400", 40_000],
    ["table 250 or less", 25_000],
    ["καναπές κάτω από 300€", 30_000],
    ["φωτιστικό έως 80 ευρώ", 8_000],
    ["χαλί μέχρι 149,99", 14_999],
    ["καρέκλα το πολύ 120", 12_000],
    ["kanapes kato apo 300", 30_000],
    ["xali mexri 200", 20_000],
    ["lamp 50€", 5_000],
    ["€75 lamp", 7_500],
  ])("%s", (query, maxCents) => {
    expect(price(query)).toEqual({ minCents: null, maxCents });
  });
});

describe("price floors", () => {
  it.each([
    ["sofa over 1000", 100_000],
    ["armchair above €500", 50_000],
    ["rug at least 200", 20_000],
    ["table 300+", 30_000],
    ["lamp 100 or more", 10_000],
    ["καναπές πάνω από 800", 80_000],
    ["πολυθρόνα τουλάχιστον 400€", 40_000],
    ["kanapes pano apo 800", 80_000],
  ])("%s", (query, minCents) => {
    expect(price(query)).toEqual({ minCents, maxCents: null });
  });
});

describe("price ranges", () => {
  it.each([
    ["sofa 300-500", 30_000, 50_000],
    ["sofa 300 – 500€", 30_000, 50_000],
    ["chair between 100 and 250", 10_000, 25_000],
    ["lamp from €40 to €90", 4_000, 9_000],
    ["καναπές από 300 έως 500", 30_000, 50_000],
    ["χαλί μεταξύ 100 και 200", 10_000, 20_000],
    ["trapezi apo 200 mexri 400", 20_000, 40_000],
    ["table 500-300", 30_000, 50_000],
  ])("%s", (query, minCents, maxCents) => {
    expect(price(query)).toEqual({ minCents, maxCents });
  });
});

describe("numbers that are not prices", () => {
  it.each([
    "3 seater sofa",
    "sofa 3-4 seats",
    "desk 120 cm",
    "rug 160x230",
    "table 120-60 cm",
    "καναπές 3 θέσεων",
    "lamp 60w",
  ])("%s has no price", (query) => {
    expect(price(query)).toBeNull();
  });
});

describe("sizes", () => {
  it("reads sizes after a keyword, in both languages", () => {
    expect(parseQuery("linen shirt size m").sizes).toEqual(["M"]);
    expect(parseQuery("παπούτσια νούμερο 42").sizes).toEqual(["42"]);
    expect(parseQuery("μπουφάν μέγεθος xl").sizes).toEqual(["XL"]);
    expect(parseQuery("shoes size 42.5").sizes).toEqual(["42.5"]);
  });

  it("reads unambiguous letter sizes without a keyword", () => {
    expect(parseQuery("oversized hoodie xxl").sizes).toEqual(["XXL"]);
  });

  it("does not read single letters as sizes without a keyword", () => {
    expect(parseQuery("s shaped lamp").sizes).toEqual([]);
    expect(parseQuery("l desk").sizes).toEqual([]);
  });
});

describe("colours, materials and categories", () => {
  it("parses English, with plurals", () => {
    const parsed = parseQuery("black leather chairs");
    expect(parsed.colors).toEqual(["black"]);
    expect(parsed.materials).toEqual(["leather"]);
    expect(parsed.categories).toEqual(["seating"]);
  });

  it("matches Greek inflections by stem", () => {
    for (const form of ["μαύρος", "μαύρη", "μαύρο", "μαύρα", "μαύρες"]) {
      expect(parseQuery(`${form} καναπές`).colors, form).toEqual(["black"]);
    }
    expect(parseQuery("δερμάτινη πολυθρόνα").materials).toEqual(["leather"]);
    expect(parseQuery("ξύλινο τραπέζι").materials).toEqual(["wood"]);
  });

  it("matches indeclinable Greek words exactly", () => {
    expect(parseQuery("γκρι χαλί").colors).toEqual(["grey"]);
    expect(parseQuery("μπεζ πολυθρόνα").colors).toEqual(["beige"]);
    expect(parseQuery("γκρι χαλί").categories).toEqual(["rugs"]);
  });

  it("reads Greeklish through its Greek readings", () => {
    const parsed = parseQuery("mavri dermatini polythrona");
    expect(parsed.colors).toEqual(["black"]);
    expect(parsed.materials).toEqual(["leather"]);
    expect(parsed.categories).toEqual(["seating"]);
  });

  it("keeps category words as search terms, because they also rank", () => {
    expect(parseQuery("floor lamp").text).toBe("floor lamp");
  });

  it("does not duplicate a constraint mentioned twice", () => {
    expect(parseQuery("oak table with oak legs").materials).toEqual(["oak"]);
  });
});

describe("the whole query", () => {
  it("separates filters from free text in the plan's Greek example", () => {
    expect(parseQuery("Δερμάτινη μαύρη πολυθρόνα κάτω από 300€")).toEqual({
      raw: "Δερμάτινη μαύρη πολυθρόνα κάτω από 300€",
      text: "πολυθρονα",
      price: { minCents: null, maxCents: 30_000 },
      colors: ["black"],
      materials: ["leather"],
      categories: ["seating"],
      sizes: [],
    });
  });

  it("drops stopwords from the free text", () => {
    expect(parseQuery("I want a warm lamp for my reading corner under 150").text).toBe(
      "warm lamp reading corner",
    );
    expect(parseQuery("θέλω ένα φωτιστικό για το σαλόνι").text).toBe("φωτιστικο σαλονι");
  });

  it("leaves a query with no constraints untouched apart from folding", () => {
    expect(parseQuery("Mid-century lounge")).toMatchObject({
      text: "mid century lounge",
      price: null,
      colors: [],
      materials: [],
      categories: [],
      sizes: [],
    });
  });

  it("returns an empty result for an empty query", () => {
    expect(parseQuery("   ")).toMatchObject({ text: "", price: null, colors: [] });
  });
});
