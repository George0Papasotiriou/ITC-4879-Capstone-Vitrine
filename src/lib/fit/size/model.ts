/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The Fit Engine's parameters as the shop uses them: learned on RentTheRunway's fit records (E12) and carried over to the shop's size steps.
 */

import learned from "@/lib/fit/size/model.json";
import type { FitParams } from "@/lib/fit/size/ordinal";

/**
 * docs/adr/064. research/fit learns the six parameters on RentTheRunway
 * (E12), in steps of each item's size ladder, and writes them here with the
 * scale that turns them into the shop's. The data cannot fix the margin in
 * size steps: renters mostly take their own size, so how far off a size may
 * be is barely identified there (E12's margin is many steps wide). The
 * shop's charts can: a body at a size's limit is halfway to the next size
 * (body.ts), so "fits" is half a size either way. Every parameter is carried
 * over in proportion (`scale` = 0.5 / learned margin): only ratios travel —
 * how noisy an outcome is against the margin, how unsure an unknown item or
 * shopper is — never RentTheRunway's own units.
 */
export const LEARNED = learned as { source: string; params: FitParams; scale: number };

export const SHOP_FIT_PARAMS: FitParams = {
  margin: LEARNED.params.margin * LEARNED.scale,
  noise: LEARNED.params.noise * LEARNED.scale,
  itemPrior: LEARNED.params.itemPrior * LEARNED.scale,
  tolerancePrior: LEARNED.params.tolerancePrior * LEARNED.scale,
  customerPrior: LEARNED.params.customerPrior * LEARNED.scale,
  drift: LEARNED.params.drift * LEARNED.scale,
};
