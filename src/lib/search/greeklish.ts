/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Greeklish support: resolves Greek typed with Latin letters to Greek words.
 */

import { fold, scriptOf } from "@/lib/search/normalize";
import type { TrigramIndex } from "@/lib/search/trigram";

/**
 * Greeklish — Greek written with Latin letters (docs/PLAN.md 2.6, A1).
 *
 * Many Greeks type "kanapes" for καναπές, on phones without a Greek layout or out
 * of habit. There is no single standard, and the mapping is ambiguous in both
 * directions: "o" can be ο or ω, "i" can be ι, η or υ, and "x" can be χ or ξ. A
 * search that only understands the Greek alphabet misses these shoppers
 * entirely.
 *
 * The algorithm has three steps.
 *
 * 1. SEGMENT. Read the Latin word left to right, always taking the longest rule
 *    that matches. Two-letter rules come first because they stand for a single
 *    Greek sound: "th" is θ, not τ followed by η; "ou" is ου, not ο followed by υ.
 *    Each segment carries its Greek options, most common first.
 *
 *      "fotistiko" → f | o | t | i | s | t | i | k | o
 *                    φ  ο,ω  τ  ι,η,υ  σ  τ  ι,η,υ  κ  ο,ω
 *
 * 2. ENUMERATE. Every combination of options is a candidate spelling. Each
 *    candidate has a cost: the sum, over segments, of the position of the option
 *    it used (0 for the most common reading, 1 for the next, …). Candidates are
 *    produced in order of increasing cost, so the spelling that makes the fewest
 *    unusual choices comes first. The number of combinations grows exponentially
 *    with ambiguity — "fotistiko" has 2·3·3·2 = 36 — so enumeration stops at a
 *    cap, and ordering by cost is what makes the cap safe: the cut-off candidates
 *    are the least likely ones.
 *
 *      cost 0: φοτιστικο
 *      cost 1: φωτιστικο, φοτηστικο, φοτυστικο, φοτιστηκο, …
 *
 * 3. RESOLVE. Keep the candidates that are real words in the catalogue. The
 *    correct spelling φωτιστικο costs 1 and is not the first candidate, but it is
 *    the only one that appears in product text, so it is the one that survives.
 *    If no candidate matches exactly, the closest vocabulary terms by trigram
 *    similarity are used instead, which also absorbs an ordinary typo on top of
 *    the transliteration.
 *
 * The search then runs on both scripts: the original Latin term (which might be
 * English — "lamp" — or a brand) and its Greek readings.
 */

/**
 * Transliteration rules: Latin sequence → Greek options, most common first.
 * Output is already folded (no accents, σ never ς), matching the index.
 */
const RULES: ReadonlyMap<string, readonly string[]> = new Map([
  // Two letters, one Greek sound.
  ["th", ["θ"]],
  ["ps", ["ψ"]],
  ["ks", ["ξ"]],
  ["ch", ["χ"]],
  ["kh", ["χ"]],
  ["dh", ["δ"]],
  ["ou", ["ου"]],
  ["mp", ["μπ"]],
  ["nt", ["ντ"]],
  ["gk", ["γκ"]],
  ["gg", ["γγ", "γκ"]],
  ["ts", ["τσ"]],
  ["tz", ["τζ"]],
  ["ai", ["αι"]],
  ["ei", ["ει"]],
  ["oi", ["οι"]],
  // αυ and ευ are pronounced "av/ev" before voiced sounds and "af/ef" before
  // voiceless ones, and Greeklish follows the sound, so both spellings occur.
  ["av", ["αυ", "αβ"]],
  ["ev", ["ευ", "εβ"]],
  ["af", ["αφ", "αυ"]],
  ["ef", ["εφ", "ευ"]],
  ["au", ["αυ"]],
  ["eu", ["ευ"]],

  // One letter.
  ["a", ["α"]],
  ["b", ["μπ", "β"]],
  ["c", ["κ", "σ"]],
  ["d", ["δ", "ντ"]],
  ["e", ["ε", "η"]],
  ["f", ["φ"]],
  ["g", ["γ", "γκ"]],
  ["h", ["η", "χ"]],
  ["i", ["ι", "η", "υ"]],
  ["j", ["τζ"]],
  ["k", ["κ"]],
  ["l", ["λ"]],
  ["m", ["μ"]],
  ["n", ["ν"]],
  ["o", ["ο", "ω"]],
  ["p", ["π"]],
  ["q", ["κ"]],
  ["r", ["ρ"]],
  ["s", ["σ"]],
  ["t", ["τ"]],
  ["u", ["υ", "ου"]],
  ["v", ["β"]],
  ["w", ["ω"]],
  ["x", ["χ", "ξ"]],
  ["y", ["υ", "γ"]],
  ["z", ["ζ"]],
  // Shapes: "8" looks like θ, and is used for it inside words.
  ["8", ["θ"]],
]);

