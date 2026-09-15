/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Unit tests for converting catalogue prices to the shopper's country.
 */

import { describe, expect, it } from "vitest";

import { EMPTY_LISTING } from "@/lib/catalog/listing";
import { listingStateToBase, localizeCard, localizeListing } from "@/lib/catalog/localize";
import type { Listing, ProductCard } from "@/lib/catalog/queries";
import { money } from "@/lib/commerce/money";
import { localizeCents } from "@/lib/commerce/vat";

const card: ProductCard = {
  id: "0191e2c4-5b6a-7c8d-9e0f-a1b2c3d4e5f6",
  slug: "lamp",
  title: "Lamp",
  kind: "LAMP",
  kindLabel: "Lamp",
  brand: null,
  category: "lighting",
  price: money(12_400),
  compareAt: money(15_500),
  inStock: true,
  image: null,
  hoverImage: null,
};

describe("catalogue prices by country", () => {
  it("converts the price and the compare-at price, and leaves everything else alone", () => {
    const german = localizeCard(card, "DE");
    expect(german.price.cents).toBe(11_900);
    expect(german.compareAt?.cents).toBe(localizeCents(15_500, "DE"));
    expect({ ...german, price: card.price, compareAt: card.compareAt }).toEqual(card);
    expect(localizeCard({ ...card, compareAt: null }, "DE").compareAt).toBeNull();
  });

  it("turns price filters typed in local prices into stored-price bounds", () => {
    const state = listingStateToBase({ ...EMPTY_LISTING, minCents: 10_000, maxCents: 20_000 }, "DE");
    expect(localizeCents(state.maxCents!, "DE")).toBeLessThanOrEqual(20_000);
    expect(localizeCents(state.maxCents! + 1, "DE")).toBeGreaterThan(20_000);
    expect(localizeCents(state.minCents!, "DE")).toBeGreaterThanOrEqual(10_000);
    expect(listingStateToBase({ ...EMPTY_LISTING }, "DE")).toEqual(EMPTY_LISTING);
  });

  it("shows a listing's cards and price facet in local prices", () => {
    const listing: Listing = {
      products: [card],
      total: 1,
      pageCount: 1,
      facets: { colors: [], materials: [], brands: [], price: { minCents: 1_240, maxCents: 124_000 } },
    };
    const swedish = localizeListing(listing, "SE");
    expect(swedish.products[0]!.price.cents).toBe(12_500);
    expect(swedish.facets.price).toEqual({ minCents: 1_250, maxCents: 125_000 });
    expect(localizeListing({ ...listing, facets: { ...listing.facets, price: null } }, "SE").facets.price).toBeNull();
  });
});
