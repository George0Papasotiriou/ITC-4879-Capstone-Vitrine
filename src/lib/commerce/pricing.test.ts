/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Unit tests for cart pricing, shipping and VAT totals.
 */

import { describe, expect, it } from "vitest";

import {
  divideRounded,
  includedVat,
  MAX_LINES,
  MAX_QUANTITY_PER_LINE,
  priceCart,
  PricingError,
  SHIPPING_RATES,
  shippingZone,
} from "@/lib/commerce/pricing";

describe("rounded integer division", () => {
  it.each([
    [10, 4, 3], // 2.5 rounds up
    [9, 4, 2], // 2.25 rounds down
    [11, 4, 3], // 2.75 rounds up
    [0, 7, 0],
    [124, 124, 1],
  ])("%i / %i ≈ %i", (numerator, denominator, expected) => {
    expect(divideRounded(numerator, denominator)).toBe(expected);
  });

  it("refuses inputs that would silently lose precision", () => {
    expect(() => divideRounded(1.5, 2)).toThrow(RangeError);
    expect(() => divideRounded(5, 0)).toThrow(RangeError);
    expect(() => divideRounded(-5, 2)).toThrow(RangeError);
  });
});

describe("VAT contained in a price", () => {
  it("is 24/124 of a VAT-inclusive amount", () => {
    // €124.00 contains exactly €24.00 of VAT.
    expect(includedVat(12_400)).toBe(2_400);
    // €10.00 → 193.548… cents → 194.
    expect(includedVat(1_000)).toBe(194);
    // €0.01 → 0.19 cents → 0.
    expect(includedVat(1)).toBe(0);
  });

  it("matches exact rational arithmetic on every amount up to €100", () => {
    for (let cents = 0; cents <= 10_000; cents += 1) {
      const exact = (cents * 24) / 124;
      const expected = Math.floor(exact + 0.5);
      expect(includedVat(cents)).toBe(expected);
    }
  });

  it("never exceeds the net amount's share: net + VAT = total", () => {
    for (const total of [1, 99, 12_345, 999_999]) {
      const vat = includedVat(total);
      expect(vat).toBeGreaterThanOrEqual(0);
      expect(total - vat).toBeGreaterThan(0);
      expect(Math.abs((total - vat) * 0.24 - vat)).toBeLessThanOrEqual(1);
    }
  });
});

