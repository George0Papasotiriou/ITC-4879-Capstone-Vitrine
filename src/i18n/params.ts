/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Validates the locale route segment and pins it for the request.
 */

import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

import { routing, type Locale } from "@/i18n/routing";

/**
 * Validates the locale segment and pins it for the request.
 *
 * Every localised page calls this first. It exists because the layout's own
 * check is not enough on its own: a layout and its page render concurrently, so
 * a page can format money with a bogus locale and throw
 * `RangeError: Incorrect locale information provided` before the layout's
 * `notFound()` takes effect. That is not hypothetical — it is what a request to
 * `/cart` did before the proxy was fixed, because `/cart` matched `/[locale]`
 * with the locale "cart".
 *
 * Validating in one shared helper means a new page cannot forget to do it
 * without also forgetting to get its locale.
 */
export async function requireLocale(
  params: Promise<{ locale: string }>,
): Promise<Locale> {
  const { locale } = await params;

  if (!hasLocale(routing.locales, locale)) notFound();

  // Lets the page be statically rendered rather than opting into dynamic
  // rendering the moment it reads a translation.
  setRequestLocale(locale);

  return locale;
}
