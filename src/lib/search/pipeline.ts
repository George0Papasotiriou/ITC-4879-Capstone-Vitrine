/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * End-to-end hybrid search pipeline: parse, retrieve, fuse, rerank and diversify.
 */

import { reciprocalRankFusion, RRF_K, type FusedResult, type RankedList } from "@/lib/search/fusion";
import { resolveGreeklish, type GreeklishReading } from "@/lib/search/greeklish";
import { scriptOf, tokenize } from "@/lib/search/normalize";
import { parseQuery, type ParsedQuery } from "@/lib/search/parse";
import { catalogRatingPrior, diversify, rerank, type RerankSignals } from "@/lib/search/rerank";
import { corrections as spellingCorrections } from "@/lib/search/spelling";
import { predict, rankingFeatures, type RankerModel, type RankingProduct, type RankingQuery } from "@/lib/search/ranker";
import { NO_FILTERS, type Retrieved, type RetrievalFilters, type Retrievers } from "@/lib/search/retrieve";
import { TrigramIndex, trigramSimilarity } from "@/lib/search/trigram";
import { englishPieceNames } from "@/lib/search/vocabulary";

/**
 * The A1 search pipeline, end to end (docs/PLAN.md 2.6):
 *
 *   parse → expand (Greeklish, spelling) → retrieve (lexical, fuzzy, semantic) → fuse (RRF)
 *         → learned order (LambdaMART, when given) → re-rank (stock, rating, popularity) → diversify (MMR)
 *
 * Every stage is a separately tested module; this file only wires them
 * together and records what each stage did, so a result page can say why a
 * product is there and evaluation E1 can switch stages off one at a time.
 */

export type SearchOptions = {
  /** Retrievers to use; evaluation ablations turn them off one by one. */
  retrievers?: { lexical?: boolean; fuzzy?: boolean; semantic?: boolean };
  /** Weights for RRF, tuned in evaluation E1. */
  weights?: { lexical: number; fuzzy: number; semantic: number };
  /** Apply business re-ranking and diversity (off for the "RRF only" ablation). */
  rerank?: boolean;
  /** Filters from the page (facets), combined with those parsed from the query. */
  filters?: Partial<RetrievalFilters>;
  /**
   * Converts a price bound from the shopper's prices to stored prices, when they
   * differ (prices by country, docs/adr/013). Identity when absent.
   */
  priceToBase?: (cents: number, bound: "min" | "max") => number;
  /** A query embedding, when an embedding model is available. */
  embedding?: readonly number[] | null;
  limit?: number;
  /** How the lexical retriever weighs words: by rarity (the shop) or not at all (E1's ablation). */
  lexicalWeighting?: "idf" | "plain";
  /** The learned ranking stage (docs/adr/057): orders the fused candidates before business re-ranking. */
  ranker?: RankerModel | null;
  /** Return each retriever's scored list and the fused list, for training and evaluating the ranker. */
  evidence?: boolean;
};

/** How many fused candidates the learned stage orders; the rest keep their fused order below them. */
export const RANKER_DEPTH = 50;

export type SearchEvidence = { lexical: Retrieved[]; fuzzy: Retrieved[]; fused: FusedResult[] };

export type SearchResult = {
  query: ParsedQuery;
  /** Greek readings found for Latin words ("kanapes" → καναπεσ). */
  readings: { term: string; readings: GreeklishReading[] }[];
  /** Spelling corrections from the catalogue vocabulary ("chiar" → chair). */
  corrections: { term: string; words: string[] }[];
  /** English names searched for a Greek piece name ("πολυθρονα" → armchair), docs/adr/047. */
  translations: { term: string; words: string[] }[];
  filters: RetrievalFilters;
  /** Constraints dropped because they left nothing, so the page can say so. */
  relaxed: Relaxation[];
  ids: string[];
  /** Per product: its rank in each retriever, for explanations and evaluation. */
  ranks: Record<string, Record<string, number>>;
  retrieversUsed: string[];
  /** Vocabulary words close to the query, offered when results are few. */
  suggestions: string[];
  timings: Record<string, number>;
  /** With `evidence`: what each retriever returned, with scores, and their fusion (before any re-ranking). */
  evidence?: SearchEvidence;
};

export type Relaxation = "categories" | "colors" | "materials";

export const DEFAULT_WEIGHTS = { lexical: 1, fuzzy: 0.7, semantic: 1 };

/** Vocabulary cache: rebuilt at most every five minutes per process. */
const VOCABULARY_TTL_MS = 5 * 60 * 1000;
let vocabularyCache: { index: TrigramIndex; words: Set<string>; frequency: Map<string, number>; loadedAt: number } | null = null;

