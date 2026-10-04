/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Request-scoped catalogue and search access for pages and route handlers.
 */

import { connection } from "next/server";
import { cache } from "react";

import { listingStateToBase, localizeCard, localizeDetail, localizeListing } from "@/lib/catalog/localize";
import { createCatalogQueries, type CatalogQueries } from "@/lib/catalog/queries";
import { createStoredModelCheck } from "@/lib/catalog/stored-model";
import { currentRegion } from "@/lib/commerce/region";
import { toBaseBound } from "@/lib/commerce/vat";
import { serverEnv } from "@/env";
import { sql } from "@/lib/db/client";
import { cached } from "@/lib/kv/cache";
import { E1_SYSTEMS, type E1System } from "@/lib/search/evaluation";
import { searchProducts, type SearchOptions } from "@/lib/search/pipeline";
import { createRetrievers } from "@/lib/search/retrieve";
import { checkModel, type RankerModel } from "@/lib/search/ranker";
import rankerV1 from "@/lib/search/models/ranker-v1.json";
import { storage } from "@/lib/storage";

/**
 * Catalogue access for pages and route handlers.
 *
 * Each function first awaits `connection()`: prices and stock must be read when
 * someone asks, not frozen into HTML at build time, and a build must never need
 * a database. `cache` deduplicates within one request, so a product page that
 * reads the product for its metadata and again for its body queries once.
 *
 * Prices come back in the shopper's country (docs/adr/013): stored prices are
 * Greek, and every read here converts them before a page sees them.
 */

// Created on first use: building the query fragments touches the database
// client, and importing this module must stay free for `next build`.
let catalogQueries: ReturnType<typeof createCatalogQueries> | undefined;
let searchRetrievers: ReturnType<typeof createRetrievers> | undefined;
const queries = () => (catalogQueries ??= createCatalogQueries(sql));
const retrievers = () => (searchRetrievers ??= createRetrievers(sql));

/** A 3D scan is offered only when its file is in storage (src/lib/catalog/stored-model.ts). */
const storedModel = createStoredModelCheck(storage);

export const getProduct = cache(async (slug: string, locale: string) => {
  await connection();
  const [product, region] = await Promise.all([queries().productBySlug(slug, locale), currentRegion()]);
  if (product === null) return null;
  const [model, aiModel] = await Promise.all([storedModel(product.model), storedModel(product.aiModel)]);
  return localizeDetail({ ...product, model, aiModel: model === null ? aiModel : null }, region.country);
});

export const getCategories = cache(async (locale: string) => {
  await connection();
  return queries().listCategories(locale);
});

export async function getListing(params: Parameters<CatalogQueries["listProducts"]>[0]) {
  await connection();
  const { country } = await currentRegion();
  // Price filters arrive in the shopper's prices; the database holds Greek prices.
  const listing = await queries().listProducts({ ...params, state: listingStateToBase(params.state, country) });
  return localizeListing(listing, country);
}

export async function getFeatured(params: Parameters<CatalogQueries["featured"]>[0]) {
  await connection();
  const { country } = await currentRegion();
  return (await queries().featured(params)).map((card) => localizeCard(card, country));
}

export async function getPlaceable(params: Parameters<CatalogQueries["placeable"]>[0]) {
  await connection();
  const { country } = await currentRegion();
  return (await queries().placeable(params)).map((card) => localizeCard(card, country));
}

export async function getWallPieces(params: Parameters<CatalogQueries["forWalls"]>[0]) {
  await connection();
  const { country } = await currentRegion();
  return (await queries().forWalls(params)).map((entry) => ({ card: localizeCard(entry.card, country), dimsCm: entry.dimsCm }));
}

export async function getCardsByIds(ids: readonly string[], locale: string) {
  await connection();
  const { country } = await currentRegion();
  return (await queries().cardsByIds(ids, locale)).map((card) => localizeCard(card, country));
}

export async function getProductSlugs() {
  await connection();
  return queries().allProductSlugs();
}

/**
 * The learned ranking stage the shop runs (docs/adr/057), unless SEARCH_RANKER
 * is "off" or the model was trained on other features than the code computes
 * (then search simply runs without it).
 */
function shopRanker(): RankerModel | null {
  if (serverEnv().SEARCH_RANKER === "off") return null;
  const model = rankerV1 as RankerModel;
  return checkModel(model) ? model : null;
}

export async function runSearch(query: string, options?: SearchOptions) {
  await connection();
  const { country } = await currentRegion();
  const ranker = options?.ranker === undefined ? shopRanker() : options.ranker;
  // "Under €200" means €200 in the shopper's prices.
  const run = () => searchProducts(retrievers(), query, { ...options, ranker, priceToBase: (cents, bound) => toBaseBound(cents, bound, country) });
  // A query with its own embedding is personal to that request; everything else is the same for
  // everyone in a country, so its ranking is kept for two minutes (docs/adr/039). Cards, prices and
  // stock are read fresh by the caller either way. The ranker's version is part of the key, so a
  // new model is never served an old model's order.
  if (options?.embedding != null) return run();
  const { filters = null, limit = null, retrievers: stages = null, rerank = null, weights = null } = options ?? {};
  return cached("search", { query, country, filters, limit, stages, rerank, weights, learned: ranker?.version ?? null }, SEARCH_CACHE_SECONDS, run);
}

const SEARCH_CACHE_SECONDS = 120;

/**
 * One E1 system's ranking for a query (docs/adr/036): the shop's search with
 * stages switched off, prices read as stored (the Greek prices), so the
 * evaluation does not depend on where the person judging is.
 */
export async function rankForSystem(query: string, system: E1System, limit = 10): Promise<string[]> {
  await connection();
  return (await searchProducts(retrievers(), query, { ...E1_SYSTEMS[system], limit })).ids.slice(0, limit);
}
