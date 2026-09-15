/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Validated product input format shared by every catalogue source.
 */

import { z } from "zod";

import { CATEGORY_SLUGS, type CategorySlug } from "@/lib/catalog/taxonomy";

/**
 * The shape every catalogue source is converted to before it is written: the
 * ABO importer, the specimen fixture the tests run on, and later the fashion
 * capsule. One validated format means one writer, and a fixture file that is
 * checked exactly like live input.
 */

const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const cents = z.number().int().nonnegative();

export const mediaInputSchema = z.object({
  kind: z.enum(["image", "spin", "model", "video"]),
  /** An application path: `/media/<storage key>` or `/products/<file>`. */
  src: z.string().regex(/^\/(media|products)\/[A-Za-z0-9/_.-]+$/),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  bytes: z.number().int().positive().nullable(),
  altEn: z.string().min(1),
  whiteGround: z.boolean(),
});

export const productInputSchema = z
  .object({
    source: z.enum(["abo", "capsule"]),
    sourceId: z.string().min(1).max(64),
    slug,
    kind: z.string().regex(/^[A-Z_]+$/),
    category: z.enum(CATEGORY_SLUGS as [CategorySlug, ...CategorySlug[]]),
    titleEn: z.string().min(1).max(160),
    titleEl: z.string().min(1).max(160).nullable(),
    brand: z.string().min(1).max(80).nullable(),
    descriptionEn: z.string().nullable(),
    descriptionEl: z.string().nullable(),
    highlightsEn: z.array(z.string()).max(12),
    highlightsEl: z.array(z.string()).max(12).nullable(),
    translation: z.enum(["none", "machine", "reviewed"]),
    colorLabel: z.string().nullable(),
    colors: z.array(z.string()),
    materials: z.array(z.string()),
    attributes: z.record(z.string(), z.string()),
    dimsCm: z.object({ w: z.number().int().positive(), d: z.number().int().positive(), h: z.number().int().positive() }).nullable(),
    weightGrams: z.number().int().positive().nullable(),
    priceCents: cents,
    compareAtCents: cents.nullable(),
    stock: z.number().int().nonnegative(),
    license: z.string().min(1),
    attribution: z.string().min(1),
    media: z.array(mediaInputSchema).min(1),
  })
  .refine((product) => product.compareAtCents === null || product.compareAtCents > product.priceCents, {
    message: "compareAtCents must be above priceCents",
    path: ["compareAtCents"],
  })
  .refine((product) => product.media.some((media) => media.kind === "image"), {
    message: "a product needs at least one image",
    path: ["media"],
  });

export const catalogFixtureSchema = z.object({
  version: z.literal(1),
  description: z.string(),
  products: z.array(productInputSchema),
});

export type MediaInput = z.infer<typeof mediaInputSchema>;
export type ProductInput = z.infer<typeof productInputSchema>;
export type CatalogFixture = z.infer<typeof catalogFixtureSchema>;
