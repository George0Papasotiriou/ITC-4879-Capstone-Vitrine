/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * End-to-end hybrid search pipeline: parse, retrieve, fuse, rerank and diversify.
 */

import { reciprocalRankFusion, type RankedList } from "@/lib/search/fusion";
import { resolveGreeklish, type GreeklishReading } from "@/lib/search/greeklish";
import { scriptOf, tokenize } from "@/lib/search/normalize";
import { parseQuery, type ParsedQuery } from "@/lib/search/parse";
import { catalogRatingPrior, diversify, rerank, type RerankSignals } from "@/lib/search/rerank";
import { corrections as spellingCorrections } from "@/lib/search/spelling";
import { NO_FILTERS, type RetrievalFilters, type Retrievers } from "@/lib/search/retrieve";
import { TrigramIndex, trigramSimilarity } from "@/lib/search/trigram";

/**
 * The A1 search pipeline, end to end (docs/PLAN.md 2.6):
 *
 *   parse → expand (Greeklish, spelling) → retrieve (lexical, fuzzy, semantic) → fuse (RRF)
 *         → re-rank (stock, rating, popularity) → diversify (MMR)
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
};

export type SearchResult = {
  query: ParsedQuery;
  /** Greek readings found for Latin words ("kanapes" → καναπεσ). */
  readings: { term: string; readings: GreeklishReading[] }[];
  /** Spelling corrections from the catalogue vocabulary ("chiar" → chair). */
  corrections: { term: string; words: string[] }[];
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
};

export type Relaxation = "categories" | "colors" | "materials";

export const DEFAULT_WEIGHTS = { lexical: 1, fuzzy: 0.7, semantic: 1 };

/** Vocabulary cache: rebuilt at most every five minutes per process. */
const VOCABULARY_TTL_MS = 5 * 60 * 1000;
let vocabularyCache: { index: TrigramIndex; words: Set<string>; loadedAt: number } | null = null;

async function vocabularyIndex(retrievers: Retrievers) {
  if (vocabularyCache !== null && Date.now() - vocabularyCache.loadedAt < VOCABULARY_TTL_MS) return vocabularyCache;
  const words = await retrievers.vocabulary();
  vocabularyCache = { index: new TrigramIndex(words), words: new Set(words), loadedAt: Date.now() };
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
 */
export function expandTerms(
  terms: readonly string[],
  vocabulary: { index: TrigramIndex; words: ReadonlySet<string> },
): { terms: string[]; readings: SearchResult["readings"]; corrections: SearchResult["corrections"] } {
  const expanded: string[] = [];
  const readings: SearchResult["readings"] = [];
  const corrections: SearchResult["corrections"] = [];
  for (const term of terms) {
    expanded.push(term);
    if (vocabulary.words.has(term)) continue;

    if (scriptOf(term) === "latin") {
      const found = resolveGreeklish(term, vocabulary.index);
      if (found.length > 0) {
        readings.push({ term, readings: found });
        for (const reading of found) expanded.push(reading.greek);
        continue;
      }
    }

    const words = spellingCorrections(term, vocabulary.words).map((correction) => correction.word);
    if (words.length > 0) {
      corrections.push({ term, words });
      expanded.push(...words);
    }
  }
  return { terms: expanded, readings, corrections };
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
  const { terms, readings, corrections } = expandTerms(baseTerms, vocabulary);
  const fuzzyText = [query.text, ...readings.flatMap((entry) => entry.readings.map((reading) => reading.greek))].join(" ").trim();

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
    const embedding = options.embedding ?? null;
    const jobs: Promise<void>[] = [];
    if (use.lexical && terms.length > 0) {
      jobs.push(time("lexical", () => retrievers.lexical(terms, active)).then((rows) => {
        lists.push({ name: "lexical", ids: rows.map((row) => row.id), weight: weights.lexical });
        used.push("lexical");
      }));
    }
    if (use.fuzzy && fuzzyText.length >= 3) {
      jobs.push(time("fuzzy", () => retrievers.fuzzy(fuzzyText, active)).then((rows) => {
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
    return { lists, used: used.sort() };
  }

  let { lists, used } = await retrieve(filters);
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
        ({ lists, used } = attempt);
        fused = attemptFused;
        filters = candidate;
        relaxed.push(...tried);
        break;
      }
    }
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
    filters,
    relaxed,
    ids: ids.slice(0, limit),
    ranks: Object.fromEntries(fused.map((result) => [result.id, result.ranks])),
    retrieversUsed: used,
    suggestions,
    timings,
  };
}

export { NO_FILTERS };
