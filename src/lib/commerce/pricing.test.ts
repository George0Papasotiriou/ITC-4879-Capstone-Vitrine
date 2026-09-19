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

  it("uses Greece as domestic, Cyprus by sea, the EU by road, exports by zone, and nothing elsewhere", () => {
    expect(shippingZone("GR")).toBe("domestic");
    expect(shippingZone("CY")).toBe("cyprus");
    expect(shippingZone("SE")).toBe("eu");
    expect(shippingZone("CH")).toBe("europe");
    expect(shippingZone("US")).toBe("world");
    expect(shippingZone("BR")).toBeNull();
    const nowhere = priceCart([{ unitCents: 12_400, quantity: 1 }], { country: "BR" });
    expect(nowhere.deliverable).toBe(false);
    expect(nowhere.subtotal.cents).toBe(10_000);
    expect(nowhere.shipping.cents).toBe(0);
    expect(nowhere.vat.cents).toBe(0);
  });

  describe("exports (docs/adr/015)", () => {
    it("charges no VAT on an export whose tax is paid on delivery, and says so", () => {
      // €124.00 in Greece is €100.00 before VAT; Switzerland taxes it at the border.
      const swiss = priceCart([{ unitCents: 12_400, quantity: 1 }], { country: "CH" });
      expect(swiss.deliverable).toBe(true);
      expect(swiss.subtotal.cents).toBe(10_000);
      expect(swiss.vat.cents).toBe(0);
      expect(swiss.vatRatePerMille).toBe(0);
      expect(swiss.exportTax).toEqual({ collectedBy: "on_delivery", ratePerMille: 81, taxName: "VAT" });
      // Export delivery is priced without VAT: €39.90 standard to the rest of Europe.
      expect(swiss.shipping.cents).toBe(3_990);
      expect(swiss.total.cents).toBe(13_990);
    });

    it("collects UK VAT itself on a basket up to the £135 limit, and not above it", () => {
      // €100.00 of goods: within the limit, so the shop charges 20% UK VAT, on delivery too.
      const small = priceCart([{ unitCents: 12_400, quantity: 1 }], { country: "GB" });
      expect(small.exportTax?.collectedBy).toBe("seller");
      expect(small.vatRatePerMille).toBe(200);
      expect(small.subtotal.cents).toBe(12_000);
      expect(small.shipping.cents).toBe(4_788); // €39.90 + 20%
      expect(small.vat.cents).toBe(includedVat(small.total.cents, 200));

      // €200.00 of goods: above the limit, so UK VAT is paid on import and the shop charges none.
      const large = priceCart([{ unitCents: 24_800, quantity: 1 }], { country: "GB" });
      expect(large.exportTax?.collectedBy).toBe("on_delivery");
      expect(large.vatRatePerMille).toBe(0);
      expect(large.subtotal.cents).toBe(20_000);
      expect(large.vat.cents).toBe(0);
    });

    it("judges the UK limit on the goods alone, not on the delivery", () => {
      // €160.00 of goods is at the limit even though delivery takes the total well past it.
      const atLimit = priceCart([{ unitCents: 19_840, quantity: 1 }], { country: "GB", shipping: "express" });
      expect(atLimit.exportTax?.collectedBy).toBe("seller");
      const justAbove = priceCart([{ unitCents: 19_841, quantity: 1 }], { country: "GB" });
      expect(justAbove.exportTax?.collectedBy).toBe("on_delivery");
    });

    it("ships the rest of the world without a free-delivery threshold", () => {
      const us = priceCart([{ unitCents: 124_000, quantity: 1 }], { country: "US" });
      expect(us.shipping.cents).toBe(7_990);
      expect(us.freeShippingRemaining).toBeNull();
      // The rest of Europe ships free from €800 of goods.
      const norway = priceCart([{ unitCents: 99_200, quantity: 1 }], { country: "NO" });
      expect(norway.shipping.cents).toBe(0);
    });
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
