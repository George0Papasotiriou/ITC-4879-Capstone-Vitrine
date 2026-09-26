/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Comfort settings: how the shop is shown to one person — text size, spacing, contrast, font, motion — and how they are kept.
 */

/**
 * docs/adr/032. The floor of 4.7 (WCAG 2.2 AA) makes the shop usable; these
 * settings make it comfortable for the person using it, whatever their
 * eyesight, reading or attention. Each is a data attribute on <html> that the
 * stylesheet answers, so a setting changes the whole shop at once, including
 * pages rendered on the server and cached for everyone else.
 *
 * They are kept in a cookie on the device (and, signed in, on the account), and
 * applied by a small script in the page's head before the first paint: a
 * person who needs large text never sees the small text first.
 *
 * The first value of each list is the default and writes no attribute.
 */

import { z } from "zod";

export const COMFORT_COOKIE = "vt_comfort";

export const COMFORT_OPTIONS = {
  /** Root text size, in percent: everything sized in rem grows with it. */
  text: ["100", "112", "125", "150"],
  /** WCAG 1.4.12 text spacing: taller lines, wider words and letters, more room between paragraphs. */
  spacing: ["normal", "wide"],
  /** Darker secondary text and stronger edges. */
  contrast: ["normal", "more"],
  /** Atkinson Hyperlegible Next, drawn so that similar letters cannot be mistaken for each other. */
  font: ["shop", "readable"],
  /** "system" follows the device; "reduce" and "full" override it (read by globals.css and use-reduced-motion). */
  motion: ["system", "reduce", "full"],
  /** Links underlined everywhere, not only on hover. */
  links: ["plain", "underline"],
  /** Buttons and fields at least 44px tall, whatever the pointer. */
  targets: ["normal", "large"],
  /** A band of light that follows the pointer or the focus, to keep one's place in a line. */
  guide: ["off", "on"],
  /** Single-key shortcuts ("/", "c", "n", "?"); WCAG 2.1.4 asks that they can be switched off. */
  shortcuts: ["on", "off"],
} as const;

export type ComfortKey = keyof typeof COMFORT_OPTIONS;
export type Comfort = { [K in ComfortKey]: (typeof COMFORT_OPTIONS)[K][number] };

export const COMFORT_KEYS = Object.keys(COMFORT_OPTIONS) as ComfortKey[];

export const DEFAULT_COMFORT = Object.fromEntries(COMFORT_KEYS.map((key) => [key, COMFORT_OPTIONS[key][0]])) as Comfort;

function isOption<K extends ComfortKey>(key: K, value: string): value is Comfort[K] {
  return (COMFORT_OPTIONS[key] as readonly string[]).includes(value);
}

/**
 * The cookie holds only what differs from the default, as `key_value` pairs
 * joined by dots (`text_125.contrast_more`): characters a cookie may carry
 * without quoting. Anything it does not recognise is ignored rather than
 * refused, so an old or edited cookie can never break a page.
 */
export function serializeComfort(comfort: Comfort): string {
  return COMFORT_KEYS.filter((key) => comfort[key] !== DEFAULT_COMFORT[key])
    .map((key) => `${key}_${comfort[key]}`)
    .join(".");
}

export function parseComfort(raw: string | null | undefined): Comfort {
  const comfort: Comfort = { ...DEFAULT_COMFORT };
  if (raw === null || raw === undefined || raw === "") return comfort;
  for (const pair of raw.slice(0, 400).split(".")) {
    const split = pair.indexOf("_");
    if (split <= 0) continue;
    const key = pair.slice(0, split);
    const value = pair.slice(split + 1);
    if (!(key in COMFORT_OPTIONS)) continue;
    const known = key as ComfortKey;
    if (isOption(known, value)) (comfort as Record<ComfortKey, string>)[known] = value;
  }
  return comfort;
}

/** A partial update, validated: at least one known setting, each with a value from its list. */
const option = <K extends ComfortKey>(key: K) => z.enum(COMFORT_OPTIONS[key]).optional();

export const comfortPatchSchema = z
  .object({
    text: option("text"),
    spacing: option("spacing"),
    contrast: option("contrast"),
    font: option("font"),
    motion: option("motion"),
    links: option("links"),
    targets: option("targets"),
    guide: option("guide"),
    shortcuts: option("shortcuts"),
  })
  .strict()
  .refine((patch) => Object.values(patch).some((value) => value !== undefined), "Name at least one setting to change.");

export type ComfortPatch = z.infer<typeof comfortPatchSchema>;

/** Keeps only known keys and values from a partial update (from a form, the Concierge or an account). */
export function patchComfort(current: Comfort, patch: Partial<Record<string, unknown>>): Comfort {
  const next: Comfort = { ...current };
  for (const key of COMFORT_KEYS) {
    const value = patch[key];
    if (typeof value === "string" && isOption(key, value)) (next as Record<ComfortKey, string>)[key] = value;
  }
  return next;
}

/** The attributes on <html>: a value for each setting away from its default, null to remove one. */
export function comfortAttributes(comfort: Comfort): Record<`data-${ComfortKey}`, string | null> {
  return Object.fromEntries(COMFORT_KEYS.map((key) => [`data-${key}`, comfort[key] === DEFAULT_COMFORT[key] ? null : comfort[key]])) as Record<`data-${ComfortKey}`, string | null>;
}

/**
 * The script in the page's head: reads the cookie and sets the attributes
 * before anything is painted. It is generated from the same option lists, so
 * it cannot drift from them, and it only ever sets values from those lists.
 */
export function prepaintScript(): string {
  const allowed = JSON.stringify(Object.fromEntries(COMFORT_KEYS.map((key) => [key, COMFORT_OPTIONS[key].slice(1)])));
  return `(function(){try{var m=document.cookie.match(/(?:^|; )${COMFORT_COOKIE}=([^;]*)/);if(!m)return;var a=${allowed},r=document.documentElement;m[1].split(".").forEach(function(p){var i=p.indexOf("_"),k=p.slice(0,i),v=p.slice(i+1);if(i>0&&a.hasOwnProperty(k)&&a[k].indexOf(v)>=0)r.setAttribute("data-"+k,v)})}catch(e){}})();`;
}
