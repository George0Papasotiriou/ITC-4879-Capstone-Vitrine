/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Reciprocal rank fusion of lexical, fuzzy and semantic result lists.
 */

/**
 * Rank fusion — step 4 of the A1 pipeline (docs/PLAN.md 2.6).
 *
 * Three retrievers look at a query in different ways. Lexical search finds the
 * words ("oak table"), fuzzy search forgives typos ("oak tabel"), and semantic
 * search finds meaning ("somewhere to eat" → dining tables). Each returns its
 * own ranked list, and the lists have to become one.
 *
 * Their raw scores cannot simply be added. `ts_rank_cd` is unbounded, trigram
 * similarity lives in [0, 1] and cosine similarity in [−1, 1]; a scale fixed for
 * one query is wrong for the next. Reciprocal Rank Fusion (Cormack, Clarke and
 * Büttcher, SIGIR 2009) ignores scores and uses only positions:
 *
 *   RRF(d) = Σ_r  w_r / (k + rank_r(d))
 *
 *   r        each retriever that returned d (a retriever that did not return d
 *            contributes nothing)
 *   rank_r   the position of d in that list, starting at 1
 *   w_r      how much that retriever is trusted (tuned on a development split
 *            in evaluation E1; 1 for all by default)
 *   k = 60   the constant from the paper
 *
 * Why k matters. With k = 0 the first result of any list scores 1 and the
 * second 0.5, so one retriever's top hit outweighs a document ranked second by
 * all three. With k = 60 the first scores 1/61 ≈ 0.0164 and the second
 * 1/62 ≈ 0.0161: position still matters, but agreement between retrievers
 * matters more. A document ranked 5th by two retrievers (2/65 ≈ 0.0308) beats
 * one ranked 1st by a single retriever (0.0164). That is the behaviour a hybrid
 * search wants — each retriever covers the blind spots of the others, and what
 * they agree on rises.
 */

export const RRF_K = 60;

export type RankedList = {
  /** Retriever name, e.g. "lexical", "fuzzy", "semantic". */
  name: string;
  /** Document ids, best first. Duplicates after the first are ignored. */
  ids: readonly string[];
  /** Trust in this retriever. Defaults to 1. */
  weight?: number;
};

export type FusedResult = {
  id: string;
  score: number;
  /** The 1-based rank of the document in each list that returned it, for explanations and evaluation. */
  ranks: Record<string, number>;
};

export function reciprocalRankFusion(lists: readonly RankedList[], k = RRF_K): FusedResult[] {
  if (!Number.isFinite(k) || k < 0) throw new RangeError(`RRF k must be a finite number ≥ 0, got ${k}`);

  const results = new Map<string, FusedResult>();

  for (const list of lists) {
    const weight = list.weight ?? 1;
    if (!Number.isFinite(weight) || weight < 0) {
      throw new RangeError(`Weight for "${list.name}" must be a finite number ≥ 0, got ${weight}`);
    }

    let rank = 0;
    const seen = new Set<string>();
    for (const id of list.ids) {
      // A retriever that returns the same document twice has one opinion of it,
      // not two; the first (best) position is the one that counts.
      if (seen.has(id)) continue;
      seen.add(id);
      rank += 1;

      const result = results.get(id) ?? { id, score: 0, ranks: {} };
      result.score += weight / (k + rank);
      result.ranks[list.name] = rank;
      results.set(id, result);
    }
  }

  return [...results.values()].sort(compareFused);
}

/**
 * Highest score first. Exact ties — common, since two documents each ranked
 * first by one equally weighted retriever score the same — go to the document
 * with the better best rank, then to the one more retrievers returned, then to
 * the id, so the order never depends on the order the lists arrived in.
 */
function compareFused(a: FusedResult, b: FusedResult): number {
  // Scores built from different fractions can be equal in exact arithmetic yet
  // differ in the 16th digit in floating point; anything closer than this is a tie.
  const scoreOrder = Math.abs(b.score - a.score) < 1e-12 ? 0 : b.score - a.score;
  return (
    scoreOrder ||
    bestRank(a) - bestRank(b) ||
    Object.keys(b.ranks).length - Object.keys(a.ranks).length ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

function bestRank(result: FusedResult): number {
  return Math.min(...Object.values(result.ranks));
}
