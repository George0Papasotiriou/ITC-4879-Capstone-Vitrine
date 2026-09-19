/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Writes the town line of a delivery address the way each country's post expects it.
 */

import type { ShippingAddress } from "@/lib/db/schema";

/**
 * The line with the town, postcode and country, in the order the destination's
 * postal service reads it. Most of Europe puts the postcode first
 * ("105 63 Athens"); the United States puts the state and ZIP code after the
 * town ("Springfield, IL 62701"); Canada and Australia do the same without the
 * comma; the United Kingdom writes the postcode after the town.
 */
export function localityLine(address: Pick<ShippingAddress, "city" | "postcode" | "country" | "region">): string {
  const { city, postcode, country, region } = address;
  let line: string;
  if (country === "US" && region !== undefined) line = `${city}, ${region} ${postcode}`;
  else if ((country === "CA" || country === "AU") && region !== undefined) line = `${city} ${region} ${postcode}`;
  else if (country === "GB") line = `${city} ${postcode}`;
  else line = `${postcode} ${city}`;
  return `${line}, ${country}`;
}
