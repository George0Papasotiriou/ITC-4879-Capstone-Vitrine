/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Pure cart and order totals: line prices, shipping zones and included VAT.
 */

import { DEFAULT_CURRENCY, money, type Money } from "@/lib/commerce/money";
import { divideRounded } from "@/lib/commerce/pricing-math";
import { exportTax, EXPORT_COUNTRIES, isExportCountry, type ExportTax } from "@/lib/commerce/exports";
import { BASE_COUNTRY, isEuCountry, localizeAtRate, VAT_RATES_PER_MILLE, vatRatePerMille } from "@/lib/commerce/vat";

export { divideRounded };

/**
 * Cart and order totals (docs/PLAN.md Phase 5, CLAUDE.md golden rule 5,
 * docs/adr/013).
 *
 * Pure: the caller passes the stored (Greek, VAT-included) unit prices it has
 * just read from the database and the country the prices are for; the server
 * recomputes this for every cart view and again when an order is placed, with
 * the delivery country. Nothing here trusts a total from a browser or a model.
 *
 * Consumer prices in the EU include VAT, so VAT is never added on top: it is
 * the part of the total that is tax, stated on the receipt,
 *
 *   VAT = total · r / (1000 + r)        (r in tenths of a percent)
 *
 * computed once on the whole total (goods and their delivery carry the same
 * standard rate) and rounded half away from zero in integer arithmetic.
 */

export const MAX_QUANTITY_PER_LINE = 10;
export const MAX_LINES = 50;

export type ShippingMethodId = "standard" | "express";
export type ShippingZone = "domestic" | "cyprus" | "eu" | "europe" | "world";

export type ShippingMethod = {
  id: ShippingMethodId;
  /** In stored-price terms (Greek VAT included); converted to the destination like any price. */
  baseCents: number;
  /** Stored-price subtotal from which this method is free; null when it never is. */
  freeFromBaseCents: number | null;
  /** Working days, for "arrives in 2–4 working days". */
  days: [number, number];
};

/**
 * Flat rates by zone. Defaults for George to confirm (docs/adr/012, 013):
 * furniture ships from Athens, so Greece is domestic, Cyprus is a sea
 * shipment, and the rest of the EU goes by road freight.
 */
export const SHIPPING_RATES: Readonly<Record<ShippingZone, Readonly<Record<ShippingMethodId, ShippingMethod>>>> = {
  domestic: {
    standard: { id: "standard", baseCents: 690, freeFromBaseCents: 15_000, days: [2, 4] },
    express: { id: "express", baseCents: 1_490, freeFromBaseCents: null, days: [1, 1] },
  },
  cyprus: {
    standard: { id: "standard", baseCents: 1_990, freeFromBaseCents: 40_000, days: [4, 7] },
    express: { id: "express", baseCents: 3_990, freeFromBaseCents: null, days: [2, 3] },
  },
  eu: {
    standard: { id: "standard", baseCents: 2_490, freeFromBaseCents: 50_000, days: [5, 9] },
    express: { id: "express", baseCents: 4_990, freeFromBaseCents: null, days: [2, 4] },
  },
  // Exports (docs/adr/015), set by their price without VAT: none is in them.
  europe: {
    standard: { id: "standard", baseCents: fromNet(3_990), freeFromBaseCents: fromNet(80_000), days: [6, 12] },
    express: { id: "express", baseCents: fromNet(7_990), freeFromBaseCents: null, days: [3, 5] },
  },
  world: {
    standard: { id: "standard", baseCents: fromNet(7_990), freeFromBaseCents: null, days: [10, 20] },
    express: { id: "express", baseCents: fromNet(14_990), freeFromBaseCents: null, days: [4, 7] },
  },
};

/**
 * A stored-terms amount from a price without VAT. Export rates are set by what
 * the customer pays, which carries no Greek VAT; everything in the shop is
 * stored with it, so the conversion is written once, here.
 */
function fromNet(netCents: number): number {
  return divideRounded(netCents * (1000 + VAT_RATES_PER_MILLE[BASE_COUNTRY]), 1000);
}

/** Where the shop delivers: the EU, and the export countries in exports.ts. Null for anywhere else. */
export function shippingZone(country: string): ShippingZone | null {
  if (country === BASE_COUNTRY) return "domestic";
  if (country === "CY") return "cyprus";
  if (isEuCountry(country)) return "eu";
  return isExportCountry(country) ? EXPORT_COUNTRIES[country].zone : null;
}

