/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Listing state in the URL: filters, sort and page parsing and serialisation.
 */

import { z } from "zod";

import { COLORS, MATERIALS } from "@/lib/search/vocabulary";

/**
 * Listing state in the URL (docs/PLAN.md Phase 3, step 5).
 *
 * Filters, sort and page live in the query string, so a filtered view can be
 * shared, bookmarked, reloaded and navigated with the back button, and the
 * Concierge can open one by URL. Parsing is forgiving: an unknown colour or a
 * malformed price is dropped rather than turned into an error page, because a
 * hand-edited or outdated link should still show products.
 *
 *   /c/seating?color=black&color=grey&material=leather&max=300&stock=1&sort=price-asc&page=2
 */

export const SORTS = ["featured", "price-asc", "price-desc", "newest"] as const;
export type Sort = (typeof SORTS)[number];

export const PAGE_SIZE = 24;
const MAX_PAGE = 500;

export type ListingState = {
  colors: string[];
  materials: string[];
  brands: string[];
  /** Whole-euro bounds in the URL, cents here. */
  minCents: number | null;
  maxCents: number | null;
  inStock: boolean;
  sort: Sort;
  page: number;
};

export type SearchParams = Record<string, string | string[] | undefined>;

const all = (value: string | string[] | undefined): string[] =>
  value === undefined ? [] : (Array.isArray(value) ? value : [value]).flatMap((entry) => entry.split(","));

const first = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value[0] : value);

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function euros(value: string | undefined): number | null {
  if (value === undefined || !/^\d{1,6}$/.test(value.trim())) return null;
  return Number(value.trim()) * 100;
}

const brandSlug = z.string().regex(/^[a-z0-9-]{1,80}$/);

export function parseListing(params: SearchParams): ListingState {
  let minCents = euros(first(params.min));
  let maxCents = euros(first(params.max));
  if (minCents !== null && maxCents !== null && minCents > maxCents) [minCents, maxCents] = [maxCents, minCents];

  const sort = first(params.sort);
  const page = Number.parseInt(first(params.page) ?? "1", 10);

  return {
    colors: unique(all(params.color).filter((id) => id in COLORS)).sort(),
    materials: unique(all(params.material).filter((id) => id in MATERIALS)).sort(),
    brands: unique(all(params.brand).filter((slug) => brandSlug.safeParse(slug).success)).sort(),
    minCents,
    maxCents,
    inStock: first(params.stock) === "1",
    sort: (SORTS as readonly string[]).includes(sort ?? "") ? (sort as Sort) : "featured",
    page: Number.isFinite(page) && page >= 1 ? Math.min(page, MAX_PAGE) : 1,
  };
}

/** The canonical query string for a state: stable order, defaults omitted. */
export function listingQuery(state: ListingState): string {
  const params = new URLSearchParams();
  for (const color of state.colors) params.append("color", color);
  for (const material of state.materials) params.append("material", material);
  for (const brand of state.brands) params.append("brand", brand);
  if (state.minCents !== null) params.set("min", String(Math.floor(state.minCents / 100)));
  if (state.maxCents !== null) params.set("max", String(Math.ceil(state.maxCents / 100)));
  if (state.inStock) params.set("stock", "1");
  if (state.sort !== "featured") params.set("sort", state.sort);
  if (state.page > 1) params.set("page", String(state.page));
  const query = params.toString();
  return query === "" ? "" : `?${query}`;
}

type Facet = "colors" | "materials" | "brands";

/** The state after toggling one facet value. Any filter change returns to page 1. */
export function toggle(state: ListingState, facet: Facet, value: string): ListingState {
  const current = state[facet];
  const next = current.includes(value) ? current.filter((entry) => entry !== value) : [...current, value].sort();
  return { ...state, [facet]: next, page: 1 };
}

export function withChanges(state: ListingState, changes: Partial<ListingState>): ListingState {
  const filterChanged = Object.keys(changes).some((key) => key !== "page");
  return { ...state, ...changes, page: changes.page ?? (filterChanged ? 1 : state.page) };
}

export function activeFilterCount(state: ListingState): number {
  return (
    state.colors.length +
    state.materials.length +
    state.brands.length +
    (state.minCents === null && state.maxCents === null ? 0 : 1) +
    (state.inStock ? 1 : 0)
  );
}

export const EMPTY_LISTING: ListingState = parseListing({});

/** The nearest "shop" number at or above a value: 1, 2 or 5 times a power of ten (€50, €100, €200, €500…). */
export function niceCeiling(value: number): number {
  if (value <= 0) return 0;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 5, 10]) {
    if (step * magnitude >= value) return step * magnitude;
  }
  return 10 * magnitude;
}

export type PriceBucket = { minCents: number | null; maxCents: number | null };

/**
 * Price presets for a facet, from the range of prices actually present:
 * "Under €100", "€100 to €200", "€200 to €500", "Over €500". Boundaries are
 * round numbers, because nobody thinks in €137, and the range is split at
 * roughly quarter points of the logarithmic span, because prices spread
 * multiplicatively — the gap between €50 and €100 matters as much as the gap
 * between €500 and €1,000.
 */
export function priceBuckets(minCents: number, maxCents: number, count = 4): PriceBucket[] {
  const minEuros = Math.max(1, Math.floor(minCents / 100));
  const maxEuros = Math.ceil(maxCents / 100);
  if (maxEuros <= minEuros * 1.5) return [];

  const boundaries: number[] = [];
  const logMin = Math.log10(minEuros);
  const logMax = Math.log10(maxEuros);
  for (let i = 1; i < count; i += 1) {
    const boundary = niceCeiling(10 ** (logMin + ((logMax - logMin) * i) / count));
    if (boundary > minEuros && boundary < maxEuros && !boundaries.includes(boundary)) boundaries.push(boundary);
  }
  if (boundaries.length === 0) return [];

  const buckets: PriceBucket[] = [{ minCents: null, maxCents: boundaries[0]! * 100 }];
  for (let i = 1; i < boundaries.length; i += 1) {
    buckets.push({ minCents: boundaries[i - 1]! * 100, maxCents: boundaries[i]! * 100 });
  }
  buckets.push({ minCents: boundaries.at(-1)! * 100, maxCents: null });
  return buckets;
}