async function vocabularyIndex(retrievers: Retrievers) {
  if (vocabularyCache !== null && Date.now() - vocabularyCache.loadedAt < VOCABULARY_TTL_MS) return vocabularyCache;
  const rows = await retrievers.vocabulary();
  const words = rows.map((row) => row.word);
  vocabularyCache = { index: new TrigramIndex(words), words: new Set(words), frequency: new Map(rows.map((row) => [row.word, row.products])), loadedAt: Date.now() };
  return vocabularyCache;
}

/** For tests and after an import: forget the cached vocabulary. */
export function resetSearchVocabulary(): void {
  vocabularyCache = null;
}

/**
 * Query expansion. A word the catalogue itself contains ("lamp", "rivet") is
 * searched as it is. A Latin word it does not contain is first read as
 * Greeklish ("kanapes" → καναπεσ); if that finds nothing, it is treated as a
 * misspelling and the nearest catalogue words by edit distance are added
 * ("chiar" → chair). The original word is always kept, so expansion can only
 * add candidates, never lose the literal match.
 *
 * A Greek word that names a piece is also searched by its English names
 * ("πολυθρονα" → armchair, docs/adr/047): most titles are English, and the
 * lexical retriever joins terms with OR, so this only adds the products
 * described in English. Such a word is not spelling-corrected as well: it is
 * known, just in the other language.
 */
export function expandTerms(
  terms: readonly string[],
  vocabulary: { index: TrigramIndex; words: ReadonlySet<string>; frequency?: ReadonlyMap<string, number> },
): { terms: string[]; readings: SearchResult["readings"]; corrections: SearchResult["corrections"]; translations: SearchResult["translations"] } {
  const expanded: string[] = [];
  const readings: SearchResult["readings"] = [];
  const corrections: SearchResult["corrections"] = [];
  const translations: SearchResult["translations"] = [];
  for (const term of terms) {
    expanded.push(term);
    const english = englishPieceNames(term);
    if (english.length > 0) {
      translations.push({ term, words: [...english] });
      for (const word of english) if (!expanded.includes(word)) expanded.push(word);
      continue;
    }
    if (vocabulary.words.has(term)) continue;

    if (scriptOf(term) === "latin") {
      const found = resolveGreeklish(term, vocabulary.index);
      if (found.length > 0) {
        readings.push({ term, readings: found });
        for (const reading of found) expanded.push(reading.greek);
        continue;
      }
    }

    const words = spellingCorrections(term, vocabulary.words, 2, vocabulary.frequency).map((correction) => correction.word);
    if (words.length > 0) {
      corrections.push({ term, words });
      expanded.push(...words);
    }
  }
  return { terms: expanded, readings, corrections, translations };
}

const toBase = (cents: number | null, bound: "min" | "max", convert: (cents: number, bound: "min" | "max") => number) =>
  cents === null ? null : convert(cents, bound);

function mergeFilters(
  query: ParsedQuery,
  page: Partial<RetrievalFilters> | undefined,
  priceToBase: (cents: number, bound: "min" | "max") => number = (cents) => cents,
): RetrievalFilters {
  const union = (a: readonly string[], b: readonly string[] | undefined) => [...new Set([...a, ...(b ?? [])])];
  // A category chosen on the page replaces the one read from the words: the
  // shopper narrowed the search on purpose.
  const pageCategories = page?.categories ?? [];
  return {
    categories: pageCategories.length > 0 ? [...pageCategories] : [...query.categories],
    colors: union(query.colors, page?.colors),
    materials: union(query.materials, page?.materials),
    minCents: toBase(page?.minCents ?? query.price?.minCents ?? null, "min", priceToBase),
    maxCents: toBase(page?.maxCents ?? query.price?.maxCents ?? null, "max", priceToBase),
    inStock: page?.inStock ?? false,
  };
}

