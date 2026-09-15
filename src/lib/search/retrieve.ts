/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Database retrievers: lexical full-text, fuzzy trigram and semantic search.
 */

import type postgres from "postgres";

/**
 * Retrieval — step 3 of the A1 pipeline (docs/PLAN.md 2.6).
 *
 * Each retriever answers the same question in its own way and returns product
 * ids best first. None of them is trusted alone; fusion combines them.
 *
 *   lexical   full-text search over the weighted `search_tsv` column. Finds the
 *             words, forgives inflection (stemmed in English and Greek), and
 *             ranks title matches above description matches with ts_rank_cd.
 *   fuzzy     trigram similarity on the title and kind. Finds "chiar" and
 *             "fotistko", which full-text search cannot, because a typo changes
 *             the word but keeps most of its three-letter pieces.
 *   semantic  cosine distance between the query embedding and product
 *             embeddings (pgvector HNSW). Finds meaning without shared words.
 *             It needs an embedding model, so it runs only when embeddings exist.
 *
 * Every retriever applies the hard filters itself. Filtering after retrieval
 * would let 100 unaffordable sofas fill the candidate list and leave nothing
 * for the filter to keep.
 */

type Sql = postgres.Sql;

export type RetrievalFilters = {
  categories: readonly string[];
  colors: readonly string[];
  materials: readonly string[];
  minCents: number | null;
  maxCents: number | null;
  inStock: boolean;
};

export const NO_FILTERS: RetrievalFilters = {
  categories: [],
  colors: [],
  materials: [],
  minCents: null,
  maxCents: null,
  inStock: false,
};

export type Retrieved = { id: string; score: number };

export const RETRIEVAL_DEPTH = 100;

/**
 * Trigram similarity a fuzzy candidate needs. Word similarity compares the
 * query with the best-matching stretch of the title, so "chiar" scores well
 * against "Mid-Century Accent Chair" even though the whole titles differ.
 */
export const FUZZY_THRESHOLD = 0.35;

