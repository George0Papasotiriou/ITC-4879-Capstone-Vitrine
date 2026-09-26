/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Asking in words for the shop to be easier to see or calmer to watch, in English or Greek.
 */

import { DEFAULT_COMFORT, type Comfort } from "@/lib/comfort/settings";

/**
 * docs/adr/032. "The text is too small", "stop the animations", «μεγαλύτερα
 * γράμματα»: people say what bothers them, not the name of a setting. A
 * language model understands such sentences by itself; this is the rule-based
 * reading the keyless Concierge uses, and the evaluation's reference for what
 * each sentence should change. Only clear requests match: a sentence about a
 * large sofa must not make the text large.
 */

const fold = (text: string) => text.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");

const RULES: [RegExp, Partial<Comfort>][] = [
  // Everything back as the shop sets it.
  [/\b(reset|default|normal)( the)?( display)? (display|settings|view|text size)\b|\bback to normal\b|επαναφορα|κανονικες ρυθμισεις/, { ...DEFAULT_COMFORT }],
  [/\b(largest|biggest|much (bigger|larger)|huge) (text|letters|font)\b|πολυ μεγαλ\p{L}* (γραμματα|κειμενο)/u, { text: "150" }],
  [/\b(bigger|larger|increase the) (text|letters|font)\b|\bmake (the )?(text|letters|font) (bigger|larger)\b|\b(text|letters|font) (is |are )?(too )?(small|tiny)\b|\bcan'?t (read|see) (the )?(text|letters)\b|\bzoom in\b|μεγαλυτερ\p{L}* (γραμματα|κειμενο|γραμματοσειρα)|μεγαλωσε τα γραμματα|μικρα (τα )?γραμματα|δεν (βλεπω|διαβαζω) (καλα )?τα γραμματα/u, { text: "125" }],
  [/\b(smaller|normal size) (text|letters|font)\b|μικροτερ\p{L}* (γραμματα|κειμενο)/u, { text: "100" }],
  [/\b(less|no|reduce|stop|fewer)( the)? (motion|movement|animations?|effects)\b|\btoo (much )?(motion|movement|animat\w*)\b|\b(animations?|motion) (make|makes|is|are) (me )?(dizzy|sick)\b|λιγοτερ\p{L}* κινηση|χωρις (κινηση|εφε|κινουμενα)|σταματα τα (εφε|κινουμενα)|ζαλιζ/u, { motion: "reduce" }],
  [/\b(more|higher|stronger) contrast\b|\bcontrast\b.*\b(higher|stronger|more)\b|περισσοτερη αντιθεση|εντονοτερ\p{L}* (χρωματα|αντιθεση)/u, { contrast: "more" }],
  [/\b(dyslexi\w*|readable|legible|easier to read) (font|typeface|letters)\b|\bfont (for|with) dyslexia\b|ευαναγνωστ\p{L}* (γραμματοσειρα|γραμματα)|δυσλεξ/u, { font: "readable" }],
  [/\b(wider|more) (spacing|space between (lines|letters|words))\b|\b(lines|text) (are |is )?too (close|cramped|tight)\b|περισσοτερ\p{L}* (αποσταση|κενο) αναμεσα/u, { spacing: "wide" }],
  [/\bunderline(d)? (the )?links\b|\blinks underlined\b|υπογραμμισ\p{L}* (τους )?συνδεσμους/u, { links: "underline" }],
  [/\b(bigger|larger) (buttons|targets|controls)\b|\bbuttons are too small\b|μεγαλυτερ\p{L}* κουμπια|μικρα (τα )?κουμπια/u, { targets: "large" }],
  [/\breading (guide|ruler|line)\b|οδηγος αναγνωσης|χαρακα αναγνωσης/u, { guide: "on" }],
];

/**
 * Point by number, by voice: "show numbers", "hide numbers", and then a number
 * ("12", "number 12", «αριθμός 12»). A bare number only counts while the
 * numbers are on screen, so "two" in a shopping sentence is never a press.
 */
export function numbersRequestOf(text: string, numbersShown: boolean): { show: boolean } | { pick: number } | null {
  const t = fold(text).trim().replace(/[.!?;]+$/, "");
  if (/^(show|display)( the)? numbers$|^δειξε( τους)? αριθμους$/.test(t)) return { show: true };
  if (/^(hide|close)( the)? numbers$|^κρυψε( τους)? αριθμους$/.test(t)) return { show: false };
  if (!numbersShown) return null;
  const pick = /^(?:number |press |click |αριθμος |πατα )?(\d{1,2})$/.exec(t);
  return pick === null ? null : { pick: Number(pick[1]) };
}

/** What a sentence asks the display to change, or null when it asks for nothing of the kind. */
export function comfortRequestOf(text: string): Partial<Comfort> | null {
  const t = fold(text);
  let change: Partial<Comfort> | null = null;
  for (const [pattern, settings] of RULES) {
    if (!pattern.test(t)) continue;
    // A reset stands alone; anything else can combine ("bigger text and less motion").
    if (Object.keys(settings).length === Object.keys(DEFAULT_COMFORT).length) return settings;
    // The first rule to name a setting wins: "much bigger text" is not also plain "bigger text".
    change = { ...settings, ...(change ?? {}) };
  }
  return change;
}
