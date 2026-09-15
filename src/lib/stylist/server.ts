/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Request-scoped Budget Stylist access for pages and route handlers.
 */

import { connection } from "next/server";

import { currentRegion } from "@/lib/commerce/region";
import { sql } from "@/lib/db/client";
import { createRetrievers } from "@/lib/search/retrieve";
import { createStylist, type Stylist } from "@/lib/stylist/stylist";

/** The Budget Stylist for pages and route handlers: request-time, created on first use. */
let stylist: Stylist | undefined;
const instance = () => (stylist ??= createStylist(sql, createRetrievers(sql)));

export async function buildBundles(request: unknown) {
  await connection();
  const { country } = await currentRegion();
  return instance().build(request, { country });
}

export async function bundleSwaps(request: unknown, bundleIndex: number, slotId: string) {
  await connection();
  const { country } = await currentRegion();
  return instance().swaps(request, bundleIndex, slotId, { country });
}