export function createRetrievers(sql: Sql) {
  function filterSql(filters: RetrievalFilters) {
    const parts = [sql`p.status = 'active'`];
    if (filters.categories.length > 0) {
      parts.push(sql`p.category_id IN (SELECT id FROM categories WHERE slug = ANY(${[...filters.categories]}::text[]))`);
    }
    if (filters.colors.length > 0) parts.push(sql`p.colors && ${[...filters.colors]}::text[]`);
    if (filters.materials.length > 0) parts.push(sql`p.materials && ${[...filters.materials]}::text[]`);
    if (filters.minCents !== null) parts.push(sql`p.price_cents >= ${filters.minCents}`);
    if (filters.maxCents !== null) parts.push(sql`p.price_cents <= ${filters.maxCents}`);
    if (filters.inStock) {
      parts.push(sql`EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id AND v.stock > 0)`);
    }
    return parts.reduce((all, part) => sql`${all} AND ${part}`);
  }

  /**
   * Terms are OR-ed: a product matching three of four words should still be a
   * candidate, and ts_rank_cd already ranks it above one matching a single
   * word. Each term is parsed with both stemmers, so "chairs" meets "chair"
   * and "καρέκλες" meets "καρέκλα". Terms go in as parameters through
   * plainto_tsquery, which cannot be broken by query syntax characters.
   */
  async function lexical(terms: readonly string[], filters: RetrievalFilters, limit = RETRIEVAL_DEPTH): Promise<Retrieved[]> {
    const usable = [...new Set(terms)].filter((term) => term.length > 0).slice(0, 12);
    if (usable.length === 0) return [];

    const query = usable
      .map((term) => sql`(plainto_tsquery('english', ${term}) || plainto_tsquery('greek', ${term}))`)
      .reduce((all, part) => sql`${all} || ${part}`);

    return sql<Retrieved[]>`
      SELECT p.id, ts_rank_cd(p.search_tsv, q.query)::float8 AS score
      FROM products p, (SELECT ${query} AS query) q
      WHERE p.search_tsv @@ q.query AND ${filterSql(filters)}
      ORDER BY score DESC, p.id
      LIMIT ${limit}
    `;
  }

  async function fuzzy(text: string, filters: RetrievalFilters, limit = RETRIEVAL_DEPTH): Promise<Retrieved[]> {
    if (text.trim().length < 3) return [];
    // The `<%` operator is what lets PostgreSQL use the trigram index, but it
    // compares against the session setting pg_trgm.word_similarity_threshold
    // (0.6 by default), not against a parameter. SET LOCAL scopes the setting to
    // this transaction, so no other query on the pooled connection sees it.
    return sql.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL pg_trgm.word_similarity_threshold = ${FUZZY_THRESHOLD}`);
      return tx<Retrieved[]>`
      SELECT p.id,
             greatest(word_similarity(${text}, p.search_title), word_similarity(${text}, p.search_meta))::float8 AS score
      FROM products p
      WHERE (${text} <% p.search_title OR ${text} <% p.search_meta)
        AND ${filterSql(filters)}
      ORDER BY score DESC, p.id
      LIMIT ${limit}
    `;
    });
  }

  /** Semantic retrieval, given a query embedding from the embedding model. */
  async function semantic(embedding: readonly number[], filters: RetrievalFilters, limit = RETRIEVAL_DEPTH): Promise<Retrieved[]> {
    const vector = `[${embedding.join(",")}]`;
    return sql<Retrieved[]>`
      SELECT p.id, (1 - (p.text_embedding <=> ${vector}::vector))::float8 AS score
      FROM products p
      WHERE p.text_embedding IS NOT NULL AND ${filterSql(filters)}
      ORDER BY p.text_embedding <=> ${vector}::vector
      LIMIT ${limit}
    `;
  }

  /**
   * A query of constraints only ("black under 300") has no words to rank by;
   * every product that meets the constraints is a candidate, most available
   * and most popular first.
   */
  async function browse(filters: RetrievalFilters, limit = RETRIEVAL_DEPTH): Promise<Retrieved[]> {
    return sql<Retrieved[]>`
      SELECT p.id, p.popularity::float8 AS score
      FROM products p
      WHERE ${filterSql(filters)}
      ORDER BY EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id AND v.stock > 0) DESC,
               p.popularity DESC, p.source_id
      LIMIT ${limit}
    `;
  }

  async function hasEmbeddings(): Promise<boolean> {
    const [row] = await sql<{ present: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM products WHERE text_embedding IS NOT NULL) AS present
    `;
    return row?.present ?? false;
  }

  /** Business signals for re-ranking, plus what diversity compares. */
  async function signals(ids: readonly string[]) {
    if (ids.length === 0) return [];
    return sql<
      { id: string; in_stock: boolean; rating_sum: number; rating_count: number; popularity: number; kind: string; search_title: string }[]
    >`
      SELECT p.id,
             EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id AND v.stock > 0) AS in_stock,
             p.rating_sum, p.rating_count, p.popularity, p.kind, p.search_title
      FROM products p
      WHERE p.id = ANY(${[...ids]}::uuid[])
    `;
  }

  async function ratingTotals() {
    return sql<{ rating_sum: number; rating_count: number }[]>`
      SELECT rating_sum, rating_count FROM products WHERE status = 'active' AND rating_count > 0
    `;
  }

  /**
   * The words the catalogue is written in, for Greeklish resolution and "did
   * you mean". Taken from titles, kinds, brands, categories and attributes —
   * not descriptions, whose long tail would only add noise to suggestions.
   */
  async function vocabulary(): Promise<string[]> {
    const rows = await sql<{ word: string }[]>`
      SELECT DISTINCT word
      FROM products p,
           regexp_split_to_table(p.search_title || ' ' || p.search_meta || ' ' || p.search_attributes, ' ') AS word
      WHERE p.status = 'active' AND length(word) >= 3
    `;
    return rows.map((row) => row.word);
  }

  return { lexical, fuzzy, semantic, browse, hasEmbeddings, signals, ratingTotals, vocabulary };
}

export type Retrievers = ReturnType<typeof createRetrievers>;
