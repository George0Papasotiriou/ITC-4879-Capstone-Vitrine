/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Determines which country's prices a request shows.
 */

import { connection } from "next/server";
import { cookies, headers } from "next/headers";
import { cache } from "react";

import { shippingZone } from "@/lib/commerce/pricing";
import { BASE_COUNTRY, isCountryCode, isEuCountry, vatRatePerMille } from "@/lib/commerce/vat";
import { countryFromRequest } from "@/lib/geo/server";

/**
 * Which country's prices this request shows (docs/adr/013), in order:
 *
 *   1. the shopper's own choice, remembered in a cookie;
 *   2. where the request comes from (CDN header or local IP database);
 *   3. Greece, the shop's home market.
 *
 * The browser's language is deliberately not used: many people in Greece run
 * English browsers set to en-US, and would be shown American prices without
 * VAT. Checkout always uses the delivery country, whatever this says.
 */

export const COUNTRY_COOKIE = "vt_country";

export type Region = {
  country: string;
  source: "choice" | "location" | "default";
  vatRatePerMille: number;
  inEu: boolean;
  /** Whether the shop delivers there. */
  deliverable: boolean;
};

export function regionFor(country: string, source: Region["source"]): Region {
  return { country, source, vatRatePerMille: vatRatePerMille(country), inEu: isEuCountry(country), deliverable: shippingZone(country) !== null };
}

export const currentRegion = cache(async (): Promise<Region> => {
  await connection();
  const chosen = (await cookies()).get(COUNTRY_COOKIE)?.value?.toUpperCase();
  if (isCountryCode(chosen)) return regionFor(chosen, "choice");
  const located = countryFromRequest(await headers());
  if (located !== null) return regionFor(located, "location");
  return regionFor(BASE_COUNTRY, "default");
});
