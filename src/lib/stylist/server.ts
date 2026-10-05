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
import { cached } from "@/lib/kv/cache";
import { createRetrievers } from "@/lib/search/retrieve";
import { createStylist, type Stylist } from "@/lib/stylist/stylist";
import { CAPSULE_SIZES, createWardrobe, type Wardrobe } from "@/lib/stylist/wardrobe";
import type { Department } from "@/lib/optimize/outfit";

export type CapsuleSize = keyof typeof CAPSULE_SIZES;

/** The Budget Stylist for pages and route handlers: request-time, created on first use. */
let stylist: Stylist | undefined;
const instance = () => (stylist ??= createStylist(sql, createRetrievers(sql)));

export async function buildBundles(request: unknown, options: { showable?: boolean } = {}) {
  await connection();
  const { country } = await currentRegion();
  return instance().build(request, { country, ...options });
}

export async function bundleSwaps(request: unknown, bundleIndex: number, slotId: string) {
  await connection();
  const { country } = await currentRegion();
  return instance().swaps(request, bundleIndex, slotId, { country });
}

let wardrobe: Wardrobe | undefined;
const wardrobeInstance = () => (wardrobe ??= createWardrobe(sql));

/**
 * Both are the same for everyone in a country and costly to work out (a
 * capsule up to a few seconds of CPU), so they are kept in the shared cache
 * (docs/adr/039): cleared when the catalogue changes, and refreshed every
 * half hour for stock. The pages read prices and stock fresh around them.
 */
const LOOK_CACHE_SECONDS = 10 * 60;
const CAPSULE_CACHE_SECONDS = 30 * 60;

/** "Complete the look" around a piece (docs/adr/066), in the shopper's prices. */
export async function lookFor(productId: string, budgetCents?: number) {
  await connection();
  const { country } = await currentRegion();
  return cached("wardrobe", { look: productId, country, budgetCents: budgetCents ?? null }, LOOK_CACHE_SECONDS, () => wardrobeInstance().lookFor(productId, country, budgetCents));
}

/** A capsule wardrobe (docs/adr/066), in the shopper's prices. */
export async function capsuleFor(department: Department, size: CapsuleSize, budgetCents: number) {
  await connection();
  const { country } = await currentRegion();
  return cached("wardrobe", { capsule: department, size, budgetCents, country }, CAPSULE_CACHE_SECONDS, () => wardrobeInstance().capsule(department, size, budgetCents, country));
}
