/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Reranking with business signals and Maximal Marginal Relevance diversification.
 */

import type { FusedResult } from "@/lib/search/fusion";

/**
 * Re-ranking and diversity — steps 5 and 6 of the A1 pipeline (docs/PLAN.md 2.6).
 *
 * Fusion answers "which products match the query best". A shop also has to ask
 * "which of these should a person see first": a product that is out of stock,
 * or rated 2 stars by 300 buyers, should give way to an equally relevant one
 * that is not. And the first row should not be the same chair six times in six
 * colours. Three pure functions do this:
 *
 *   bayesianRating   a rating that does not trust five stars from one review
 *   rerank           relevance × business signals
 *   diversify        Maximal Marginal Relevance over the top of the list
 */

/* -------------------------------------------------------------------------- */
/* Bayesian average rating                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The plain average is misleading for products with few reviews: one 5-star
 * review averages 5.0 and outranks 4.6 from 200 reviews. The Bayesian average
 * starts every product with C imaginary reviews at the catalogue mean m, and
 * lets real reviews pull it away:
 *
 *   bayesRating = (C · m + Σ ratings) / (C + n)
 *
 *   n = 0        → m               no evidence, assume average
 *   n ≪ C        → close to m      a little evidence, move a little
 *   n ≫ C        → close to Σ/n    plenty of evidence, trust it
 *
 * Worked example with m = 4.0 and C = 10:
 *   one review of 5      → (40 + 5)   / 11  = 4.09
 *   200 reviews avg 4.6  → (40 + 920) / 210 = 4.57   ← ranks higher, as it should
 *
 * C sets how many reviews it takes to be believed. `catalogRatingPrior` uses the
 * average review count of rated products: a product needs a typical amount of
 * evidence before its own average dominates.
 */
export type RatingPrior = {
  /** m: the mean rating across all reviews in the catalogue. */
  mean: number;
  /** C: how many reviews the prior is worth. */
  weight: number;
};

export type RatingSummary = { ratingSum: number; ratingCount: number };

export function bayesianRating({ ratingSum, ratingCount }: RatingSummary, prior: RatingPrior): number {
  if (ratingCount < 0 || prior.weight < 0) throw new RangeError("Counts and prior weight must be ≥ 0");
  if (ratingCount === 0 && prior.weight === 0) return prior.mean;
  return (prior.weight * prior.mean + ratingSum) / (prior.weight + ratingCount);
}

/** A prior derived from the catalogue itself; falls back to the scale midpoint when nothing is rated. */
export function catalogRatingPrior(products: readonly RatingSummary[], fallbackMean = 3): RatingPrior {
  const rated = products.filter((p) => p.ratingCount > 0);
  const totalCount = rated.reduce((sum, p) => sum + p.ratingCount, 0);
  if (totalCount === 0) return { mean: fallbackMean, weight: 1 };
  const totalSum = rated.reduce((sum, p) => sum + p.ratingSum, 0);
  return { mean: totalSum / totalCount, weight: Math.max(1, totalCount / rated.length) };
}

/* -------------------------------------------------------------------------- */
/* Business re-ranking                                                        */
/* -------------------------------------------------------------------------- */

export type RerankSignals = RatingSummary & {
  inStock: boolean;
  /** Recent demand, e.g. orders in the last 30 days. */
  popularity: number;
  /** Taste Graph affinity of the shopper for this product, 0–1. Phase 8; absent until then. */
  taste?: number;
};

export type RerankWeights = {
  inStock: number;
  rating: number;
  popularity: number;
  taste: number;
};

/**
 * Starting weights, to be tuned in evaluation E1. Read them as maximum boosts:
 * being in stock adds 15%, the best possible rating adds up to 25%.
 * Popularity is logarithmic, so 10 orders add 0.05 · ln 11 ≈ 12% and 100
 * orders only ≈ 23%: a bestseller gets a nudge, not a monopoly.
 */
export const DEFAULT_RERANK_WEIGHTS: RerankWeights = {
  inStock: 0.15,
  rating: 0.25,
  popularity: 0.05,
  taste: 0,
};

export type RerankedResult = FusedResult & {
  /** The fused score before re-ranking. */
  relevance: number;
  /** The factor relevance was multiplied by, and what it was made of, for "why this result". */
  boost: number;
  boosts: { inStock: number; rating: number; popularity: number; taste: number };
};

/**
 *   score(d) = RRF(d) · (1 + β1·inStock + β2·rating + β3·ln(1 + popularity) + β4·taste)
 *
 * The signals multiply relevance instead of being added to it. Added, a
 * popular in-stock product could outrank a far better match; multiplied, a
 * product with no relevance still scores zero, and signals only reorder
 * products that are close in relevance. RRF differences between neighbours are
 * small (1/61 against 1/62 is under 2%), so a 15% stock boost can lift an
 * in-stock product over an out-of-stock one a few places above it — which is
 * the intent — but not over one that several retrievers agreed on.
 *
 * One deviation from the formula as written in the plan: the rating term uses
 * the Bayesian rating rescaled from the 1–5 star scale to 0–1, as
 * (bayesRating − 1) / 4. On the raw scale a β of 0.25 would mean a boost of up
 * to 125% and make the rating overpower relevance; rescaled, every β reads the
 * same way, as the largest boost that signal can give.
 */
