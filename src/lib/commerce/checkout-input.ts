/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Checkout form schema: contact, EU address and per-country postcode validation.
 */

import { z } from "zod";

import { DELIVERY_COUNTRIES, type DeliveryCountry } from "@/lib/commerce/exports";
import { needsRegion, normaliseRegion } from "@/lib/commerce/regions";

/**
 * What the checkout form may send (Zod at the boundary, CLAUDE.md conventions).
 * Deliberately no prices, totals or product ids: those come from the cart in
 * the database. Errors are reported per field as stable codes, which the form
 * turns into sentences in the shopper's language.
 *
 * Delivery is to the EU (docs/adr/013) and to the export countries
 * (docs/adr/015); the postcode is checked against the country's own format, and
 * the United States, Canada and Australia also need their state or province.
 */

/**
 * Postcode formats, checked on the compact form (upper case, spaces removed;
 * the country prefixes some people write, such as "LV-" or "L-", removed).
 * Where a format has a customary separator it is restored for storage.
 */
const POSTCODES: Record<DeliveryCountry, { pattern: RegExp; format?: (compact: string) => string; strip?: RegExp }> = {
  AT: { pattern: /^\d{4}$/ },
  BE: { pattern: /^\d{4}$/ },
  BG: { pattern: /^\d{4}$/ },
  CY: { pattern: /^\d{4}$/ },
  CZ: { pattern: /^\d{5}$/, format: (c) => `${c.slice(0, 3)} ${c.slice(3)}` },
  DE: { pattern: /^\d{5}$/ },
  DK: { pattern: /^\d{4}$/, strip: /^DK-?/ },
  EE: { pattern: /^\d{5}$/ },
  ES: { pattern: /^\d{5}$/ },
  FI: { pattern: /^\d{5}$/, strip: /^FI-?/ },
  FR: { pattern: /^\d{5}$/ },
  GR: { pattern: /^\d{5}$/, format: (c) => `${c.slice(0, 3)} ${c.slice(3)}` },
  HR: { pattern: /^\d{5}$/, strip: /^HR-?/ },
  HU: { pattern: /^\d{4}$/ },
  // Eircode: a routing key (letter, digit, digit or W) and a four-character identifier.
  IE: { pattern: /^[AC-FHKNPRTV-Y]\d[\dW][0-9AC-FHKNPRTV-Y]{4}$/, format: (c) => `${c.slice(0, 3)} ${c.slice(3)}` },
  IT: { pattern: /^\d{5}$/ },
  LT: { pattern: /^\d{5}$/, strip: /^LT-?/, format: (c) => `LT-${c}` },
  LU: { pattern: /^\d{4}$/, strip: /^L-?/, format: (c) => `L-${c}` },
  LV: { pattern: /^\d{4}$/, strip: /^LV-?/, format: (c) => `LV-${c}` },
  MT: { pattern: /^[A-Z]{3}\d{4}$/, format: (c) => `${c.slice(0, 3)} ${c.slice(3)}` },
  NL: { pattern: /^[1-9]\d{3}[A-Z]{2}$/, format: (c) => `${c.slice(0, 4)} ${c.slice(4)}` },
  PL: { pattern: /^\d{5}$/, format: (c) => `${c.slice(0, 2)}-${c.slice(2)}` },
  PT: { pattern: /^\d{7}$/, format: (c) => `${c.slice(0, 4)}-${c.slice(4)}` },
  RO: { pattern: /^\d{6}$/ },
  SE: { pattern: /^\d{5}$/, strip: /^SE-?/, format: (c) => `${c.slice(0, 3)} ${c.slice(3)}` },
  SI: { pattern: /^\d{4}$/, strip: /^SI-?/ },
  SK: { pattern: /^\d{5}$/, format: (c) => `${c.slice(0, 3)} ${c.slice(3)}` },
  // Beyond the EU (docs/adr/015).
  // UK: an outward code (area and district) and an inward code (sector digit and unit letters).
  GB: { pattern: /^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/, format: (c) => `${c.slice(0, -3)} ${c.slice(-3)}` },
  CH: { pattern: /^[1-9]\d{3}$/, strip: /^CH-?/ },
  LI: { pattern: /^94(8[5-9]|9[0-8])$/, strip: /^(FL|LI)-?/ },
  NO: { pattern: /^\d{4}$/, strip: /^NO-?/ },
  IS: { pattern: /^\d{3}$/, strip: /^IS-?/ },
  US: { pattern: /^\d{5}(\d{4})?$/, format: (c) => (c.length === 9 ? `${c.slice(0, 5)}-${c.slice(5)}` : c) },
  // Canada: letter-digit-letter, digit-letter-digit, without the letters Canada Post never uses.
  CA: { pattern: /^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z]\d[ABCEGHJ-NPRSTV-Z]\d$/, format: (c) => `${c.slice(0, 3)} ${c.slice(3)}` },
  AU: { pattern: /^\d{4}$/ },
  NZ: { pattern: /^\d{4}$/ },
  JP: { pattern: /^\d{7}$/, format: (c) => `${c.slice(0, 3)}-${c.slice(3)}` },
};

