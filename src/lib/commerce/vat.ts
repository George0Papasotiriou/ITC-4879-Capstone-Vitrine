/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * EU VAT rates by country and conversion of prices between countries.
 */

import { divideRounded } from "@/lib/commerce/pricing-math";

/**
 * VAT by country (docs/adr/013).
 *
 * THE RULE. For goods sold online to consumers in another EU country, VAT is
 * charged at the rate of the country the goods are delivered to (EU Directive
 * 2006/112/EC as amended in 2021; declared through the One-Stop Shop). The
 * visitor's location is only a good guess of that country, so it decides the
 * prices shown while browsing; the delivery address decides the VAT charged.
 * Outside the EU no EU VAT is due on exported goods, so prices are shown
 * without VAT.
 *
 * PRICES. Catalogue prices are stored as the Greek consumer price, VAT
 * included (the shop's home market). The price in another country keeps the
 * same price before VAT and adds that country's VAT:
 *
 *   price_c = base · (1000 + r_c) / (1000 + r_GR)
 *
 * with rates in tenths of a percent, so Finland's 25.5% is exactly 255. One
 * integer multiplication and one rounded integer division: the same cent every
 * time, on the server, for every product.
 */

export const BASE_COUNTRY = "GR";

/**
 * Standard VAT rates in tenths of a percent, as of 1 January 2026 (Tax
 * Foundation, "2026 VAT Rates in Europe", checked 2026-09-14; changes since:
 * Estonia 24% from July 2025, Romania 21% from August 2025, Slovakia 23% from
 * 2025, Finland 25.5% from September 2024). Furniture, lighting and home goods
 * are taxed at the standard rate everywhere. Review this table at least once a
 * year; `VAT_RATES_AS_OF` is shown to staff.
 */
export const VAT_RATES_PER_MILLE = {
  AT: 200,
  BE: 210,
  BG: 200,
  CY: 190,
  CZ: 210,
  DE: 190,
  DK: 250,
  EE: 240,
  ES: 210,
  FI: 255,
  FR: 200,
  GR: 240,
  HR: 250,
  HU: 270,
  IE: 230,
  IT: 220,
  LT: 210,
  LU: 170,
  LV: 210,
  MT: 180,
  NL: 210,
  PL: 230,
  PT: 230,
  RO: 210,
  SE: 250,
  SI: 220,
  SK: 230,
} as const;

export const VAT_RATES_AS_OF = "2026-01-01";

export type EuCountry = keyof typeof VAT_RATES_PER_MILLE;

export const EU_COUNTRIES = Object.keys(VAT_RATES_PER_MILLE).sort() as EuCountry[];

export function isEuCountry(country: string): country is EuCountry {
  return Object.hasOwn(VAT_RATES_PER_MILLE, country);
}

/** An ISO 3166-1 alpha-2 code, upper case. */
export function isCountryCode(value: unknown): value is string {
  return typeof value === "string" && /^[A-Z]{2}$/.test(value);
}

/** The VAT rate in tenths of a percent: the country's standard rate in the EU, 0 elsewhere. */
export function vatRatePerMille(country: string): number {
  return isEuCountry(country) ? VAT_RATES_PER_MILLE[country] : 0;
}

/** "24", "25.5": the rate as people write it. */
export function formatVatRate(perMille: number, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(perMille / 10);
}

const BASE_RATE = VAT_RATES_PER_MILLE[BASE_COUNTRY];

/** The price of a catalogue item for shoppers in `country`, from its stored Greek price. */
export function localizeCents(baseCents: number, country: string): number {
  const rate = vatRatePerMille(country);
  if (rate === BASE_RATE) return baseCents;
  return divideRounded(baseCents * (1000 + rate), 1000 + BASE_RATE);
}

/**
 * The stored-price bound that matches a price bound the shopper typed in their
 * own prices. "Under €200" in Germany must find every product whose German
 * price is at most €200, and none above:
 *
 *   max: the largest base b with localizeCents(b) <= shown
 *   min: the smallest base b with localizeCents(b) >= shown
 *
 * `localizeCents` never decreases as the base grows, so a first guess from the
 * inverse ratio needs at most a step or two of correction.
 */
export function toBaseBound(shownCents: number, bound: "min" | "max", country: string): number {
  const rate = vatRatePerMille(country);
  if (rate === BASE_RATE) return shownCents;
  let base = Math.floor((shownCents * (1000 + BASE_RATE)) / (1000 + rate));
  if (bound === "max") {
    while (localizeCents(base + 1, country) <= shownCents) base += 1;
    while (base > 0 && localizeCents(base, country) > shownCents) base -= 1;
    return base;
  }
  while (base > 0 && localizeCents(base - 1, country) >= shownCents) base -= 1;
  while (localizeCents(base, country) < shownCents) base += 1;
  return base;
}

/**
 * Places that belong to an EU country but are outside the EU VAT area, where
 * EU VAT is not charged and deliveries are customs exports (Directive
 * 2006/112/EC, Article 6). Identified by postcode; the shop does not deliver
 * there yet, and says so rather than charging the wrong tax.
 *
 * Each place is an id; the storefront names it in the shopper's language
 * (`checkout.errorOutsideVatArea` in messages/).
 */
export const OUTSIDE_VAT_AREA_PLACES = [
  "canary_islands",
  "ceuta_melilla",
  "mount_athos",
  "livigno_campione",
  "busingen_heligoland",
  "french_overseas",
  "aland",
] as const;
export type OutsideVatAreaPlace = (typeof OUTSIDE_VAT_AREA_PLACES)[number];

const OUTSIDE_VAT_AREA: { country: EuCountry; test: (postcode: string) => boolean; place: OutsideVatAreaPlace }[] = [
  { country: "ES", test: (p) => /^(35|38)\d{3}$/.test(p), place: "canary_islands" },
  { country: "ES", test: (p) => /^(51|52)\d{3}$/.test(p), place: "ceuta_melilla" },
  { country: "GR", test: (p) => /^6308[67]$/.test(p), place: "mount_athos" },
  { country: "IT", test: (p) => p === "23041" || p === "22061", place: "livigno_campione" },
  { country: "DE", test: (p) => p === "78266" || p === "27498", place: "busingen_heligoland" },
  { country: "FR", test: (p) => /^97[1-6]\d{2}$/.test(p), place: "french_overseas" },
  { country: "FI", test: (p) => /^22\d{3}$/.test(p), place: "aland" },
];

export function outsideVatArea(country: string, postcode: string): OutsideVatAreaPlace | null {
  const normalised = postcode.replace(/\s|-/g, "").toUpperCase();
  return OUTSIDE_VAT_AREA.find((entry) => entry.country === country && entry.test(normalised))?.place ?? null;
}
