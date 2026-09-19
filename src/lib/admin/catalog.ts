/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Catalogue editing, the pure part: what staff may change on a product, prices typed as euros, and stock corrections.
 */

import { z } from "zod";

/**
 * Staff edit a product's words, prices and whether it is on sale
 * (docs/adr/018). Prices are typed as euros the way people write them, in
 * either convention ("1.299,00" or "1,299.00"), and stored as integer cents
 * (CLAUDE.md: money is never a float). The price is the Greek price with VAT,
 * from which every other country's price is derived (docs/adr/013).
 */

export const MAX_PRICE_CENTS = 10_000_000; // €100,000
export const MAX_HIGHLIGHTS = 12;
export const LOW_STOCK = 3;

/**
 * Euros as typed → cents, or null if it is not a price. A separator followed
 * by one or two digits at the end is the decimal point; any other separator
 * groups thousands (prices never have three decimals).
 */
export function parseEuros(text: string): number | null {
  const compact = text.replace(/[\s€]/g, "");
  if (!/^\d[\d.,]*$/.test(compact)) return null;
  const decimal = /[.,](\d{1,2})$/.exec(compact);
  const grouped = decimal === null ? compact : compact.slice(0, decimal.index);
  // The decimal point cannot also group thousands: "12,345,6" is not a price.
  if (decimal !== null && grouped.includes(compact[decimal.index]!)) return null;
  const whole = grouped.replace(/[.,](?=\d{3}(?:[.,]|$))/g, "");
  if (!/^\d+$/.test(whole)) return null;
  const cents = Number(whole) * 100 + (decimal === null ? 0 : Number(decimal[1]!.padEnd(2, "0")));
  return Number.isSafeInteger(cents) && cents <= MAX_PRICE_CENTS ? cents : null;
}

/** Cents → the form's starting value, "529.00". */
export function centsToInput(cents: number | null): string {
  return cents === null ? "" : `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, "too_long")
    .transform((value) => (value === "" ? null : value));

/** One selling point per line; blank lines ignored. */
const lines = z
  .string()
  .max(MAX_HIGHLIGHTS * 400)
  .transform((value) =>
    value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== ""),
  )
  .pipe(z.array(z.string().max(300, "line_too_long")).max(MAX_HIGHLIGHTS, "too_many"));

const euros = z.string().transform((value, context) => {
  const cents = parseEuros(value);
  if (cents === null) {
    context.addIssue({ code: "custom", message: "invalid_price" });
    return z.NEVER;
  }
  return cents;
});

/** The edit form, as sent: text fields as typed. */
export const productDetailsSchema = z
  .object({
    titleEn: z.string().trim().min(1, "required").max(200, "too_long"),
    titleEl: optionalText(200),
    descriptionEn: optionalText(5000),
    descriptionEl: optionalText(5000),
    highlightsEn: lines,
    highlightsEl: lines,
    price: euros,
    compareAt: z.string().transform((value, context) => {
      if (value.trim() === "") return null;
      const cents = parseEuros(value);
      if (cents === null) {
        context.addIssue({ code: "custom", message: "invalid_price" });
        return z.NEVER;
      }
      return cents;
    }),
    status: z.enum(["active", "archived"]),
  })
  .superRefine((details, context) => {
    // A "was" price at or below the price would advertise a discount that is not one.
    if (details.compareAt !== null && details.compareAt <= details.price) {
      context.addIssue({ code: "custom", path: ["compareAt"], message: "compare_not_above" });
    }
  })
  .transform(({ price, compareAt, highlightsEl, ...rest }) => ({
    ...rest,
    priceCents: price,
    compareAtCents: compareAt,
    // No Greek selling points is "none yet" (null), which the product page falls back from.
    highlightsEl: highlightsEl.length === 0 ? null : highlightsEl,
  }));

export type ProductDetails = z.output<typeof productDetailsSchema>;

export const stockChangeSchema = z.object({
  variantId: z.uuid(),
  // Parsed by hand rather than coerced: coercion reads an empty field as 0, which would empty the shelf.
  stock: z.union([z.number(), z.string()]).transform((value, context) => {
    const text = String(value).trim();
    const count = /^-?\d+(\.\d+)?$/.test(text) ? Number(text) : Number.NaN;
    const problem = !Number.isInteger(count) ? "whole_number" : count < 0 ? "negative" : count > 100_000 ? "too_large" : null;
    if (problem !== null) {
      context.addIssue({ code: "custom", message: problem });
      return z.NEVER;
    }
    return count;
  }),
  reason: z.string().trim().min(3, "reason_required").max(200, "too_long"),
});

export type StockChange = z.output<typeof stockChangeSchema>;

/** Field → message key, for the form to show next to each field. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    fields[key] ??= issue.message;
  }
  return fields;
}
