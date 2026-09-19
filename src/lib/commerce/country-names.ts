/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Country names for lists and for the middle of a sentence, which in English sometimes needs "the".
 */

/**
 * The browser's own country names (Intl.DisplayNames) are right in a list, but
 * in an English sentence a few of them need the definite article: "delivery to
 * the United States", "21% for the Netherlands". These are the countries the
 * shop names in sentences that take it.
 */
const ENGLISH_WITH_THE = new Set(["AE", "BS", "GB", "GM", "NL", "PH", "US"]);

export function countryNames(locale: string): { name: (code: string) => string; inSentence: (code: string) => string } {
  const names = new Intl.DisplayNames([locale], { type: "region" });
  const name = (code: string) => names.of(code) ?? code;
  const english = locale === "en" || locale.startsWith("en-");
  return { name, inSentence: (code) => (english && ENGLISH_WITH_THE.has(code) ? `the ${name(code)}` : name(code)) };
}
