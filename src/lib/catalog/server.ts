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
import { currentRegion } from "@/lib/commerce/region";
import { toBaseBound } from "@/lib/commerce/vat";
import { sql } from "@/lib/db/client";
import { searchProducts, type SearchOptions } from "@/lib/search/pipeline";
import { createRetrievers } from "@/lib/search/retrieve";

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

export const getProduct = cache(async (slug: string, locale: string) => {
  await connection();
  const [product, region] = await Promise.all([queries().productBySlug(slug, locale), currentRegion()]);
  return product === null ? null : localizeDetail(product, region.country);
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

export async function getCardsByIds(ids: readonly string[], locale: string) {
  await connection();
  const { country } = await currentRegion();
  return (await queries().cardsByIds(ids, locale)).map((card) => localizeCard(card, country));
}

export async function getProductSlugs() {
  await connection();
  return queries().allProductSlugs();
}

export async function runSearch(query: string, options?: SearchOptions) {
  await connection();
  const { country } = await currentRegion();
  // "Under €200" means €200 in the shopper's prices.
  return searchProducts(retrievers(), query, { ...options, priceToBase: (cents, bound) => toBaseBound(cents, bound, country) });
}
