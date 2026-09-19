/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Countries outside the EU the shop delivers to, and who charges the tax on an order to each.
 */

/**
 * Delivery beyond the EU (docs/adr/015).
 *
 * A sale from Greece to a consumer outside the EU is an export: no EU VAT is
 * charged. The destination taxes the goods instead, in one of two ways.
 *
 * 1. TAX ON DELIVERY. The parcel is taxed when it enters the country and the
 *    carrier collects the VAT or GST (and any duty) from the customer before
 *    handing it over. The shop charges the price without tax and says plainly
 *    that this may be due. This is the rule almost everywhere.
 *
 * 2. THE SELLER CHARGES IT. Some countries make foreign sellers collect their
 *    tax at the checkout on low-value parcels. Of the countries here, the United
 *    Kingdom does so from the very first sale: UK VAT at 20% on consignments
 *    worth up to £135, delivery excluded. Norway (VOEC), Australia and New
 *    Zealand have similar schemes, but a seller joins them only once its sales
 *    there pass a yearly threshold (NOK 50,000, AUD 75,000, NZD 60,000); a new
 *    shop is below all three, so its parcels to those countries are ordinary
 *    imports. Their thresholds are kept in the comments below for the day that
 *    changes.
 *
 * The UK threshold is in pounds and the shop sells in euros, so it is converted
 * at a conservative reference rate that makes the euro limit err high: a basket
 * near the limit is treated as low-value and the shop collects the tax itself,
 * the side of the line that never leaves a customer owing a tax the seller was
 * required to collect.
 *
 * The software applies the rules; selling under the UK one also needs the shop
 * to be registered for UK VAT. That is a business step, recorded in the ADR.
 */

import { EU_COUNTRIES, isEuCountry, type EuCountry } from "@/lib/commerce/vat";

export type ExportZone = "europe" | "world";

export type ExportCountry = {
  /** VAT or GST due at the destination, tenths of a percent: shown to the customer either way. */
  taxPerMille: number;
  /** What the tax is called there, for the checkout line. */
  taxName: "VAT" | "GST" | "consumption tax" | "sales tax";
  zone: ExportZone;
  /** When the seller charges the tax at checkout: goods up to this value, in euro cents. */
  sellerCollectsUpToCents: number | null;
};

export const EXPORT_COUNTRIES = {
  // Rest of Europe
  GB: { taxPerMille: 200, taxName: "VAT", zone: "europe", sellerCollectsUpToCents: 16_000 }, // £135 at €1 = £0.84: errs high
  NO: { taxPerMille: 250, taxName: "VAT", zone: "europe", sellerCollectsUpToCents: null }, // VOEC (items ≤ NOK 3,000) once sales pass NOK 50,000/yr
  CH: { taxPerMille: 81, taxName: "VAT", zone: "europe", sellerCollectsUpToCents: null },
  LI: { taxPerMille: 81, taxName: "VAT", zone: "europe", sellerCollectsUpToCents: null }, // Swiss VAT territory
  IS: { taxPerMille: 240, taxName: "VAT", zone: "europe", sellerCollectsUpToCents: null },
  // Rest of the world
  US: { taxPerMille: 0, taxName: "sales tax", zone: "world", sellerCollectsUpToCents: null }, // no federal VAT; state sales tax varies
  CA: { taxPerMille: 50, taxName: "GST", zone: "world", sellerCollectsUpToCents: null }, // federal GST; provinces add their own
  AU: { taxPerMille: 100, taxName: "GST", zone: "world", sellerCollectsUpToCents: null }, // ≤ AUD 1,000 once sales pass AUD 75,000/yr
  NZ: { taxPerMille: 150, taxName: "GST", zone: "world", sellerCollectsUpToCents: null }, // ≤ NZD 1,000 once sales pass NZD 60,000/yr
  JP: { taxPerMille: 100, taxName: "consumption tax", zone: "world", sellerCollectsUpToCents: null },
} as const satisfies Record<string, ExportCountry>;

/** When the rates, thresholds and the reference exchange rate were last checked. */
export const EXPORT_RULES_AS_OF = "2026-09-19";

export type ExportCountryCode = keyof typeof EXPORT_COUNTRIES;
export const EXPORT_COUNTRY_CODES = Object.keys(EXPORT_COUNTRIES).sort() as ExportCountryCode[];

export function isExportCountry(country: string): country is ExportCountryCode {
  return Object.hasOwn(EXPORT_COUNTRIES, country);
}

/**
 * Who charges the tax on this order, and at what rate.
 *
 *   seller:      the shop charges the destination's tax at checkout
 *   on_delivery: the customer may owe import tax to the carrier; the shop charges none
 */
export type ExportTax = { collectedBy: "seller" | "on_delivery"; ratePerMille: number; taxName: ExportCountry["taxName"] };

/** Every country the shop delivers to: the EU and the exports above. */
export type DeliveryCountry = EuCountry | ExportCountryCode;
export const DELIVERY_COUNTRIES = [...EU_COUNTRIES, ...EXPORT_COUNTRY_CODES].sort() as DeliveryCountry[];

export function isDeliveryCountry(country: string): country is DeliveryCountry {
  return isEuCountry(country) || isExportCountry(country);
}

/** The tax's name as a message key, for sentences that name it in the shopper's language. */
export function taxKey(name: ExportCountry["taxName"]): "vat" | "gst" | "consumption" | "sales" {
  return name === "VAT" ? "vat" : name === "GST" ? "gst" : name === "consumption tax" ? "consumption" : "sales";
}

/** The regime for an order whose goods are worth `goodsNetCents` before any tax, delivery excluded. */
export function exportTax(country: ExportCountryCode, goodsNetCents: number): ExportTax {
  const rules: ExportCountry = EXPORT_COUNTRIES[country];
  const sellerCollects = rules.sellerCollectsUpToCents !== null && goodsNetCents <= rules.sellerCollectsUpToCents;
  return { collectedBy: sellerCollects ? "seller" : "on_delivery", ratePerMille: rules.taxPerMille, taxName: rules.taxName };
}