const LONGEST_RULE = Math.max(...[...RULES.keys()].map((key) => key.length));

export type Segment = { latin: string; options: readonly string[] };

/**
 * Step 1: split a Latin term into segments by longest match.
 *
 * Returns null if the term contains a character no rule covers — a digit other
 * than 8, say — because a partial transliteration would produce nonsense.
 */
export function segment(term: string): Segment[] | null {
  const text = fold(term);
  const segments: Segment[] = [];

  let position = 0;
  while (position < text.length) {
    let matched = false;
    for (let length = Math.min(LONGEST_RULE, text.length - position); length >= 1; length -= 1) {
      const latin = text.slice(position, position + length);
      const options = RULES.get(latin);
      if (options !== undefined) {
        segments.push({ latin, options });
        position += length;
        matched = true;
        break;
      }
    }
    if (!matched) return null;
  }
  return segments;
}

/**
 * Step 2: candidate Greek spellings in order of increasing cost.
 *
 * For each total cost c = 0, 1, 2, … every way of choosing one option per
 * segment whose option positions sum to c is emitted, until `limit` candidates
 * exist. Distinct choices can spell the same word ("gg"→γκ and "g"+"k"), so
 * duplicates are dropped and the cheaper occurrence is kept.
 */
export function greeklishCandidates(term: string, limit = 64): string[] {
  if (scriptOf(fold(term)) !== "latin" && !/^[a-z8]+$/.test(fold(term))) return [];
  const segments = segment(term);
  if (segments === null || segments.length === 0) return [];

  const maxCost = segments.reduce((sum, s) => sum + s.options.length - 1, 0);
  const results: string[] = [];
  const seen = new Set<string>();

  function emit(index: number, remaining: number, prefix: string): boolean {
    if (index === segments!.length) {
      if (remaining === 0 && !seen.has(prefix)) {
        seen.add(prefix);
        results.push(prefix);
      }
      return results.length < limit;
    }
    const { options } = segments![index]!;
    for (let choice = 0; choice < options.length && choice <= remaining; choice += 1) {
      if (!emit(index + 1, remaining - choice, prefix + options[choice])) return false;
    }
    return true;
  }

  for (let cost = 0; cost <= maxCost; cost += 1) {
    if (!emit(0, cost, "")) break;
  }
  return results;
}

export type GreeklishReading = {
  /** The Greek term to search for. */
  greek: string;
  /** How it was found: an exact vocabulary word, or the nearest one. */
  match: "exact" | "similar";
  /** 1 for exact; the trigram similarity for a near match. */
  confidence: number;
};

/**
 * Step 3: keep the candidates the catalogue actually contains.
 *
 * Exact vocabulary words win, in candidate order. Only if there are none does it
 * fall back to near matches, taking the best vocabulary term for each of the
 * cheapest candidates, which lets "fotistko" (Greeklish with a missing letter)
 * still find φωτιστικο.
 */
export function resolveGreeklish(
  term: string,
  vocabulary: Pick<TrigramIndex, "has" | "similar">,
  options: { maxReadings?: number; similarityThreshold?: number } = {},
): GreeklishReading[] {
  const maxReadings = options.maxReadings ?? 3;
  const threshold = options.similarityThreshold ?? 0.45;
  const candidates = greeklishCandidates(term);

  const exact = candidates
    .filter((candidate) => vocabulary.has(candidate))
    .slice(0, maxReadings)
    .map((greek) => ({ greek, match: "exact" as const, confidence: 1 }));
  if (exact.length > 0) return exact;

  const best = new Map<string, number>();
  for (const candidate of candidates.slice(0, 8)) {
    for (const { term: word, similarity } of vocabulary.similar(candidate, threshold, 2)) {
      best.set(word, Math.max(best.get(word) ?? 0, similarity));
    }
  }

  return [...best.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, maxReadings)
    .map(([greek, confidence]) => ({ greek, match: "similar" as const, confidence }));
}
