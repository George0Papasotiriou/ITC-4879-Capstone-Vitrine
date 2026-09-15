/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Builds product content vectors from structured catalogue data.
 */

import { stableUnit } from "@/lib/catalog/taxonomy";
import { tokenize } from "@/lib/search/normalize";
import { COLORS, MATERIALS } from "@/lib/search/vocabulary";

/**
 * Content vectors: what a product is, as numbers (A2 content edges, A3 style).
 *
 * The plan's content signal is a product embedding from a multimodal model.
 * Embeddings cost money and do not exist yet, so this module builds an honest
 * stand-in from the catalogue's own structured data, and every consumer takes
 * a vector without caring where it came from. When embeddings arrive they
 * replace these vectors; nothing else changes.
 *
 * A vector is a concatenation of blocks, each L2-normalised and then scaled by
 * its weight, and the whole is normalised again, so that the cosine of two
 * vectors is a weighted blend of per-block agreement:
 *
 *   category   one-hot over the eight categories
 *   kind       the ABO product type, hashed into 16 buckets
 *   colours    one-hot over the canonical colours
 *   materials  one-hot over the canonical materials
 *   style      words from the style, pattern, finish and shape attributes,
 *              hashed into 32 buckets (the "feature hashing" trick: a fixed-size
 *              vector for an open vocabulary, at the cost of rare collisions)
 *   brand      hashed into 16 buckets
 *   price      the price level as a point on a quarter circle: θ = level·π/2
 *              with level = log₁₀(euros)/4 clamped to [0, 1], stored as
 *              (cos θ, sin θ). The dot product of two such points is cos(Δθ),
 *              so similarity falls smoothly as prices move apart on a log scale
 *              — €80 and €120 are close, €80 and €1,200 are not.
 *
 * Two weightings are used. `similarity` (A2: "more like this") weights what the
 * object is — category and kind — heavily. `style` (A3: "goes with this")
 * leaves category and kind out entirely, because a sofa and a rug are never
 * the same kind of thing and should be judged only on colour, material, style,
 * brand and price level.
 */

export type ProductFeatures = {
  category: string;
  kind: string;
  colors: readonly string[];
  materials: readonly string[];
  brand: string | null;
  attributes: Readonly<Record<string, string>>;
  priceCents: number;
};

export type BlockWeights = {
  category: number;
  kind: number;
  colors: number;
  materials: number;
  style: number;
  brand: number;
  price: number;
};

export const SIMILARITY_WEIGHTS: BlockWeights = { category: 1, kind: 1.5, colors: 0.6, materials: 0.8, style: 0.6, brand: 0.4, price: 0.5 };
export const STYLE_WEIGHTS: BlockWeights = { category: 0, kind: 0, colors: 0.7, materials: 1, style: 0.9, brand: 0.5, price: 0.6 };

const CATEGORY_IDS = ["seating", "tables", "lighting", "rugs", "storage", "bedroom", "wall-decor", "accents"];
const COLOR_IDS = Object.keys(COLORS);
const MATERIAL_IDS = Object.keys(MATERIALS);
const STYLE_ATTRIBUTES = ["style", "pattern", "finish", "shape"];

const KIND_BUCKETS = 16;
const STYLE_BUCKETS = 32;
const BRAND_BUCKETS = 16;

export const VECTOR_LENGTH =
  CATEGORY_IDS.length + KIND_BUCKETS + COLOR_IDS.length + MATERIAL_IDS.length + STYLE_BUCKETS + BRAND_BUCKETS + 2;

function bucket(value: string, buckets: number, salt: string): number {
  return Math.floor(stableUnit(`${salt}:${value}`) * buckets);
}

function normaliseInPlace(values: Float64Array, weight: number): void {
  let norm = 0;
  for (const value of values) norm += value * value;
  if (norm === 0) return;
  const scale = weight / Math.sqrt(norm);
  for (let i = 0; i < values.length; i += 1) values[i]! *= scale;
}

export function contentVector(product: ProductFeatures, weights: BlockWeights): Float64Array {
  const blocks: Float64Array[] = [];

  const category = new Float64Array(CATEGORY_IDS.length);
  const categoryIndex = CATEGORY_IDS.indexOf(product.category);
  if (categoryIndex >= 0) category[categoryIndex] = 1;
  blocks.push(category);

  const kind = new Float64Array(KIND_BUCKETS);
  kind[bucket(product.kind, KIND_BUCKETS, "kind")] = 1;
  blocks.push(kind);

  const colors = new Float64Array(COLOR_IDS.length);
  for (const id of product.colors) {
    const index = COLOR_IDS.indexOf(id);
    if (index >= 0) colors[index] = 1;
  }
  blocks.push(colors);

  const materials = new Float64Array(MATERIAL_IDS.length);
  for (const id of product.materials) {
    const index = MATERIAL_IDS.indexOf(id);
    if (index >= 0) materials[index] = 1;
  }
  blocks.push(materials);

  const style = new Float64Array(STYLE_BUCKETS);
  for (const key of STYLE_ATTRIBUTES) {
    const value = product.attributes[key];
    if (value === undefined) continue;
    for (const word of tokenize(value)) if (word.length >= 3) style[bucket(word, STYLE_BUCKETS, "style")]! += 1;
  }
  blocks.push(style);

  const brand = new Float64Array(BRAND_BUCKETS);
  if (product.brand !== null) brand[bucket(product.brand.toLowerCase(), BRAND_BUCKETS, "brand")] = 1;
  blocks.push(brand);

  const level = Math.min(1, Math.max(0, Math.log10(Math.max(1, product.priceCents / 100)) / 4));
  const theta = (level * Math.PI) / 2;
  blocks.push(Float64Array.of(Math.cos(theta), Math.sin(theta)));

  const blockWeights = [weights.category, weights.kind, weights.colors, weights.materials, weights.style, weights.brand, weights.price];
  blocks.forEach((block, index) => normaliseInPlace(block, blockWeights[index]!));

  const vector = new Float64Array(VECTOR_LENGTH);
  let offset = 0;
  for (const block of blocks) {
    vector.set(block, offset);
    offset += block.length;
  }
  normaliseInPlace(vector, 1);
  return vector;
}

/** Cosine of two already-normalised vectors: their dot product. */
export function dot(a: Float64Array | readonly number[], b: Float64Array | readonly number[]): number {
  if (a.length !== b.length) throw new RangeError(`Vector lengths differ: ${a.length} and ${b.length}`);
  let total = 0;
  for (let i = 0; i < a.length; i += 1) total += a[i]! * b[i]!;
  return total;
}