describe("pricing a cart", () => {
  it("multiplies lines, adds shipping, and states the VAT inside the total", () => {
    const totals = priceCart([
      { unitCents: 4_990, quantity: 2 },
      { unitCents: 1_250, quantity: 1 },
    ]);
    expect(totals.lines.map((line) => line.lineCents)).toEqual([9_980, 1_250]);
    expect(totals.itemCount).toBe(3);
    expect(totals.subtotal.cents).toBe(11_230);
    expect(totals.shipping.cents).toBe(690);
    expect(totals.total.cents).toBe(11_920);
    expect(totals.vat.cents).toBe(includedVat(11_920));
    expect(totals.freeShippingRemaining?.cents).toBe(15_000 - 11_230);
  });

  it("ships standard for free from €150, exactly at the threshold", () => {
    expect(priceCart([{ unitCents: 14_999, quantity: 1 }]).shipping.cents).toBe(690);
    const atThreshold = priceCart([{ unitCents: 15_000, quantity: 1 }]);
    expect(atThreshold.shipping.cents).toBe(0);
    expect(atThreshold.freeShippingRemaining).toBeNull();
  });

  it("charges express whatever the subtotal", () => {
    const totals = priceCart([{ unitCents: 90_000, quantity: 1 }], { shipping: "express" });
    expect(totals.shipping.cents).toBe(SHIPPING_RATES.domestic.express.baseCents);
    expect(totals.total.cents).toBe(90_000 + SHIPPING_RATES.domestic.express.baseCents);
  });

  it("costs nothing when empty", () => {
    const totals = priceCart([]);
    expect(totals.total.cents).toBe(0);
    expect(totals.shipping.cents).toBe(0);
    expect(totals.vat.cents).toBe(0);
    expect(totals.freeShippingRemaining).toBeNull();
  });

  it("rejects fractional or out-of-range quantities and prices", () => {
    expect(() => priceCart([{ unitCents: 100, quantity: 0 }])).toThrow(PricingError);
    expect(() => priceCart([{ unitCents: 100, quantity: 1.5 }])).toThrow(PricingError);
    expect(() => priceCart([{ unitCents: 100, quantity: MAX_QUANTITY_PER_LINE + 1 }])).toThrow(PricingError);
    expect(() => priceCart([{ unitCents: 10.5, quantity: 1 }])).toThrow(PricingError);
    expect(() => priceCart([{ unitCents: -1, quantity: 1 }])).toThrow(PricingError);
    expect(() => priceCart(Array.from({ length: MAX_LINES + 1 }, () => ({ unitCents: 1, quantity: 1 })))).toThrow(PricingError);
  });

  it("prices a German cart in German prices, with German VAT and EU delivery", () => {
    // Two €94.00 lamps (Greek price): €90.21 each in Germany.
    const totals = priceCart([{ unitCents: 9_400, quantity: 2 }], { country: "DE" });
    expect(totals.country).toBe("DE");
    expect(totals.lines[0]!.localUnitCents).toBe(9_021);
    expect(totals.subtotal.cents).toBe(18_042);
    // EU standard delivery, €24.90 in stored terms, becomes €23.90 in Germany.
    expect(totals.shipping.cents).toBe(2_390);
    expect(totals.total.cents).toBe(20_432);
    expect(totals.vatRatePerMille).toBe(190);
    expect(totals.vat.cents).toBe(includedVat(20_432, 190));
    expect(totals.deliverable).toBe(true);
  });

  it("decides free delivery on stored prices, so rounding in another country cannot flip it", () => {
    const threshold = SHIPPING_RATES.eu.standard.freeFromBaseCents!;
    expect(priceCart([{ unitCents: threshold, quantity: 1 }], { country: "LU" }).shipping.cents).toBe(0);
    expect(priceCart([{ unitCents: threshold - 1, quantity: 1 }], { country: "HU" }).shipping.cents).toBeGreaterThan(0);
  });

  it("uses Greece as domestic, Cyprus by sea, the rest of the EU by road, and nothing outside the EU", () => {
    expect(shippingZone("GR")).toBe("domestic");
    expect(shippingZone("CY")).toBe("cyprus");
    expect(shippingZone("SE")).toBe("eu");
    expect(shippingZone("US")).toBeNull();
    const abroad = priceCart([{ unitCents: 12_400, quantity: 1 }], { country: "US" });
    expect(abroad.deliverable).toBe(false);
    expect(abroad.subtotal.cents).toBe(10_000);
    expect(abroad.shipping.cents).toBe(0);
    expect(abroad.vat.cents).toBe(0);
  });

  it("keeps every line equal to quantity × the unit price shown, in every country", () => {
    for (const country of ["GR", "DE", "FI", "LU", "HU", "US"]) {
      const totals = priceCart([{ unitCents: 3_333, quantity: 7 }, { unitCents: 12_345, quantity: 3 }], { country });
      for (const line of totals.lines) expect(line.lineCents).toBe(line.localUnitCents * line.quantity);
      expect(totals.subtotal.cents).toBe(totals.lines.reduce((sum, line) => sum + line.lineCents, 0));
    }
  });

  it("stays in whole cents for any combination (property check)", () => {
    let seed = 7;
    const next = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed / 2_147_483_648;
    };
    for (let trial = 0; trial < 500; trial += 1) {
      const lines = Array.from({ length: 1 + Math.floor(next() * 6) }, () => ({
        unitCents: Math.floor(next() * 200_000),
        quantity: 1 + Math.floor(next() * MAX_QUANTITY_PER_LINE),
      }));
      const totals = priceCart(lines, { shipping: next() < 0.5 ? "standard" : "express" });
      for (const amount of [totals.subtotal, totals.shipping, totals.total, totals.vat]) expect(Number.isInteger(amount.cents)).toBe(true);
      expect(totals.total.cents).toBe(totals.subtotal.cents + totals.shipping.cents);
      expect(totals.subtotal.cents).toBe(lines.reduce((sum, line) => sum + line.unitCents * line.quantity, 0));
    }
  });
});
