/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Spelling correction using optimal string alignment distance.
 */

import { trigramSimilarity } from "@/lib/search/trigram";

/**
 * Spelling correction against the catalogue's own vocabulary (A1).
 *
 * Trigram similarity handles most typos, but not the commonest one: two
 * adjacent letters swapped. "chiar" and "chair" share only their first two
 * trigrams, a similarity of 0.2, far below any useful threshold. An edit
 * distance that counts a swap as one edit sees them as neighbours.
 *
 * Optimal string alignment distance (restricted Damerau–Levenshtein): the
 * fewest insertions, deletions, substitutions and adjacent transpositions that
 * turn one word into the other. With d[i][j] the distance between the first i
 * letters of a and the first j letters of b:
 *
 *   d[i][0] = i,  d[0][j] = j
 *   d[i][j] = min( d[i-1][j] + 1,                      delete a[i]
 *                  d[i][j-1] + 1,                      insert b[j]
 *                  d[i-1][j-1] + (a[i] ≠ b[j]) )       substitute (or keep)
 *   and, if a[i] = b[j-1] and a[i-1] = b[j]:
 *   d[i][j] = min( d[i][j], d[i-2][j-2] + 1 )          swap two neighbours
 *
 *   "chiar" → "chair": swap i and a → distance 1
 *
 * The table is filled row by row, so the cost is O(|a|·|b|) time; only three
 * rows are kept, so memory is O(|b|). A caller-supplied ceiling stops early
 * once every entry of a row exceeds it, which is what keeps a scan over the
 * whole vocabulary fast.
 *
 * Corrections come only from the catalogue vocabulary, so a correction always
 * names a word some product is described with — a spelling fix that finds
 * nothing would be worse than none.
 */

export function editDistance(a: string, b: string, ceiling = Number.POSITIVE_INFINITY): number {
  const x = [...a];
  const y = [...b];
  if (Math.abs(x.length - y.length) > ceiling) return ceiling + 1;
  if (x.length === 0) return y.length;
  if (y.length === 0) return x.length;

  let beforePrevious = new Array<number>(y.length + 1).fill(0);
  let previous = Array.from({ length: y.length + 1 }, (_, j) => j);
  let current = new Array<number>(y.length + 1).fill(0);

  for (let i = 1; i <= x.length; i += 1) {
    current[0] = i;
    let rowMinimum = current[0];
    for (let j = 1; j <= y.length; j += 1) {
      const cost = x[i - 1] === y[j - 1] ? 0 : 1;
      let value = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + cost);
      if (i > 1 && j > 1 && x[i - 1] === y[j - 2] && x[i - 2] === y[j - 1]) {
        value = Math.min(value, beforePrevious[j - 2]! + 1);
      }
      current[j] = value;
      rowMinimum = Math.min(rowMinimum, value);
    }
    if (rowMinimum > ceiling) return ceiling + 1;
    [beforePrevious, previous, current] = [previous, current, beforePrevious];
  }
  return previous[y.length]!;
}

/**
 * How many edits a word may need and still be the same word. Short words get
 * one — "sofa" to "soda" is already a different thing — and longer words two.
 * Words under four letters are never corrected.
 */
export function allowedEdits(term: string): number {
  const length = [...term].length;
  if (length < 4) return 0;
  return length <= 6 ? 1 : 2;
}

export type Correction = { word: string; distance: number };

/**
 * The vocabulary words within the allowed edit distance of a term, closest
 * first; ties go to the word sharing more trigrams, then to the shorter word.
 * A term already in the vocabulary needs no correction and gets none.
 */
export function corrections(term: string, vocabulary: Iterable<string>, limit = 2): Correction[] {
  const ceiling = allowedEdits(term);
  if (ceiling === 0) return [];

  const found: (Correction & { similarity: number })[] = [];
  const length = [...term].length;
  for (const word of vocabulary) {
    if (word === term) return [];
    if (Math.abs([...word].length - length) > ceiling) continue;
    const distance = editDistance(term, word, ceiling);
    if (distance <= ceiling) found.push({ word, distance, similarity: trigramSimilarity(term, word) });
  }

  return found
    .sort((a, b) => a.distance - b.distance || b.similarity - a.similarity || a.word.length - b.word.length || a.word.localeCompare(b.word))
    .slice(0, limit)
    .map(({ word, distance }) => ({ word, distance }));
}
