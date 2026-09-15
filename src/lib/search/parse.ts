/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Query parsing: extracts price, colour, material and category filters from free text.
 */

import { fold } from "@/lib/search/normalize";
import { CATEGORY_TERMS, COLORS, lookup, MATERIALS, STOPWORDS } from "@/lib/search/vocabulary";

/**
 * Query parsing — step 2 of the A1 pipeline (docs/PLAN.md 2.6).
 *
 * "Δερμάτινη μαύρη πολυθρόνα κάτω από 300€" is two things at once: words to
 * search for ("πολυθρόνα") and conditions a result must meet (leather, black,
 * under €300). Ranking can only prefer; a condition must exclude. So the
 * conditions are pulled out as structured filters, and only what remains is
 * handed to the retrievers as free text.
 *
 * Parsing is deterministic — regular expressions and dictionaries, no model —
 * so the same query always yields the same filters, it costs nothing, and every
 * rule is testable. The Concierge usually sends structured filters itself; this
 * is for what people type into the search box.
 *
 * Order matters, because each rule removes the text it matched:
 *
 *   1. Price ranges      "300-500", "between 300 and 500", "από 300 έως 500"
 *   2. Price ceilings    "under 300", "κάτω από 300€", "300 or less"
 *   3. Price floors      "over 300", "τουλάχιστον 300", "300+"
 *   4. Sizes             "size M", "νούμερο 42", "XL"
 *   5. Dictionary terms  colours, materials, categories, in English, Greek and
 *                        Greeklish (src/lib/search/vocabulary.ts)
 *   6. Stopwords         "for", "with", "για", "με" … dropped from the rest
 *
 * Ranges run before ceilings so "από 300 έως 500" is one range, not a floor of
 * 300 plus a ceiling of 500 matched separately.
 *
 * A number is only a price when a price word or a currency sign is attached to
 * it. "3 seater", "120 cm" and "size 42" are not prices, and treating every
 * number as one would silently filter out the very product a person asked for.
 */

export type PriceRange = { minCents: number | null; maxCents: number | null };

export type ParsedQuery = {
  raw: string;
  /** What is left to search for, folded. */
  text: string;
  price: PriceRange | null;
  /** Canonical ids, e.g. "black", "oak", "seating". */
  colors: string[];
  materials: string[];
  categories: string[];
  /** Upper-case letter sizes or EU numeric sizes. */
  sizes: string[];
};

/* -------------------------------------------------------------------------- */
/* Money                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * A word boundary that works for Greek. JavaScript's `\b` only knows ASCII
 * letters, so `\bκατω` would never match; these look for "not a letter or digit"
 * in any script instead.
 */
const START = String.raw`(?<![\p{L}\p{N}])`;
const END = String.raw`(?![\p{L}\p{N}])`;

/**
 * An amount, optionally with a currency sign before or after it.
 *
 * Separators follow one rule: a separator followed by exactly three digits is a
 * thousands separator ("1.200" in Greek, "1,200" in English, both 1200); followed
 * by one or two digits it is a decimal point ("149,99" and "149.99", both
 * 149.99). The thousands form is tried first.
 */
const AMOUNT = String.raw`(\d{1,3}(?:[.,]\d{3})+|\d+(?:[.,]\d{1,2})?)`;
const CURRENCY = String.raw`(?:€|eur(?:os?)?${END}|ευρω${END})`;
/**
 * `(?!\d|[.,]\d)` stops an amount from ending mid-number. Without it the regex
 * engine backtracks: in "120-60 cm" it would take "6" as the second amount, see
 * "0 cm" instead of "cm", and call it a price range of 6 to 120.
 */
const MONEY = String.raw`(?:€\s*)?${AMOUNT}(?!\d|[.,]\d)\s*${CURRENCY}?`;

/** Units after a number mean it is a measurement or a count, not a price. */
const NOT_A_PRICE = String.raw`(?!\s*(?:cm|mm|m${END}|meters?${END}|inch|in${END}|x${END}|seat|θεσ|εκ${END}|kg${END}))`;

/** "1.200" → 120000, "149,99" → 14999. */
export function amountToCents(amount: string): number {
  const isThousands = /^\d{1,3}(?:[.,]\d{3})+$/.test(amount);
  const value = isThousands ? Number(amount.replace(/[.,]/g, "")) : Number(amount.replace(",", "."));
  return Math.round(value * 100);
}

const words = (...alternatives: string[]) => alternatives.map((a) => a.replace(/ /g, String.raw`\s+`)).join("|");

const CEILING_BEFORE = words(
  "under", "below", "less than", "cheaper than", "up to", "no more than", "at most", "max", "maximum", "within",
  "κατω απο", "κατω των", "λιγοτερο απο", "φθηνοτερο απο", "εωσ", "μεχρι", "το πολυ", "μεγιστο",
  // Greeklish
  "kato apo", "katw apo", "mexri", "mehri", "eos", "ews", "to poly",
);
const CEILING_AFTER = words("or less", "or under", "and under", "max", "το πολυ", "και κατω", "kai kato");
const FLOOR_BEFORE = words(
  "over", "above", "more than", "at least", "from", "min", "minimum",
  "πανω απο", "περισσοτερο απο", "ακριβοτερο απο", "τουλαχιστον", "ελαχιστο", "απο",
  "pano apo", "panw apo", "toulaxiston", "apo",
);
const FLOOR_AFTER = words("or more", "and up", "and above", "and over", "και πανω", "kai pano");
const RANGE_START = words("between", "from", "μεταξυ", "απο", "metaxy", "apo");
const RANGE_JOIN = words("-", "–", "—", "to", "and", "εωσ", "μεχρι", "με", "και", "eos", "mexri", "kai", "me");
const RANGE_JOIN_BARE = words("-", "–", "—", "to", "εωσ", "μεχρι", "eos", "mexri");