export async function searchProducts(retrievers: Retrievers, raw: string, options: SearchOptions = {}): Promise<SearchResult> {
  const timings: Record<string, number> = {};
  const time = async <T>(label: string, run: () => Promise<T>): Promise<T> => {
    const started = performance.now();
    try {
      return await run();
    } finally {
      timings[label] = Math.round((performance.now() - started) * 10) / 10;
    }
  };

  const use = { lexical: true, fuzzy: true, semantic: true, ...options.retrievers };
  const weights = options.weights ?? DEFAULT_WEIGHTS;
  const limit = options.limit ?? 60;

  const query = parseQuery(raw);
  const vocabulary = await time("vocabulary", () => vocabularyIndex(retrievers));
  const baseTerms = tokenize(query.text);
  const { terms, readings, corrections, translations } = expandTerms(baseTerms, vocabulary);
  const fuzzyText = [
    query.text,
    ...readings.flatMap((entry) => entry.readings.map((reading) => reading.greek)),
    ...translations.flatMap((entry) => entry.words),
  ].join(" ").trim();

  let filters = mergeFilters(query, options.filters, options.priceToBase);
  const relaxed: SearchResult["relaxed"] = [];
  const hasConstraint =
    filters.categories.length + filters.colors.length + filters.materials.length > 0 ||
    filters.minCents !== null ||
    filters.maxCents !== null;

  // A query with no words but with constraints ("black under 300") is a
  // filtered browse, not a search: every matching product is a candidate.
  const browseOnly = terms.length === 0 && hasConstraint;

  async function retrieve(active: RetrievalFilters) {
    const lists: RankedList[] = [];
    const used: string[] = [];
    const scored: Record<string, Retrieved[]> = {};
    const embedding = options.embedding ?? null;
    const jobs: Promise<void>[] = [];
    if (use.lexical && terms.length > 0) {
      jobs.push(time("lexical", () => retrievers.lexical(terms, active, undefined, options.lexicalWeighting ?? "idf")).then((rows) => {
        scored.lexical = rows;
        lists.push({ name: "lexical", ids: rows.map((row) => row.id), weight: weights.lexical });
        used.push("lexical");
      }));
    }
    if (use.fuzzy && fuzzyText.length >= 3) {
      jobs.push(time("fuzzy", () => retrievers.fuzzy(fuzzyText, active)).then((rows) => {
        scored.fuzzy = rows;
        lists.push({ name: "fuzzy", ids: rows.map((row) => row.id), weight: weights.fuzzy });
        used.push("fuzzy");
      }));
    }
    if (use.semantic && embedding !== null) {
      jobs.push(time("semantic", () => retrievers.semantic(embedding, active)).then((rows) => {
        lists.push({ name: "semantic", ids: rows.map((row) => row.id), weight: weights.semantic });
        used.push("semantic");
      }));
    }
    if (browseOnly) {
      jobs.push(time("browse", () => retrievers.browse(active)).then((rows) => {
        lists.push({ name: "browse", ids: rows.map((row) => row.id) });
        used.push("browse");
      }));
    }
    await Promise.all(jobs);
    // Stable list order, so fusion ties never depend on which query finished first.
    lists.sort((a, b) => a.name.localeCompare(b.name));
    return { lists, used: used.sort(), scored };
  }

  let { lists, used, scored } = await retrieve(filters);
  let fused = reciprocalRankFusion(lists);

  /*
   * Graceful relaxation. When the words find products but the constraints
   * leave none, the constraints are loosened one at a time — category first
   * (the words themselves usually say what the thing is), then colour, then
   * material — until something matches. Price is never relaxed: a budget is
   * the one constraint a shopper cannot be shown past without being misled.
   * Only relaxations that actually produced results are reported, so the page
   * never claims to have widened a search that still found nothing.
   */
  if (fused.length === 0 && !browseOnly) {
    const steps: { key: Relaxation; apply: (active: RetrievalFilters) => RetrievalFilters }[] = [
      { key: "categories", apply: (active) => ({ ...active, categories: [] }) },
      { key: "colors", apply: (active) => ({ ...active, colors: [] }) },
      { key: "materials", apply: (active) => ({ ...active, materials: [] }) },
    ];
    let candidate = filters;
    const tried: Relaxation[] = [];
    for (const step of steps) {
      const next = step.apply(candidate);
      if (JSON.stringify(next) === JSON.stringify(candidate)) continue;
      candidate = next;
      tried.push(step.key);
      const attempt = await retrieve(candidate);
      const attemptFused = reciprocalRankFusion(attempt.lists);
      if (attemptFused.length > 0) {
        ({ lists, used, scored } = attempt);
        fused = attemptFused;
        filters = candidate;
        relaxed.push(...tried);
        break;
      }
    }
  }

  const evidence: SearchEvidence | undefined = options.evidence === true ? { lexical: scored.lexical ?? [], fuzzy: scored.fuzzy ?? [], fused } : undefined;

  if (options.ranker != null && fused.length > 1) {
    const model = options.ranker;
    fused = await time("ranker", () => learnedOrder(model, retrievers, query, scored, fused));
  }

  let ids = fused.map((result) => result.id);

  if (options.rerank !== false && fused.length > 0) {
    const [signalRows, ratingRows] = await time("signals", () =>
      Promise.all([retrievers.signals(ids), retrievers.ratingTotals()]),
    );
    const prior = catalogRatingPrior(ratingRows.map((row) => ({ ratingSum: row.rating_sum, ratingCount: row.rating_count })));
    const byId = new Map(signalRows.map((row) => [row.id, row]));
    const signalMap = new Map<string, RerankSignals>(
      signalRows.map((row) => [
        row.id,
        { inStock: row.in_stock, ratingSum: row.rating_sum, ratingCount: row.rating_count, popularity: row.popularity },
      ]),
    );
    const reranked = rerank(fused, signalMap, prior);
    // Near-duplicates are products of the same kind whose titles share most
    // of their trigrams: one design in several finishes or sizes.
    const similarity = (a: { id: string }, b: { id: string }) => {
      const x = byId.get(a.id);
      const y = byId.get(b.id);
      if (x === undefined || y === undefined || x.kind !== y.kind) return 0;
      return trigramSimilarity(x.search_title, y.search_title);
    };
    ids = diversify(reranked, similarity).map((result) => result.id);
  }

  const suggestions =
    ids.length >= 3 || baseTerms.length === 0
      ? []
      : [
          ...new Set([
            ...corrections.flatMap((entry) => entry.words),
            ...baseTerms.flatMap((term) => vocabulary.index.similar(term, 0.4, 2).map((match) => match.term)),
          ]),
        ]
          .filter((word) => !baseTerms.includes(word))
          .slice(0, 3);

  return {
    query,
    readings,
    corrections,
    translations,
    filters,
    relaxed,
    ids: ids.slice(0, limit),
    ranks: Object.fromEntries(fused.map((result) => [result.id, result.ranks])),
    retrieversUsed: used,
    suggestions,
    timings,
    ...(evidence === undefined ? {} : { evidence }),
  };
}

