/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Unit tests for EU VAT rates and price localisation.
 */

import { describe, expect, it } from "vitest";

import {
  BASE_COUNTRY,
  EU_COUNTRIES,
  formatVatRate,
  isEuCountry,
  localizeCents,
  outsideVatArea,
  toBaseBound,
  vatRatePerMille,
  VAT_RATES_PER_MILLE,
} from "@/lib/commerce/vat";

describe("VAT rates", () => {
  it("covers exactly the 27 EU member states, between the EU minimum of 15% and Hungary's 27%", () => {
    expect(EU_COUNTRIES).toHaveLength(27);
    for (const country of EU_COUNTRIES) {
      expect(VAT_RATES_PER_MILLE[country]).toBeGreaterThanOrEqual(150);
      expect(VAT_RATES_PER_MILLE[country]).toBeLessThanOrEqual(270);
    }
    expect(EU_COUNTRIES).not.toContain("GB");
  });

  it("uses the 2025–2026 changes", () => {
    expect(vatRatePerMille("EE")).toBe(240);
    expect(vatRatePerMille("RO")).toBe(210);
    expect(vatRatePerMille("SK")).toBe(230);
    expect(vatRatePerMille("FI")).toBe(255);
    expect(vatRatePerMille("GR")).toBe(240);
  });

  it("charges no EU VAT outside the EU", () => {
    for (const country of ["GB", "US", "CH", "NO", "AL"]) {
      expect(isEuCountry(country)).toBe(false);
      expect(vatRatePerMille(country)).toBe(0);
    }
  });

  it("writes rates the way people do, in each language", () => {
    expect(formatVatRate(255, "en")).toBe("25.5");
    expect(formatVatRate(255, "el")).toBe("25,5");
    expect(formatVatRate(190, "en")).toBe("19");
  });
});

describe("prices by country", () => {
  it("keeps Greek prices as stored", () => {
    expect(localizeCents(9_400, BASE_COUNTRY)).toBe(9_400);
  });

  it("keeps the price before VAT and applies the country's VAT", () => {
    // €124.00 in Greece is €100.00 before VAT.
    expect(localizeCents(12_400, "DE")).toBe(11_900);
    expect(localizeCents(12_400, "HU")).toBe(12_700);
    expect(localizeCents(12_400, "FI")).toBe(12_550);
    expect(localizeCents(12_400, "US")).toBe(10_000);
    // €94.00: 94 / 1.24 × 1.19 = 90.209… → €90.21.
    expect(localizeCents(9_400, "DE")).toBe(9_021);
  });

  it("never lowers a price when the stored price rises (monotonic), in every country", () => {
    for (const country of [...EU_COUNTRIES, "US"]) {
      let previous = -1;
      for (let base = 0; base <= 5_000; base += 1) {
        const local = localizeCents(base, country);
        expect(local).toBeGreaterThanOrEqual(previous);
        previous = local;
      }
    }
  });
});

describe("price filters in the shopper's own prices", () => {
  it("finds exactly the stored prices whose local price is within the bound, for every country", () => {
    for (const country of [...EU_COUNTRIES, "US"]) {
      for (const shown of [0, 1, 99, 5_000, 12_345, 20_000, 99_999]) {
        const max = toBaseBound(shown, "max", country);
        expect(localizeCents(max, country), `${country} max ${shown}`).toBeLessThanOrEqual(shown);
        expect(localizeCents(max + 1, country), `${country} max ${shown} + 1`).toBeGreaterThan(shown);

        const min = toBaseBound(shown, "min", country);
        expect(localizeCents(min, country), `${country} min ${shown}`).toBeGreaterThanOrEqual(shown);
        if (min > 0) expect(localizeCents(min - 1, country), `${country} min ${shown} − 1`).toBeLessThan(shown);
      }
    }
  });
});

describe("places outside the EU VAT area", () => {
  it.each([
    ["ES", "35001", "canary_islands"],
    ["ES", "38 400", "canary_islands"],
    ["ES", "51001", "ceuta_melilla"],
    ["GR", "63086", "mount_athos"],
    ["IT", "23041", "livigno_campione"],
    ["FR", "97100", "french_overseas"],
    ["DE", "78266", "busingen_heligoland"],
    ["FI", "22100", "aland"],
  ])("recognises %s %s as %s", (country, postcode, name) => {
    expect(outsideVatArea(country, postcode)).toBe(name);
  });

  it("does not flag ordinary addresses", () => {
    expect(outsideVatArea("ES", "28013")).toBeNull();
    expect(outsideVatArea("GR", "10563")).toBeNull();
    expect(outsideVatArea("FR", "75001")).toBeNull();
    // The same digits mean nothing in another country.
    expect(outsideVatArea("IT", "35001")).toBeNull();
  });
});
