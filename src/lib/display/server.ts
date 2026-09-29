/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Composing a window display: the Budget Stylist's best set for a theme, read from the database.
 */

import { getCardsByIds, getProduct, runSearch } from "@/lib/catalog/server";
import { isFlatKind } from "@/lib/display/stage";
import type { DisplayRequest } from "@/lib/display/themes";
import { buildBundles } from "@/lib/stylist/server";

/**
 * docs/adr/040. The Stylist's first set is the display: its pieces, in its
 * quantities, and its total — computed by the Stylist from the database in the
 * shopper's country, never by the page or a model. The first piece of the set
 * (the template's anchor: the chair of a reading corner, the sofa of a living
 * room) is the hero. When the Stylist finds no set in stock, the display says
 * so and falls back to the pieces a search for the theme's words finds,
 * without a total, so it is never an empty window.
 */

export type DisplayPiece = {
  id: string;
  slug: string;
  title: string;
  brand: string | null;
  kindLabel: string | null;
  image: { src: string; alt: string; whiteGround: boolean } | null;
  priceCents: number;
  currency: string;
  quantity: number;
  inStock: boolean;
  dimsCm: { w: number; d: number; h: number } | null;
  flat: boolean;
  hero: boolean;
  materials: string[];
  colorLabel: string | null;
};

export type ComposedDisplay = {
  pieces: DisplayPiece[];
  /** The set's total from the Stylist, in the shopper's prices; null for a search fallback. */
  totalCents: number | null;
  fromStylist: boolean;
};

const FALLBACK_PIECES = 5;

export async function composeDisplay(request: DisplayRequest, locale: string): Promise<ComposedDisplay> {
  const result = await buildBundles({ template: request.template, budgetCents: request.budgetCents, ...(request.query === undefined ? {} : { query: request.query }) });
  const bundle = result.bundles[0];
  let picks: { productId: string; quantity: number }[] = bundle?.picks.map((pick) => ({ productId: pick.productId, quantity: pick.quantity })) ?? [];
  const fromStylist = picks.length > 0;
  if (!fromStylist) {
    const found = await runSearch(request.query ?? request.template.replace("-", " "), { limit: FALLBACK_PIECES });
    picks = found.ids.slice(0, FALLBACK_PIECES).map((productId) => ({ productId, quantity: 1 }));
  }

  const cards = await getCardsByIds(
    picks.map((pick) => pick.productId),
    locale,
  );
  const details = await Promise.all(cards.map((card) => getProduct(card.slug, locale)));
  const pieces: DisplayPiece[] = [];
  picks.forEach((pick, index) => {
    const card = cards.find((entry) => entry.id === pick.productId);
    const detail = details.find((entry) => entry?.id === pick.productId);
    if (card === undefined || detail == null) return;
    pieces.push({
      id: card.id,
      slug: card.slug,
      title: card.title,
      brand: card.brand,
      kindLabel: card.kindLabel,
      image: card.image === null ? null : { src: card.image.src, alt: card.image.alt, whiteGround: card.image.studio !== false },
      priceCents: card.price.cents,
      currency: card.price.currency,
      quantity: pick.quantity,
      inStock: card.inStock,
      dimsCm: detail.dimsCm,
      flat: isFlatKind(detail.kind),
      hero: index === 0,
      materials: detail.materials,
      colorLabel: detail.colorLabel,
    });
  });
  return { pieces, totalCents: fromStylist ? (bundle?.totalCents ?? null) : null, fromStylist };
}