type PriceRule = {
  pattern: RegExp;
  read: (match: RegExpExecArray) => PriceRange | null;
};

const regex = (source: string) => new RegExp(source, "u");

const PRICE_RULES: PriceRule[] = [
  // "between 300 and 500", "από 300 έως 500"
  {
    pattern: regex(`${START}(?:${RANGE_START})\\s+${MONEY}\\s*(?:${RANGE_JOIN})\\s*${MONEY}${NOT_A_PRICE}`),
    read: (m) => orderedRange(m[1], m[2]),
  },
  // "300-500", "€300 to €500" — only when it cannot be a count or a measurement.
  {
    pattern: regex(`${START}${MONEY}\\s*(?:${RANGE_JOIN_BARE})\\s*${MONEY}${NOT_A_PRICE}`),
    read: (m) => {
      const range = orderedRange(m[1], m[2]);
      // "3-4" is almost always seats or people, never a price band.
      return range !== null && (range.maxCents ?? 0) >= 1_000 ? range : null;
    },
  },
  {
    pattern: regex(`${START}(?:${CEILING_BEFORE}|<=?)\\s*${MONEY}${NOT_A_PRICE}`),
    read: (m) => ({ minCents: null, maxCents: amountToCents(m[1]!) }),
  },
  {
    pattern: regex(`${START}${MONEY}\\s*(?:${CEILING_AFTER})${END}`),
    read: (m) => ({ minCents: null, maxCents: amountToCents(m[1]!) }),
  },
  {
    pattern: regex(`${START}(?:${FLOOR_BEFORE}|>=?)\\s*${MONEY}${NOT_A_PRICE}`),
    read: (m) => ({ minCents: amountToCents(m[1]!), maxCents: null }),
  },
  {
    pattern: regex(`${START}${MONEY}\\s*(?:\\+|${FLOOR_AFTER})`),
    read: (m) => ({ minCents: amountToCents(m[1]!), maxCents: null }),
  },
  // A bare amount with a currency sign is a ceiling: "lamp 50€" means "up to 50".
  {
    pattern: regex(`${START}(?:€\\s*${AMOUNT}|${AMOUNT}\\s*${CURRENCY})`),
    read: (m) => ({ minCents: null, maxCents: amountToCents((m[1] ?? m[2])!) }),
  },
];

function orderedRange(a: string | undefined, b: string | undefined): PriceRange | null {
  if (a === undefined || b === undefined) return null;
  const [low, high] = [amountToCents(a), amountToCents(b)].sort((x, y) => x - y) as [number, number];
  return { minCents: low, maxCents: high };
}

/* -------------------------------------------------------------------------- */
/* Sizes                                                                      */
/* -------------------------------------------------------------------------- */

const LETTER_SIZES = "xxxl|xxl|xl|xxs|xs|s|m|l";
const SIZE_KEYWORD = words("size", "sz", "μεγεθοσ", "νουμερο", "megethos", "noumero");

const SIZE_RULES: RegExp[] = [
  regex(`${START}(?:${SIZE_KEYWORD})\\s*(${LETTER_SIZES}|\\d{2}(?:[.,]5)?)${END}`),
  // Without a keyword only unambiguous letter sizes count: "s", "m" and "l" are
  // too often just letters.
  regex(`${START}(xxxl|xxl|xl|xxs|xs)${END}`),
];

/* -------------------------------------------------------------------------- */
/* Parse                                                                      */
/* -------------------------------------------------------------------------- */

function removeSpan(text: string, match: RegExpExecArray): string {
  return `${text.slice(0, match.index)} ${text.slice(match.index + match[0].length)}`;
}

export function parseQuery(raw: string): ParsedQuery {
  let text = fold(raw);

  // 1–3. Price. The first matching rule wins; a second price phrase in the same
  // query is left as text rather than guessed at.
  let price: PriceRange | null = null;
  for (const rule of PRICE_RULES) {
    const match = rule.pattern.exec(text);
    if (match === null) continue;
    const range = rule.read(match);
    if (range === null) continue;
    price = range;
    text = removeSpan(text, match);
    break;
  }

  // 4. Sizes.
  const sizes: string[] = [];
  for (const rule of SIZE_RULES) {
    const global = new RegExp(rule.source, "gu");
    let match: RegExpExecArray | null;
    while ((match = global.exec(text)) !== null) {
      const size = match[1]!.replace(",", ".").toUpperCase();
      if (!sizes.includes(size)) sizes.push(size);
    }
    text = text.replace(global, " ");
  }

  // 5–6. Dictionary terms, then stopwords.
  const colors: string[] = [];
  const materials: string[] = [];
  const categories: string[] = [];
  const remaining: string[] = [];

  for (const token of text.match(/[\p{L}\p{N}]+/gu) ?? []) {
    const color = lookup(token, COLORS);
    const material = color === null ? lookup(token, MATERIALS) : null;
    // A category word is also a search term: "lamp" should filter to lighting
    // *and* rank lamps above other lighting.
    const category = lookup(token, CATEGORY_TERMS);

    if (color !== null) {
      if (!colors.includes(color)) colors.push(color);
      continue;
    }
    if (material !== null) {
      if (!materials.includes(material)) materials.push(material);
      continue;
    }
    if (category !== null && !categories.includes(category)) categories.push(category);
    if (!STOPWORDS.has(token)) remaining.push(token);
  }

  return {
    raw,
    text: remaining.join(" "),
    price,
    colors,
    materials,
    categories,
    sizes,
  };
}
