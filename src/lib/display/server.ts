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
import type { TemplateId } from "@/lib/optimize/templates";
import { buildBundles } from "@/lib/stylist/server";

/**
 * docs/adr/040. The Stylist's first set is the display: its pieces, in its
 * quantities, and its total — computed by the Stylist from the database in the
 * shopper's country, never by the page or a model. The first piece of the set
 * (the template's anchor: the chair of a reading corner, the sofa of a living
 * room) is the hero. When the Stylist finds no set in stock, the display says
 * so and falls back to the pieces a search for the theme's words finds,
 * without a total, so it is never an empty window.
 *
 * docs/adr/048. The window is a 3D room, so the Stylist is asked first for a
 * set it can stand there truthfully — pieces with their own scan, and rugs and
 * pictures, whose photograph is their face. Only when no such set fits does it
 * choose from every piece, and those without a scan are shown as cut-outs.
 * Each piece carries its slot (the part it plays: "chair", "lamp"), which is
 * how the room is arranged, and its scan when the file is really in storage.
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
  /** The Stylist slot it fills; null when the window came from a search. */
  role: string | null;
  kind: string;
  /** Its own 3D scan, only when the file is in storage (src/lib/catalog/stored-model.ts). */
  model: { src: string; bytes: number | null } | null;
  /** Its first photograph on a white studio ground, if any: what the 3D room draws a rug or a picture from. */
  studioImage: { src: string; alt: string } | null;
};

export type ComposedDisplay = {
  pieces: DisplayPiece[];
  /** The set's total from the Stylist, in the shopper's prices; null for a search fallback. */
  totalCents: number | null;
  fromStylist: boolean;
  /** The room the set was built for. */
  template: TemplateId;
};

const FALLBACK_PIECES = 5;

/** The first photograph shot on a white studio ground; a rug's first photograph is often the rug in a furnished room. */
function studioOf(media: readonly { src: string; alt: string; studio?: boolean }[]): { src: string; alt: string } | null {
  const studio = media.find((entry) => entry.studio === true);
  return studio === undefined ? null : { src: studio.src, alt: studio.alt };
}

export async function composeDisplay(request: DisplayRequest, locale: string): Promise<ComposedDisplay> {
  const stylistRequest = { template: request.template, budgetCents: request.budgetCents, ...(request.query === undefined ? {} : { query: request.query }) };
  const showable = await buildBundles(stylistRequest, { showable: true });
  const result = showable.bundles.length > 0 ? showable : await buildBundles(stylistRequest);
  const bundle = result.bundles[0];
  let picks: { productId: string; quantity: number; role: string | null }[] =
    bundle?.picks.map((pick) => ({ productId: pick.productId, quantity: pick.quantity, role: pick.slotId })) ?? [];
  const fromStylist = picks.length > 0;
  if (!fromStylist) {
    // The room's own words and the theme's: "dining black" finds a dining table even where nothing is black.
    const words = [request.template.replace("-", " "), request.query].filter((word) => word !== undefined && word !== "").join(" ");
    const found = await runSearch(words, { limit: FALLBACK_PIECES });
    picks = found.ids.slice(0, FALLBACK_PIECES).map((productId) => ({ productId, quantity: 1, role: null }));
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
      role: pick.role,
      kind: detail.kind,
      model: detail.model,
      studioImage: studioOf(detail.media),
    });
  });
  return { pieces, totalCents: fromStylist ? (bundle?.totalCents ?? null) : null, fromStylist, template: request.template };
}
