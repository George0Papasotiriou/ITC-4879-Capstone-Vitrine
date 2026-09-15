/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Unit tests for listing URL state parsing and filter helpers.
 */

import { describe, expect, it } from "vitest";

import {
  activeFilterCount,
  EMPTY_LISTING,
  listingQuery,
  niceCeiling,
  parseListing,
  priceBuckets,
  toggle,
  withChanges,
} from "@/lib/catalog/listing";

describe("parseListing", () => {
  it("reads every filter from the query string", () => {
    expect(
      parseListing({
        color: ["grey", "black"],
        material: "leather",
        brand: "rivet",
        min: "100",
        max: "300",
        stock: "1",
        sort: "price-asc",
        page: "2",
      }),
    ).toEqual({
      colors: ["black", "grey"],
      materials: ["leather"],
      brands: ["rivet"],
      minCents: 10_000,
      maxCents: 30_000,
      inStock: true,
      sort: "price-asc",
      page: 2,
    });
  });

  it("accepts comma-separated lists, as the Concierge may send them", () => {
    expect(parseListing({ color: "black,white" }).colors).toEqual(["black", "white"]);
  });

  it("drops unknown or malformed values instead of failing", () => {
    expect(
      parseListing({
        color: ["black", "sparkly"],
        material: "<script>",
        brand: "Not A Slug!",
        min: "abc",
        max: "-5",
        sort: "cheapest",
        page: "0",
      }),
    ).toEqual({ ...EMPTY_LISTING, colors: ["black"] });
  });

  it("swaps a reversed price range", () => {
    const state = parseListing({ min: "500", max: "200" });
    expect([state.minCents, state.maxCents]).toEqual([20_000, 50_000]);
  });

  it("caps the page number", () => {
    expect(parseListing({ page: "999999" }).page).toBe(500);
  });

  it("removes duplicates", () => {
    expect(parseListing({ color: ["black", "black"] }).colors).toEqual(["black"]);
  });
});

describe("listingQuery", () => {
  it("omits defaults, so the unfiltered page has a clean URL", () => {
    expect(listingQuery(EMPTY_LISTING)).toBe("");
  });

  it("round-trips through parseListing", () => {
    const state = parseListing({ color: ["grey", "black"], max: "300", stock: "1", sort: "newest", page: "3" });
    const query = new URLSearchParams(listingQuery(state));
    const params: Record<string, string[]> = {};
    for (const [key, value] of query) params[key] = [...(params[key] ?? []), value];
    expect(parseListing(params)).toEqual(state);
  });

  it("writes a stable order, so the same filters always make the same URL", () => {
    const a = listingQuery(parseListing({ color: ["grey", "black"] }));
    const b = listingQuery(parseListing({ color: ["black", "grey"] }));
    expect(a).toBe(b);
    expect(a).toBe("?color=black&color=grey");
  });
});

describe("state changes", () => {
  it("toggles a facet value on and off, returning to page 1", () => {
    const onPage3 = { ...EMPTY_LISTING, page: 3 };
    const on = toggle(onPage3, "colors", "black");
    expect(on.colors).toEqual(["black"]);
    expect(on.page).toBe(1);
    expect(toggle(on, "colors", "black").colors).toEqual([]);
  });

  it("returns to page 1 when a filter changes but not when only the page does", () => {
    const state = { ...EMPTY_LISTING, page: 4 };
    expect(withChanges(state, { sort: "price-desc" }).page).toBe(1);
    expect(withChanges(state, { page: 5 }).page).toBe(5);
  });

  it("counts active filters, treating a price range as one", () => {
    expect(activeFilterCount(parseListing({ color: ["black", "grey"], min: "10", max: "90", stock: "1" }))).toBe(4);
    expect(activeFilterCount(parseListing({ sort: "newest", page: "2" }))).toBe(0);
  });
});

describe("price presets", () => {
  it("rounds boundaries up to 1, 2 or 5 times a power of ten", () => {
    expect([37, 100, 101, 180, 260, 999, 1001].map(niceCeiling)).toEqual([50, 100, 200, 200, 500, 1000, 2000]);
  });

  it("splits a wide price range into round, increasing buckets that cover everything", () => {
    const buckets = priceBuckets(6_900, 169_900);
    expect(buckets.length).toBeGreaterThanOrEqual(3);
    expect(buckets[0]!.minCents).toBeNull();
    expect(buckets.at(-1)!.maxCents).toBeNull();
    for (let i = 1; i < buckets.length; i += 1) {
      expect(buckets[i]!.minCents).toBe(buckets[i - 1]!.maxCents);
      expect(buckets[i]!.minCents! % 1000).toBe(0);
    }
  });

  it("offers no presets when prices barely vary", () => {
    expect(priceBuckets(10_000, 12_000)).toEqual([]);
  });
});
