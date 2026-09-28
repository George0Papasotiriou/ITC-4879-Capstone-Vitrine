/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Unit tests for catalogue editing rules: euro parsing, the edit form and stock corrections.
 */

import { describe, expect, it } from "vitest";

import { centsToInput, checkDecodedProductPhoto, checkProductPhoto, fieldErrors, newProductSchema, parseEuros, productDetailsSchema, staffSlug, stockChangeSchema } from "@/lib/admin/catalog";

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
    const result = productDetailsSchema.safeParse({ ...form, titleEn: " ", price: "free", status: "sold" });
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

describe("newProductSchema", () => {
  const form = { kind: "SOFA", titleEn: "Linen sofa", titleEl: "", descriptionEn: "", descriptionEl: "", price: "1.299,00", stock: "4", width: "", depth: "", height: "" };

  it("reads a new product: the kind decides the category, the price is cents, measurements optional", () => {
    const parsed = newProductSchema.parse(form);
    expect(parsed).toMatchObject({ kind: "SOFA", category: "seating", titleEn: "Linen sofa", titleEl: null, priceCents: 129_900, stock: 4, dimsCm: null });
    expect(newProductSchema.parse({ ...form, width: "210", depth: "92,5", height: "80" }).dimsCm).toEqual({ w: 210, d: 92.5, h: 80 });
  });

  it("refuses an unknown kind, a missing title, a bad price or stock, and measurements given in part", () => {
    const issues = (input: Record<string, string>) => {
      const result = newProductSchema.safeParse(input);
      return result.success ? {} : fieldErrors(result.error);
    };
    expect(issues({ ...form, kind: "SPACESHIP" })).toMatchObject({ kind: "required" });
    expect(issues({ ...form, titleEn: " " })).toMatchObject({ titleEn: "required" });
    expect(issues({ ...form, price: "free" })).toMatchObject({ price: "invalid_price" });
    expect(issues({ ...form, stock: "-2" })).toMatchObject({ stock: "whole_number" });
    expect(issues({ ...form, width: "200" })).toMatchObject({ depth: "all_three" });
    expect(issues({ ...form, width: "0", depth: "40", height: "40" })).toMatchObject({ width: "invalid_size" });
  });
});

describe("staffSlug", () => {
  it("makes an address from the words and a piece of the id", () => {
    expect(staffSlug("Linen Sofa, Sand — 3 seats", "01890000-0000-7000-8000-00000000abcd")).toBe("linen-sofa-sand-3-seats-0000abcd");
    expect(staffSlug("Καναπές", "01890000-0000-7000-8000-00000000abcd")).toBe("piece-0000abcd");
  });
});

describe("product photographs", () => {
  it("accepts JPEG, PNG and WebP up to 12 MB", () => {
    expect(checkProductPhoto({ contentType: "image/jpeg", bytes: 2_000_000 })).toBeNull();
    expect(checkProductPhoto({ contentType: "image/gif", bytes: 2_000 })).toBe("type");
    expect(checkProductPhoto({ contentType: "image/png", bytes: 13 * 1024 * 1024 })).toBe("too_large");
    expect(checkProductPhoto({ contentType: "image/webp", bytes: 0 })).toBe("too_small");
  });

  it("checks what the file really is once opened, and that it is large enough for the product page", () => {
    expect(checkDecodedProductPhoto({ format: "jpg", width: 1600, height: 1200 })).toBeNull();
    expect(checkDecodedProductPhoto({ format: "svg", width: 1600, height: 1200 })).toBe("type");
    expect(checkDecodedProductPhoto({ format: "png", width: 1600, height: 480 })).toBe("too_small");
  });
});