/** The postcode in its customary written form, or null when it does not fit the country's format. */
export function normalisePostcode(country: DeliveryCountry, input: string): string | null {
  const rule = POSTCODES[country];
  let compact = input.trim().toUpperCase().replace(/\s+/g, "");
  if (rule.strip !== undefined) compact = compact.replace(rule.strip, "");
  compact = compact.replace(/-/g, "");
  if (!rule.pattern.test(compact)) return null;
  return rule.format === undefined ? compact : rule.format(compact);
}

const trimmed = (max: number) => z.string().trim().min(1, "required").max(max, "too_long");

export const checkoutSchema = z
  .object({
    email: z.string().trim().max(254, "too_long").pipe(z.email("email")),
    name: trimmed(120),
    line1: trimmed(160),
    line2: z.string().trim().max(160, "too_long").optional().transform((value) => (value === "" ? undefined : value)),
    city: trimmed(80),
    postcode: z.string().trim().max(12, "too_long"),
    country: z.enum(DELIVERY_COUNTRIES as [DeliveryCountry, ...DeliveryCountry[]], "country"),
    region: z.string().trim().max(40, "too_long").optional(),
    phone: z
      .string()
      .trim()
      .max(30, "too_long")
      .regex(/^[+0-9 ()-]*$/, "phone")
      .optional()
      .transform((value) => (value === "" ? undefined : value)),
    shipping: z.enum(["standard", "express"]),
    idempotencyKey: z.uuid(),
    locale: z.enum(["en", "el"]),
  })
  .superRefine((value, ctx) => {
    if (normalisePostcode(value.country, value.postcode) === null) ctx.addIssue({ code: "custom", path: ["postcode"], message: "postcode" });
    if (needsRegion(value.country) && normaliseRegion(value.country, value.region ?? "") === null) {
      ctx.addIssue({ code: "custom", path: ["region"], message: "region" });
    }
  })
  .transform((value) => ({
    ...value,
    postcode: normalisePostcode(value.country, value.postcode) ?? value.postcode,
    // Kept only where an address needs it, so a stray value never prints on a European label.
    region: needsRegion(value.country) ? (normaliseRegion(value.country, value.region ?? "") ?? undefined) : undefined,
  }));

export type CheckoutInput = z.infer<typeof checkoutSchema>;

export type CheckoutFieldError = "required" | "email" | "postcode" | "phone" | "too_long" | "country" | "region";

const CODES: readonly CheckoutFieldError[] = ["required", "email", "postcode", "phone", "too_long", "country", "region"];

/** The first error code per field, for showing next to that field. */
export function fieldErrors(error: z.ZodError): Record<string, CheckoutFieldError> {
  const errors: Record<string, CheckoutFieldError> = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? "form");
    if (errors[field] !== undefined) continue;
    const code = issue.message as CheckoutFieldError;
    errors[field] = CODES.includes(code) ? code : "required";
  }
  return errors;
}
