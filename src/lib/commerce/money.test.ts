/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Unit tests for integer money arithmetic and formatting.
 */

import { describe, expect, it } from "vitest";

import {
  addMoney,
  discountPercent,
  formatMoney,
  money,
  multiplyMoney,
  percentOf,
  sumMoney,
} from "@/lib/commerce/money";

describe("money", () => {
  it("rejects a non-integer amount instead of rounding silently", () => {
    expect(() => money(12.5)).toThrow(TypeError);
  });

  it("normalises the currency code", () => {
    expect(money(100, "eur").currency).toBe("EUR");
  });
});

describe("arithmetic", () => {
  it("adds amounts in the same currency", () => {
    expect(addMoney(money(1250), money(999))).toEqual({ cents: 2249, currency: "EUR" });
  });

  it("refuses to add different currencies rather than guessing a rate", () => {
    expect(() => addMoney(money(100, "EUR"), money(100, "USD"))).toThrow(TypeError);
  });

  it("multiplies by a quantity", () => {
    expect(multiplyMoney(money(1999), 3)).toEqual({ cents: 5997, currency: "EUR" });
  });

  it("rejects a fractional quantity", () => {
    expect(() => multiplyMoney(money(100), 1.5)).toThrow(TypeError);
  });

  it("sums an empty cart to zero", () => {
    expect(sumMoney([])).toEqual({ cents: 0, currency: "EUR" });
  });

  it("avoids the float error that makes 0.1 + 0.2 !== 0.3", () => {
    // The reason money is integer cents at all.
    expect(sumMoney([money(10), money(20)]).cents).toBe(30);
  });
});

describe("percentOf", () => {
  it("rounds half away from zero on a discount", () => {
    // 2.5 cents -> 3, not 2.
    expect(percentOf(money(50), 5).cents).toBe(3);
  });

  it("rounds symmetrically for negative amounts, unlike Math.round", () => {
    // Math.round(-2.5) is -2; receipts round away from zero, so -3.
    expect(percentOf(money(-50), 5).cents).toBe(-3);
  });
});

describe("formatMoney", () => {
  it("formats EUR for an English reader", () => {
    expect(formatMoney(money(64000))).toBe("€640.00");
  });

  it("formats EUR for a Greek reader, with the symbol after the number", () => {
    const formatted = formatMoney(money(64000), "el");
    expect(formatted).toContain("640");
    expect(formatted).toContain("€");
    expect(formatted.trimEnd().endsWith("€")).toBe(true);
  });

  it("can hide decimals on whole amounts", () => {
    expect(formatMoney(money(64000), "en", { hideDecimalsWhenWhole: true })).toBe("€640");
    expect(formatMoney(money(64050), "en", { hideDecimalsWhenWhole: true })).toBe("€640.50");
  });

  it("does not divide zero-decimal currencies by 100", () => {
    expect(formatMoney(money(640, "JPY"))).toBe("¥640");
  });
});

describe("discountPercent", () => {
  it("rounds down so the badge never oversells the saving", () => {
    // 33.4% actual -> shown as 33%.
    expect(discountPercent(money(999), money(1500))).toBe(33);
  });

  it("returns null when there is no discount", () => {
    expect(discountPercent(money(1500), money(1500))).toBeNull();
    expect(discountPercent(money(1500), money(999))).toBeNull();
  });

  it("returns null across currencies rather than a meaningless number", () => {
    expect(discountPercent(money(100, "EUR"), money(200, "USD"))).toBeNull();
  });
});