export function shippingMethod(country: string, method: ShippingMethodId): ShippingMethod | null {
  const zone = shippingZone(country);
  return zone === null ? null : SHIPPING_RATES[zone][method];
}

export function isShippingMethod(value: unknown): value is ShippingMethodId {
  return value === "standard" || value === "express";
}

export type PriceLineInput = {
  /** Stored unit price in minor units (Greek, VAT included), as read from the database. */
  unitCents: number;
  quantity: number;
};

export type PricedLine = PriceLineInput & {
  /** Unit price for the country. */
  localUnitCents: number;
  lineCents: number;
};

export type Totals = {
  country: string;
  lines: PricedLine[];
  itemCount: number;
  subtotal: Money;
  shipping: Money;
  total: Money;
  /** The VAT contained in the total. */
  vat: Money;
  /** The tax the shop charges, tenths of a percent: 240 for 24%, 255 for 25.5%, 0 for an export taxed on delivery. */
  vatRatePerMille: number;
  /** For a delivery outside the EU: who charges the destination's tax, and at what rate. Null inside the EU. */
  exportTax: ExportTax | null;
  /** False when the shop does not deliver to the country. */
  deliverable: boolean;
  /** How much more to spend for free standard delivery; null when already free or not applicable. */
  freeShippingRemaining: Money | null;
};

/** The VAT contained in a VAT-inclusive amount, at a rate in tenths of a percent. */
export function includedVat(grossCents: number, ratePerMille = vatRatePerMille(BASE_COUNTRY)): number {
  return divideRounded(grossCents * ratePerMille, 1000 + ratePerMille);
}

export class PricingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PricingError";
  }
}

export function priceCart(
  lines: readonly PriceLineInput[],
  { shipping = "standard", country = BASE_COUNTRY, currency = DEFAULT_CURRENCY }: { shipping?: ShippingMethodId; country?: string; currency?: string } = {},
): Totals {
  if (lines.length > MAX_LINES) throw new PricingError(`A cart holds at most ${MAX_LINES} lines`);
  for (const line of lines) {
    if (!Number.isSafeInteger(line.unitCents) || line.unitCents < 0) throw new PricingError("Unit prices must be non-negative integer cents");
    if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > MAX_QUANTITY_PER_LINE) {
      throw new PricingError(`Quantities must be whole numbers from 1 to ${MAX_QUANTITY_PER_LINE}`);
    }
  }

  const baseSubtotal = lines.reduce((sum, line) => sum + line.unitCents * line.quantity, 0);
  // The rate the shop charges: the destination's VAT inside the EU; for an
  // export, the destination's tax only where the shop must collect it
  // (exports.ts), and otherwise none, because the customer pays it on delivery.
  // The export threshold is judged on the goods before any tax, delivery excluded.
  const exportRegime = isExportCountry(country) ? exportTax(country, localizeAtRate(baseSubtotal, 0)) : null;
  const rate = exportRegime === null ? vatRatePerMille(country) : exportRegime.collectedBy === "seller" ? exportRegime.ratePerMille : 0;

  const priced = lines.map((line) => {
    // Convert the unit price, then multiply: the line always equals quantity × the unit price shown.
    const localUnitCents = localizeAtRate(line.unitCents, rate);
    return { ...line, localUnitCents, lineCents: localUnitCents * line.quantity };
  });
  const subtotalCents = priced.reduce((sum, line) => sum + line.lineCents, 0);
  const method = shippingMethod(country, shipping);
  // Free delivery is decided on stored prices, so it does not flip with rounding between countries.
  const free = method !== null && method.freeFromBaseCents !== null && baseSubtotal >= method.freeFromBaseCents;
  const shippingCents = priced.length === 0 || method === null || free ? 0 : localizeAtRate(method.baseCents, rate);
  const totalCents = subtotalCents + shippingCents;

  const standard = shippingMethod(country, "standard");
  const freeFrom = standard?.freeFromBaseCents ?? null;
  const remaining =
    priced.length > 0 && freeFrom !== null && baseSubtotal < freeFrom ? Math.max(1, localizeAtRate(freeFrom, rate) - subtotalCents) : null;

  return {
    country,
    lines: priced,
    itemCount: priced.reduce((sum, line) => sum + line.quantity, 0),
    subtotal: money(subtotalCents, currency),
    shipping: money(shippingCents, currency),
    total: money(totalCents, currency),
    vat: money(includedVat(totalCents, rate), currency),
    vatRatePerMille: rate,
    exportTax: exportRegime,
    deliverable: method !== null,
    freeShippingRemaining: remaining === null ? null : money(remaining, currency),
  };
}