/**
 * The learned ranking stage (docs/adr/057). The first RANKER_DEPTH fused
 * candidates are ordered by the model's score for their features
 * (src/lib/search/ranker.ts); the rest keep their fused order below them. The
 * new order is given back on the fused scale — 1 / (k + rank), as reciprocal
 * rank fusion would give a single list — so business re-ranking, which
 * multiplies relevance by stock, rating and popularity, still multiplies a
 * positive relevance in the same range it was tuned on.
 */
async function learnedOrder(model: RankerModel, retrievers: Retrievers, query: ParsedQuery, scored: Record<string, Retrieved[]>, fused: FusedResult[]): Promise<FusedResult[]> {
  const top = fused.slice(0, RANKER_DEPTH);
  const inputs = await rankingInputs(retrievers, query, { lexical: scored.lexical ?? [], fuzzy: scored.fuzzy ?? [], fused }, top.map((result) => result.id));
  // Ties (trees give one score to products they cannot tell apart) keep the retrievers' order.
  const ordered = top
    .map((result, position) => {
      const product = inputs.products.get(result.id);
      return { result, position, score: product === undefined ? -Infinity : predict(model, rankingFeatures(inputs.query, product)) };
    })
    .sort((a, b) => b.score - a.score || a.position - b.position);
  return [...ordered.map(({ result }) => result), ...fused.slice(RANKER_DEPTH)].map((result, rank) => ({ ...result, score: 1 / (RRF_K + rank + 1) }));
}

/**
 * What the learned stage reads, built in one place for the shop and for the
 * training data (scripts/esci-ranker-data.ts), so the model is always given
 * what it was trained on: the query's raw words with their rarity weights and
 * colours, each retriever's ranks and scores, and each candidate's title,
 * brand and colours.
 */
export async function rankingInputs(
  retrievers: Retrievers,
  query: ParsedQuery,
  evidence: SearchEvidence,
  ids: readonly string[],
): Promise<{ query: RankingQuery; products: Map<string, RankingProduct> }> {
  const [facts, idf] = await Promise.all([retrievers.rankingFacts(ids), retrievers.wordWeights(tokenize(query.raw))]);
  const evidenceOf = (rows: readonly { id: string; score: number }[]) => new Map(rows.map((row, rank) => [row.id, { rank, score: row.score }]));
  return {
    query: {
      text: query.raw,
      colors: query.colors,
      idf: (word) => idf.get(word) ?? 0,
      lexical: evidenceOf(evidence.lexical),
      fuzzy: evidenceOf(evidence.fuzzy),
      fused: evidenceOf(evidence.fused),
    },
    products: new Map(facts.map((fact) => [fact.id, fact])),
  };
}

export { NO_FILTERS };
