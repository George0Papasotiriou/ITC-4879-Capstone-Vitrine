/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Trigram similarity matching PostgreSQL pg_trgm, and a trigram index.
 */

import { tokenize } from "@/lib/search/normalize";

/**
 * Trigram similarity — the typo tolerance in A1 (docs/PLAN.md 2.6).
 *
 * A trigram is three consecutive characters. Two spellings of a word that
 * differ by a typo still share most of their trigrams, so the share of trigrams
 * they have in common is a robust measure of how alike they are.
 *
 * This is a TypeScript implementation of exactly the measure PostgreSQL's
 * `pg_trgm` extension computes, so the database (fuzzy retrieval over the whole
 * catalogue) and the application (choosing between Greeklish candidates) agree
 * on what "similar" means. `tests/integration/trigram-parity.test.ts` compares
 * the two on the real extension.
 *
 * Definition, as pg_trgm documents it:
 *
 *   1. Each word is padded with two spaces in front and one behind, so its
 *      beginning and end produce trigrams of their own: "cat" → "  cat ", giving
 *      "  c", " ca", "cat", "at ". Words matter at their edges: "cat" and "act"
 *      share letters but not boundaries, and score low.
 *   2. The trigrams of every word in the text form one *set* (duplicates count
 *      once).
 *   3. similarity(a, b) = |T(a) ∩ T(b)| / |T(a) ∪ T(b)|
 *
 * Step 3 is the Jaccard index of the two trigram sets: 1 for identical sets, 0
 * for sets with nothing in common.
 *
 * Worked example, "chair" against the typo "chiar":
 *   T(chair) = {"  c", " ch", "cha", "hai", "air", "ir "}
 *   T(chiar) = {"  c", " ch", "chi", "hia", "iar", "ar "}
 *   shared   = {"  c", " ch"}                       → 2
 *   union    = 6 + 6 − 2                            → 10
 *   similarity = 2 / 10 = 0.2
 */

export function trigrams(text: string): Set<string> {
  const result = new Set<string>();
  for (const word of tokenize(text)) {
    const padded = `  ${word} `;
    // Iterate by code point, not UTF-16 unit, so Greek and accented letters are
    // one character each, as they are in the database.
    const characters = [...padded];
    for (let i = 0; i + 3 <= characters.length; i += 1) {
      result.add(characters.slice(i, i + 3).join(""));
    }
  }
  return result;
}

export function trigramSimilarity(a: string, b: string): number {
  const left = trigrams(a);
  const right = trigrams(b);
  if (left.size === 0 && right.size === 0) return 0;

  let shared = 0;
  for (const trigram of left) {
    if (right.has(trigram)) shared += 1;
  }
  // |A ∪ B| = |A| + |B| − |A ∩ B|
  return shared / (left.size + right.size - shared);
}

/**
 * An in-memory index for finding the closest terms in a vocabulary.
 *
 * The database does this over the whole catalogue with a GIN trigram index.
 * In the application the vocabulary is the set of terms that actually appear
 * in product text, which is small enough to keep in memory, and an inverted
 * index from trigram to terms means only terms that share at least one trigram
 * with the query are ever scored.
 */
export class TrigramIndex {
  private readonly postings = new Map<string, Set<string>>();
  private readonly terms = new Set<string>();

  constructor(terms: Iterable<string> = []) {
    for (const term of terms) this.add(term);
  }

  add(term: string): void {
    if (this.terms.has(term)) return;
    this.terms.add(term);
    for (const trigram of trigrams(term)) {
      let bucket = this.postings.get(trigram);
      if (bucket === undefined) {
        bucket = new Set();
        this.postings.set(trigram, bucket);
      }
      bucket.add(term);
    }
  }

  has(term: string): boolean {
    return this.terms.has(term);
  }

  get size(): number {
    return this.terms.size;
  }

  /** Terms at least `threshold` similar to `query`, most similar first. */
  similar(query: string, threshold = 0.3, limit = 5): { term: string; similarity: number }[] {
    const candidates = new Set<string>();
    for (const trigram of trigrams(query)) {
      for (const term of this.postings.get(trigram) ?? []) candidates.add(term);
    }

    return [...candidates]
      .map((term) => ({ term, similarity: trigramSimilarity(query, term) }))
      .filter((match) => match.similarity >= threshold)
      .sort((a, b) => b.similarity - a.similarity || a.term.localeCompare(b.term))
      .slice(0, limit);
  }
}