export function rerank(
  fused: readonly FusedResult[],
  signals: ReadonlyMap<string, RerankSignals>,
  prior: RatingPrior,
  weights: RerankWeights = DEFAULT_RERANK_WEIGHTS,
): RerankedResult[] {
  for (const [name, value] of Object.entries(weights)) {
    if (!Number.isFinite(value) || value < 0) throw new RangeError(`Weight ${name} must be a finite number ≥ 0`);
  }

  const reranked = fused.map((result): RerankedResult => {
    const signal = signals.get(result.id);
    // A result without signals gets no boost rather than an error: search must
    // still answer while, for example, a new product has no stats row yet.
    const boosts =
      signal === undefined
        ? { inStock: 0, rating: 0, popularity: 0, taste: 0 }
        : {
            inStock: weights.inStock * (signal.inStock ? 1 : 0),
            rating: weights.rating * clamp01((bayesianRating(signal, prior) - 1) / 4),
            popularity: weights.popularity * Math.log1p(Math.max(0, signal.popularity)),
            taste: weights.taste * clamp01(signal.taste ?? 0),
          };
    const boost = 1 + boosts.inStock + boosts.rating + boosts.popularity + boosts.taste;
    return { ...result, relevance: result.score, score: result.score * boost, boost, boosts };
  });

  return reranked.sort((a, b) => b.score - a.score || b.relevance - a.relevance || compareIds(a.id, b.id));
}

/* -------------------------------------------------------------------------- */
/* Diversity                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Cosine similarity of two embedding vectors: the cosine of the angle between
 * them, 1 for the same direction, 0 for unrelated, −1 for opposite.
 *
 *   cos(a, b) = (a · b) / (‖a‖ · ‖b‖)
 */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) throw new RangeError(`Vector lengths differ: ${a.length} and ${b.length}`);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / Math.sqrt(normA * normB);
}

export const MMR_LAMBDA = 0.8;
export const MMR_DEPTH = 50;

/**
 * Maximal Marginal Relevance (Carbonell and Goldstein, SIGIR 1998).
 *
 * Build the list one pick at a time. At each step choose the candidate d that
 * maximises
 *
 *   MMR(d) = λ · rel(d) − (1 − λ) · max_{s ∈ S} sim(d, s)
 *
 * where S is what has already been picked. The first term rewards relevance;
 * the second penalises being like something already shown. λ = 1 is plain
 * relevance order; λ = 0 is pure variety. At λ = 0.8 relevance leads, and a
 * near-duplicate is pushed down only when something almost as relevant and
 * different is available: the same chair in grey, after the black one, loses
 * 0.2 · 1 = 0.2, which a different chair a little less relevant easily beats.
 *
 * rel(d) is the score divided by the highest score, putting it on the same
 * 0–1 scale as similarity so that λ means the same thing for every query.
 *
 * Only the top `depth` positions are diversified (the part people actually
 * see); the rest keep their order after them. Keeping, per candidate, its
 * highest similarity to anything picked so far and updating it only against
 * the newest pick makes this O(depth · n) similarity calls instead of
 * O(depth² · n).
 */
export function diversify<T extends { id: string; score: number }>(
  items: readonly T[],
  similarity: (a: T, b: T) => number,
  options: { lambda?: number; depth?: number } = {},
): T[] {
  const lambda = options.lambda ?? MMR_LAMBDA;
  const depth = options.depth ?? MMR_DEPTH;
  if (!(lambda >= 0 && lambda <= 1)) throw new RangeError(`MMR lambda must be within [0, 1], got ${lambda}`);
  if (items.length === 0) return [];

  const maxScore = Math.max(...items.map((item) => item.score));
  const relevance = (item: T) => (maxScore > 0 ? item.score / maxScore : 0);

  const remaining = [...items];
  const maxSimilarity = new Map<T, number>();
  const picked: T[] = [];

  while (picked.length < depth && remaining.length > 0) {
    let bestIndex = 0;
    let bestValue = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < remaining.length; i += 1) {
      const candidate = remaining[i]!;
      const penalty = maxSimilarity.get(candidate) ?? 0;
      const value = lambda * relevance(candidate) - (1 - lambda) * penalty;
      // Strictly greater, with a tolerance: on a tie the earlier, more relevant candidate stays.
      if (value > bestValue + 1e-12) {
        bestValue = value;
        bestIndex = i;
      }
    }

    const [chosen] = remaining.splice(bestIndex, 1) as [T];
    picked.push(chosen);
    for (const candidate of remaining) {
      const s = similarity(candidate, chosen);
      if (s > (maxSimilarity.get(candidate) ?? Number.NEGATIVE_INFINITY)) maxSimilarity.set(candidate, s);
    }
  }

  return [...picked, ...remaining];
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
