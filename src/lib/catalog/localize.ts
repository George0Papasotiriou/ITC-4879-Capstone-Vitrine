/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Converts stored catalogue prices into the shopper's country prices.
 */

import type { ListingState } from "@/lib/catalog/listing";
import type { Listing, ProductCard, ProductDetail } from "@/lib/catalog/queries";
import { money, type Money } from "@/lib/commerce/money";
import { localizeCents, toBaseBound } from "@/lib/commerce/vat";

/**
 * Catalogue prices in the shopper's country (docs/adr/013). The database holds
 * Greek prices; everything a page renders passes through here first, so no
 * component ever shows a stored price by mistake.
 */

const convert = (amount: Money, country: string): Money => money(localizeCents(amount.cents, country), amount.currency);

export function localizeCard<T extends ProductCard>(card: T, country: string): T {
  return { ...card, price: convert(card.price, country), compareAt: card.compareAt === null ? null : convert(card.compareAt, country) };
}

export function localizeDetail(product: ProductDetail, country: string): ProductDetail {
  return localizeCard(product, country);
}

/** Price bounds the shopper typed, in stored-price terms for the query. */
export function listingStateToBase(state: ListingState, country: string): ListingState {
  return {
    ...state,
    minCents: state.minCents === null ? null : toBaseBound(state.minCents, "min", country),
    maxCents: state.maxCents === null ? null : toBaseBound(state.maxCents, "max", country),
  };
}

/** A listing from the query, shown in the shopper's prices. */
export function localizeListing(listing: Listing, country: string): Listing {
  const bounds = listing.facets.price;
  return {
    ...listing,
    products: listing.products.map((card) => localizeCard(card, country)),
    facets: {
      ...listing.facets,
      price: bounds === null ? null : { minCents: localizeCents(bounds.minCents, country), maxCents: localizeCents(bounds.maxCents, country) },
    },
  };
}
