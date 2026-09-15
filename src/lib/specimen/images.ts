/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Maps specimen products onto the catalogue image shape.
 */

import type { CatalogImage } from "@/lib/catalog/queries";
import type { SpecimenProduct } from "@/lib/specimen/catalog";

/**
 * The design specimen (/design) is deliberately independent of the database —
 * it is the fixed reference the design review was done against — so it maps
 * its own product records onto the image shape the catalogue components take.
 */
export function specimenImage(product: SpecimenProduct, variant: "main" | "hover" = "main"): CatalogImage | null {
  const source = variant === "hover" ? product.hoverImage : product.image;
  if (source === null) return null;
  return {
    ...source,
    alt: variant === "hover" ? `${product.title} by ${product.brand}, second view` : `${product.title} by ${product.brand}`,
  };
}
