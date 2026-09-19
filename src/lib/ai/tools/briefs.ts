/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The compact product record tools return: ids and essentials from the database, never prose.
 */

import { z } from "zod";

import type { ProductCard } from "@/lib/catalog/queries";

/**
 * Tool outputs are compact (CLAUDE.md conventions): an id, the title, the
 * price for the shopper's country and whether it is in stock. Components render
 * the product from these database values; the model is told to point at them
 * rather than repeat prices in its own words (golden rule 5).
 */

export const productBriefSchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  brand: z.string().nullable(),
  kind: z.string().nullable(),
  priceCents: z.number().int(),
  compareAtCents: z.number().int().nullable(),
  currency: z.string(),
  inStock: z.boolean(),
  image: z.object({ src: z.string(), alt: z.string() }).nullable(),
});

export type ProductBrief = z.infer<typeof productBriefSchema>;

export function brief(card: ProductCard): ProductBrief {
  return {
    id: card.id,
    slug: card.slug,
    title: card.title,
    brand: card.brand,
    kind: card.kindLabel,
    priceCents: card.price.cents,
    compareAtCents: card.compareAt?.cents ?? null,
    currency: card.price.currency,
    inStock: card.inStock,
    image: card.image === null ? null : { src: card.image.src, alt: card.image.alt },
  };
}

/** Items in the order of `ids`, skipping any that no longer exist. */
export function inOrder<T extends { id: string }>(ids: readonly string[], items: readonly T[]): T[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  return ids.map((id) => byId.get(id)).filter((item): item is T => item !== undefined);
}
