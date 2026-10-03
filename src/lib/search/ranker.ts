/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The learned ranking stage: what is measured about a query and a product, and the trees that weigh it.
 */

import { fold, tokenize } from "@/lib/search/normalize";
import { trigramSimilarity } from "@/lib/search/trigram";
import { STOPWORDS } from "@/lib/search/vocabulary";

/**
 * docs/adr/057. After the retrievers and their fusion have chosen the
 * candidates, a learned model orders them. It was trained on Amazon's
 * human-labelled shopping queries (ESCI, train split — never the test queries
 * E1 reports on) by LambdaMART written for this project (research/ranker/):
 * gradient-boosted regression trees fitted to the gradients of NDCG@10.
 *
 * This file is the one place the features are defined. The training data
 * (scripts/esci-ranker-data.ts), the evaluation and the shop all call
 * `rankingFeatures`, so the model always sees what it was trained on; and
 * `predict` walks the exported trees exactly as the Python does (a parity
 * test checks it to 1e-9).
 *
 * The features, per (query, product):
 * - the retrievers' own evidence: the lexical score (rarity-weighted,
 *   ADR-009 addendum) and its reciprocal rank, the fuzzy (trigram) score and
 *   its reciprocal rank, the fused RRF score and rank, and whether both
 *   retrievers found it;
 * - how much of the query the title holds: the share of the query's words,
 *   the same share weighted by each word's rarity (idf), the rarest word's
 *   idf among those matched, consecutive word pairs found in order, and the
 *   trigram similarity of the whole strings;
 * - what the query asks that the product contradicts or confirms: its
 *   colours, its numbers (sizes, counts — "16 oz", "3 pack"), its brand;
 * - lengths: of the query (in words) and of the title (log).
 */

export const FEATURE_NAMES = [
  "lexical_score",
  "lexical_rr",
  "fuzzy_score",
  "fuzzy_rr",
  "rrf_score",
  "rrf_rr",
  "both_retrievers",
  "coverage",
  "idf_coverage",
  "max_idf_matched",
  "bigram_order",
  "trigram_similarity",
  "color_match",
  "color_conflict",
  "number_match",
  "number_conflict",
  "brand_in_query",
  "first_word_in_query",
  "query_words",
  "title_words_log",
] as const;
export type FeatureName = (typeof FEATURE_NAMES)[number];

/** What a retriever said about a product: its rank (0 is first) and its score. */
export type Evidence = { rank: number; score: number };

export type RankingQuery = {
  text: string;
  /** Colour ids the query names (parse.ts reads them). */
  colors: readonly string[];
  /** A word's inverse document frequency in this catalogue: ln(1 + N / df). */
  idf: (word: string) => number;
  lexical: ReadonlyMap<string, Evidence>;
  fuzzy: ReadonlyMap<string, Evidence>;
  fused: ReadonlyMap<string, Evidence>;
};

export type RankingProduct = { id: string; title: string; brand: string | null; colors: readonly string[] };

const words = (text: string) => tokenize(text).filter((word) => !STOPWORDS.has(word));
const NUMBER = /\d+(?:[.,]\d+)?/g;
const numbers = (text: string) => new Set((fold(text).match(NUMBER) ?? []).map((value) => value.replace(",", ".")));
const reciprocal = (evidence: Evidence | undefined) => (evidence === undefined ? 0 : 1 / (evidence.rank + 1));

/** The feature vector for one product under one query, in FEATURE_NAMES order. */
export function rankingFeatures(query: RankingQuery, product: RankingProduct): number[] {
  const queryWords = [...new Set(words(query.text))];
  const titleWords = words(product.title);
  const inTitle = new Set(titleWords);
  const matched = queryWords.filter((word) => inTitle.has(word));
  const idfTotal = queryWords.reduce((sum, word) => sum + query.idf(word), 0);
  const idfMatched = matched.reduce((sum, word) => sum + query.idf(word), 0);

  // Consecutive pairs of the query's words found side by side, in order, in the title.
  const queryOrder = words(query.text);
  const titlePairs = new Set(titleWords.slice(1).map((word, index) => `${titleWords[index]} ${word}`));
  const pairs = queryOrder.slice(1).map((word, index) => `${queryOrder[index]} ${word}`);
  const bigramOrder = pairs.length === 0 ? 0 : pairs.filter((pair) => titlePairs.has(pair)).length / pairs.length;

  const productColors = new Set(product.colors);
  const askedColors = query.colors.length > 0;
  const colorMatch = askedColors && query.colors.some((color) => productColors.has(color)) ? 1 : 0;
  const colorConflict = askedColors && productColors.size > 0 && colorMatch === 0 ? 1 : 0;

  const queryNumbers = numbers(query.text);
  const titleNumbers = numbers(product.title);
  const numberMatch = [...queryNumbers].some((value) => titleNumbers.has(value)) ? 1 : 0;
  const numberConflict = queryNumbers.size > 0 && titleNumbers.size > 0 && numberMatch === 0 ? 1 : 0;

  const brandWords = product.brand === null ? [] : words(product.brand);
  const queryWordSet = new Set(queryWords);
  const brandInQuery = brandWords.length > 0 && brandWords.every((word) => queryWordSet.has(word)) ? 1 : 0;
  const firstWordInQuery = titleWords.length > 0 && queryWordSet.has(titleWords[0]!) ? 1 : 0;

  const lexical = query.lexical.get(product.id);
  const fuzzy = query.fuzzy.get(product.id);
  const fused = query.fused.get(product.id);
  return [
    lexical?.score ?? 0,
    reciprocal(lexical),
    fuzzy?.score ?? 0,
    reciprocal(fuzzy),
    fused?.score ?? 0,
    reciprocal(fused),
    lexical !== undefined && fuzzy !== undefined ? 1 : 0,
    queryWords.length === 0 ? 0 : matched.length / queryWords.length,
    idfTotal === 0 ? 0 : idfMatched / idfTotal,
    matched.reduce((best, word) => Math.max(best, query.idf(word)), 0),
    bigramOrder,
    trigramSimilarity(fold(query.text), fold(product.title)),
    colorMatch,
    colorConflict,
    numberMatch,
    numberConflict,
    brandInQuery,
    firstWordInQuery,
    queryWords.length,
    Math.log(1 + titleWords.length),
  ];
}

/**
 * A trained model: boosted regression trees, each a flat list of nodes. Node
 * k splits on feature `feature[k]` at `threshold[k]` (≤ goes left), or, when
 * `feature[k]` is −1, is a leaf worth `value[k]`. The learning rate is
 * already folded into the leaf values.
 */
export type RankerModel = {
  version: string;
  features: readonly string[];
  base: number;
  trees: readonly { feature: readonly number[]; threshold: readonly number[]; left: readonly number[]; right: readonly number[]; value: readonly number[] }[];
};

/** The model's score for one feature vector: the base plus each tree's leaf. */
export function predict(model: RankerModel, x: readonly number[]): number {
  let score = model.base;
  for (const tree of model.trees) {
    let node = 0;
    while (tree.feature[node]! >= 0) node = x[tree.feature[node]!]! <= tree.threshold[node]! ? tree.left[node]! : tree.right[node]!;
    score += tree.value[node]!;
  }
  return score;
}

/** The model's features must be the ones this file computes, in this order: a mismatch is refused, not guessed. */
export function checkModel(model: RankerModel): boolean {
  return model.features.length === FEATURE_NAMES.length && model.features.every((name, index) => name === FEATURE_NAMES[index]);
}
