/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Locale routing configuration for English and Greek.
 */

import { defineRouting } from "next-intl/routing";

/**
 * Locales (docs/PLAN.md 1.4, product principle 6: bilingual from day one).
 *
 * Both locales are prefixed — `/en/...` and `/el/...` — rather than leaving
 * English at the root. An unprefixed default makes the two languages
 * structurally unequal: English URLs are shorter, canonical tags get fiddly,
 * and `hreflang` has to special-case one of them. Greek is not a translation
 * layer over an English site here; it is one of two first-class storefronts.
 */
export const routing = defineRouting({
  locales: ["en", "el"],
  defaultLocale: "en",
  localePrefix: "always",
});

export type Locale = (typeof routing.locales)[number];

export function isLocale(value: string): value is Locale {
  return (routing.locales as readonly string[]).includes(value);
}
