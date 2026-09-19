/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Unit tests for checkout form validation and postcode rules.
 */

import { describe, expect, it } from "vitest";

import { checkoutSchema, fieldErrors, normalisePostcode } from "@/lib/commerce/checkout-input";
import { DELIVERY_COUNTRIES } from "@/lib/commerce/exports";
import { EU_COUNTRIES } from "@/lib/commerce/vat";

const valid = {
  email: "  Eleni@Example.com ",
  name: "Eleni Papadopoulou",
  line1: "Ermou 10",
  line2: "",
  city: "Athens",
  postcode: "105 63",
  country: "GR",
  phone: "",
  shipping: "standard",
  idempotencyKey: "0191e2c4-5b6a-7c8d-9e0f-a1b2c3d4e5f6",
  locale: "el",
};

describe("checkout input", () => {
  it("accepts a Greek address, trims, drops empty optionals and writes the postcode the Greek way", () => {
    const result = checkoutSchema.safeParse(valid);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.email).toBe("Eleni@Example.com");
    expect(result.data.postcode).toBe("105 63");
    expect(result.data.line2).toBeUndefined();
    expect(result.data.phone).toBeUndefined();
  });

  it("checks postcodes by country", () => {
    expect(checkoutSchema.safeParse({ ...valid, postcode: "1056" }).success).toBe(false);
    expect(checkoutSchema.safeParse({ ...valid, country: "CY", postcode: "1056" }).success).toBe(true);
    expect(checkoutSchema.safeParse({ ...valid, country: "CY", postcode: "10563" }).success).toBe(false);
    expect(checkoutSchema.safeParse({ ...valid, country: "DE", postcode: "10115" }).success).toBe(true);
  });

  it("reports one stable error code per field", () => {
    const result = checkoutSchema.safeParse({ ...valid, email: "not-an-email", name: " ", postcode: "abc", phone: "call me" });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(fieldErrors(result.error)).toMatchObject({ email: "email", name: "required", postcode: "postcode", phone: "phone" });
  });

  it("never accepts prices, totals, or countries the shop does not deliver to", () => {
    const outside = checkoutSchema.safeParse({ ...valid, country: "BR", postcode: "01310-100" });
    expect(outside.success).toBe(false);
    if (!outside.success) expect(fieldErrors(outside.error).country).toBe("country");
    const withExtra = checkoutSchema.safeParse({ ...valid, totalCents: 1 });
    expect(withExtra.success && "totalCents" in withExtra.data).toBe(false);
  });
});

describe("postcodes in every EU country", () => {
  it.each([
    ["AT", "1010", "1010"],
    ["BE", "1000", "1000"],
    ["BG", "1000", "1000"],
    ["CY", "1010", "1010"],
    ["CZ", "11000", "110 00"],
    ["DE", "10115", "10115"],
    ["DK", "DK-1050", "1050"],
    ["EE", "10111", "10111"],
    ["ES", "28013", "28013"],
    ["FI", "00100", "00100"],
    ["FR", "75001", "75001"],
    ["GR", "10563", "105 63"],
    ["HR", "10000", "10000"],
    ["HU", "1051", "1051"],
    ["IE", "d02 x285", "D02 X285"],
    ["IT", "00118", "00118"],
    ["LT", "01100", "LT-01100"],
    ["LU", "L-1111", "L-1111"],
    ["LV", "lv-1050", "LV-1050"],
    ["MT", "VLT1117", "VLT 1117"],
    ["NL", "1012 ab", "1012 AB"],
    ["PL", "00-950", "00-950"],
    ["PT", "1100-148", "1100-148"],
    ["RO", "010011", "010011"],
    ["SE", "111 22", "111 22"],
    ["SI", "1000", "1000"],
    ["SK", "811 01", "811 01"],
  ] as const)("%s accepts %s and writes %s", (country, input, written) => {
    expect(normalisePostcode(country, input)).toBe(written);
  });

  it("has a rule for all 27 countries, and each rule refuses nonsense", () => {
    for (const country of EU_COUNTRIES) {
      expect(normalisePostcode(country, "??"), country).toBeNull();
      expect(normalisePostcode(country, ""), country).toBeNull();
    }
  });

  it("refuses formats that are close but wrong", () => {
    expect(normalisePostcode("NL", "0123 AB")).toBeNull(); // Dutch postcodes never start with 0
    expect(normalisePostcode("IE", "B02 X285")).toBeNull(); // B is not used in Eircodes
    expect(normalisePostcode("PT", "1100")).toBeNull(); // the full seven digits are required
    expect(normalisePostcode("MT", "1117")).toBeNull();
  });
});

describe("postcodes and regions beyond the EU (docs/adr/015)", () => {
  it.each([
    ["GB", "sw1a1aa", "SW1A 1AA"],
    ["GB", "M1 1AE", "M1 1AE"],
    ["CH", "CH-8001", "8001"],
    ["LI", "9490", "9490"],
    ["NO", "0150", "0150"],
    ["IS", "101", "101"],
    ["US", "62701", "62701"],
    ["US", "627011234", "62701-1234"],
    ["CA", "h2x1y4", "H2X 1Y4"],
    ["AU", "2000", "2000"],
    ["NZ", "6011", "6011"],
    ["JP", "1000001", "100-0001"],
  ] as const)("%s accepts %s and writes %s", (country, input, written) => {
    expect(normalisePostcode(country, input)).toBe(written);
  });

  it("refuses what those posts never issue", () => {
    expect(normalisePostcode("LI", "8001")).toBeNull(); // a Swiss postcode is not a Liechtenstein one
    expect(normalisePostcode("CA", "D2X 1Y4")).toBeNull(); // D is never used in Canada
    expect(normalisePostcode("GB", "12345")).toBeNull();
    expect(normalisePostcode("CH", "0800")).toBeNull();
    for (const country of DELIVERY_COUNTRIES) expect(normalisePostcode(country, "??"), country).toBeNull();
  });

  it("asks for the state in the United States, and keeps it off European addresses", () => {
    const us = { ...valid, country: "US", city: "Springfield", postcode: "62701" };
    const missing = checkoutSchema.safeParse(us);
    expect(missing.success).toBe(false);
    if (!missing.success) expect(fieldErrors(missing.error).region).toBe("region");

    const wrong = checkoutSchema.safeParse({ ...us, region: "ZZ" });
    expect(wrong.success).toBe(false);

    const ok = checkoutSchema.safeParse({ ...us, region: "il" });
    expect(ok.success && ok.data.region).toBe("IL");

    const greek = checkoutSchema.safeParse({ ...valid, region: "IL" });
    expect(greek.success && greek.data.region).toBeUndefined();
  });
});
