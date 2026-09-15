/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Search text normalisation: case, accents and Greek final sigma folding.
 */

/**
 * Text normalisation for search — step 1 of the A1 pipeline (docs/PLAN.md 2.6).
 *
 * Search compares what a person typed with what the catalogue says, and those
 * two strings differ in ways that carry no meaning: capital letters, accents,
 * and in Greek the two shapes of sigma. Normalisation removes exactly those
 * differences, so "Καφές", "καφες" and "ΚΑΦΕΣ" all become "καφεσ", and nothing
 * else is changed.
 *
 * The steps, in order:
 *
 *   1. Unicode NFKD. Decomposes a precomposed letter into base letter plus
 *      combining mark: "έ" (U+03AD) becomes "ε" (U+03B5) followed by the acute
 *      accent (U+0301). It also folds compatibility forms, such as full-width
 *      digits, into their plain equivalents.
 *   2. Remove combining marks (Unicode category M). With the letters decomposed,
 *      every accent, tonos and dialytika is now a separate mark and can simply
 *      be dropped: "έ" → "ε", "ϊ" → "ι", "é" → "e".
 *   3. Lowercase.
 *   4. Final sigma. Greek writes σ inside a word and ς at the end of one. They
 *      are the same letter, but different code points, so "καφές" would not
 *      match a search for "καφεσ". Every ς becomes σ.
 *
 * The same function must be applied to catalogue text and to queries, or the
 * two sides are normalised differently and never meet.
 */

const COMBINING_MARK = /\p{M}/gu;

/** Accent-, case- and sigma-folded text. Punctuation and spacing are kept. */
export function fold(text: string): string {
  return text.normalize("NFKD").replace(COMBINING_MARK, "").toLowerCase().replace(/ς/g, "σ");
}

/**
 * Splits folded text into search terms: runs of letters and digits in any
 * script. Everything else — spaces, punctuation, symbols — separates terms.
 *
 * Hyphenated words ("mid-century") become two terms, which is what both the
 * lexical index and a person searching for "century" expect.
 */
export function tokenize(text: string): string[] {
  return fold(text).match(/[\p{L}\p{N}]+/gu) ?? [];
}

/** Folded text with every run of non-term characters reduced to one space. */
export function normalize(text: string): string {
  return tokenize(text).join(" ");
}

/** The script a term is written in, used to decide whether to try Greeklish. */
export type Script = "greek" | "latin" | "mixed" | "other";

const GREEK_LETTER = /\p{Script=Greek}/u;
const LATIN_LETTER = /\p{Script=Latin}/u;

export function scriptOf(term: string): Script {
  let greek = false;
  let latin = false;
  for (const character of term) {
    if (GREEK_LETTER.test(character)) greek = true;
    else if (LATIN_LETTER.test(character)) latin = true;
  }
  if (greek && latin) return "mixed";
  if (greek) return "greek";
  if (latin) return "latin";
  return "other";
}
