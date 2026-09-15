/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Loads the message catalogue for the request's locale.
 */

import { getRequestConfig } from "next-intl/server";

import { isLocale, routing } from "@/i18n/routing";

/**
 * Loads the message catalogue for the request's locale.
 *
 * An unknown locale falls back to the default rather than throwing: a stale
 * link or a typo in a URL should show an English page, not a 500.
 */
export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = requested !== undefined && isLocale(requested)
    ? requested
    : routing.defaultLocale;

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
    // Money and dates are formatted from the locale, never hard-coded.
    timeZone: "Europe/Athens",
  };
});
