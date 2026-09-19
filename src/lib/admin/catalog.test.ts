/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Unit tests for catalogue editing rules: euro parsing, the edit form and stock corrections.
 */

import { describe, expect, it } from "vitest";

import { centsToInput, fieldErrors, parseEuros, productDetailsSchema, stockChangeSchema } from "@/lib/admin/catalog";

describe("parseEuros", () => {
  it("reads prices in either convention", () => {
    expect(parseEuros("529")).toBe(52900);
    expect(parseEuros("529,9")).toBe(52990);
    expect(parseEuros("529.90")).toBe(52990);
    expect(parseEuros("1.299,00")).toBe(129900);
    expect(parseEuros("1,299.00")).toBe(129900);
    expect(parseEuros("1.299")).toBe(129900);
    expect(parseEuros(" € 12,50 ")).toBe(1250);
    expect(parseEuros("0")).toBe(0);
  });

  it("refuses anything that is not a price", () => {
    for (const text of ["", "abc", "-5", "12,345,6", "1..2", "529.999.9", "1e3", "100001"]) expect(parseEuros(text), text).toBeNull();
  });

  it("round-trips with the form's starting value", () => {
    for (const cents of [0, 5, 1250, 52990, 129900]) expect(parseEuros(centsToInput(cents))).toBe(cents);
    expect(centsToInput(null)).toBe("");
  });
});

describe("productDetailsSchema", () => {
  const form = {
    titleEn: "  Oak dining chair ",
    titleEl: "",
    descriptionEn: "Solid oak.",
    descriptionEl: " ",
    highlightsEn: "Solid oak\n\n  Made in Greece  \n",
    highlightsEl: "",
    price: "129,00",
    compareAt: "",
    status: "active",
  };

  it("turns the form into stored values", () => {
    expect(productDetailsSchema.parse(form)).toEqual({
      titleEn: "Oak dining chair",
      titleEl: null,
      descriptionEn: "Solid oak.",
      descriptionEl: null,
      highlightsEn: ["Solid oak", "Made in Greece"],
      highlightsEl: null,
      priceCents: 12900,
      compareAtCents: null,
      status: "active",
    });
  });

  it("explains each field that is wrong", () => {
    const result = productDetailsSchema.safeParse({ ...form, titleEn: " ", price: "free", status: "draft" });
    expect(result.success).toBe(false);
    expect(fieldErrors(result.error!)).toMatchObject({ titleEn: "required", price: "invalid_price", status: expect.any(String) });
  });

  it("refuses a 'was' price that is not above the price", () => {
    const result = productDetailsSchema.safeParse({ ...form, compareAt: "129" });
    expect(fieldErrors(result.error!)).toEqual({ compareAt: "compare_not_above" });
    expect(productDetailsSchema.parse({ ...form, compareAt: "159" }).compareAtCents).toBe(15900);
  });

  it("limits the number of selling points", () => {
    const result = productDetailsSchema.safeParse({ ...form, highlightsEn: Array.from({ length: 13 }, (_, index) => `Point ${index}`).join("\n") });
    expect(fieldErrors(result.error!)).toEqual({ highlightsEn: "too_many" });
  });
});

describe("stockChangeSchema", () => {
  const variantId = "01890000-0000-7000-8000-000000000000";

  it("needs a whole, non-negative count and a reason", () => {
    expect(stockChangeSchema.parse({ variantId, stock: "12", reason: "Counted the shelf" })).toEqual({ variantId, stock: 12, reason: "Counted the shelf" });
    expect(fieldErrors(stockChangeSchema.safeParse({ variantId, stock: "-1", reason: "x" }).error!)).toEqual({ stock: "negative", reason: "reason_required" });
    expect(fieldErrors(stockChangeSchema.safeParse({ variantId, stock: "2.5", reason: "Counted" }).error!)).toEqual({ stock: "whole_number" });
    // An empty field is not zero.
    expect(fieldErrors(stockChangeSchema.safeParse({ variantId, stock: " ", reason: "Counted" }).error!)).toEqual({ stock: "whole_number" });
    expect(stockChangeSchema.parse({ variantId, stock: 0, reason: "Sold out" }).stock).toBe(0);
  });
});
