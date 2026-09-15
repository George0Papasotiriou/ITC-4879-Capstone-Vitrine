/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Converts Amazon Berkeley Objects listings into Vitrine product input.
 */

import { z } from "zod";

import {
  ABO_PRODUCT_KINDS,
  stableUnit,
  syntheticPriceCents,
  syntheticStock,
  type CategorySlug,
} from "@/lib/catalog/taxonomy";
import type { DimensionsCm } from "@/lib/db/schema";
import { COLORS, extractTerms, MATERIALS, type ColorId, type MaterialId } from "@/lib/search/vocabulary";

/**
 * Amazon Berkeley Objects listings → Vitrine products (docs/PLAN.md Phase 3).
 *
 * ABO is a research dataset of real Amazon listings (CC BY-NC 4.0): 147,702
 * listings, most with studio photography on white, some with 360° spins and 3D
 * models. It is multilingual and inconsistent — the same field can be missing,
 * duplicated per marketplace, or carry HTML — so every listing goes through
 * this parser, which either returns a clean product draft or says exactly why
 * the listing was rejected. Pure: no network, no database, fully tested.
 */

export const ABO_LICENSE = "CC BY-NC 4.0";
export const ABO_ATTRIBUTION =
  "Product data and photography from the Amazon Berkeley Objects dataset (Collins et al., CVPR 2022), licensed CC BY-NC 4.0.";
export const ABO_BUCKET = "https://amazon-berkeley-objects.s3.amazonaws.com";

const localized = z.array(
  z.object({ language_tag: z.string().optional(), value: z.string(), standardized_values: z.array(z.string()).optional() }),
);
const measure = z.object({ normalized_value: z.object({ unit: z.string(), value: z.number() }).optional() });

/** Only the fields Vitrine reads. Unknown fields are ignored, not rejected. */
export const aboListingSchema = z.object({
  item_id: z.string(),
  marketplace: z.string().optional(),
  product_type: z.array(z.object({ value: z.string() })).min(1),
  item_name: localized,
  brand: localized.optional(),
  bullet_point: localized.optional(),
  product_description: localized.optional(),
  color: localized.optional(),
  material: localized.optional(),
  fabric_type: localized.optional(),
  style: localized.optional(),
  pattern: localized.optional(),
  finish_type: localized.optional(),
  item_shape: localized.optional(),
  item_dimensions: z
    .object({ height: measure.optional(), length: measure.optional(), width: measure.optional() })
    .optional(),
  item_weight: z.array(measure).optional(),
  main_image_id: z.string().optional(),
  other_image_id: z.array(z.string()).optional(),
  spin_id: z.string().optional(),
  "3dmodel_id": z.string().optional(),
});

export type AboListing = z.infer<typeof aboListingSchema>;

export type AboProductDraft = {
  sourceId: string;
  slug: string;
  kind: string;
  category: CategorySlug;
  titleEn: string;
  brand: string | null;
  descriptionEn: string | null;
  highlightsEn: string[];
  colorLabel: string | null;
  colors: ColorId[];
  materials: MaterialId[];
  attributes: Record<string, string>;
  dimsCm: DimensionsCm | null;
  weightGrams: number | null;
  priceCents: number;
  compareAtCents: number | null;
  stock: number;
  mainImageId: string;
  otherImageIds: string[];
  spinId: string | null;
  modelId: string | null;
};

export type RejectionReason =
  | "malformed"
  | "excluded"
  | "not-amazon-marketplace"
  | "product-type-not-sold"
  | "no-english-title"
  | "not-a-product"
  | "title-too-short"
  | "no-main-image";

export type ParseResult = { ok: true; product: AboProductDraft } | { ok: false; reason: RejectionReason };

/* -------------------------------------------------------------------------- */

/** The first value in an English locale (en_US, en_GB, …), trimmed, or undefined. */
export function englishValue(entries: z.infer<typeof localized> | undefined): string | undefined {
  return englishValues(entries)[0];
}

export function englishValues(entries: z.infer<typeof localized> | undefined): string[] {
  return (entries ?? [])
    .filter((entry) => entry.language_tag?.startsWith("en") ?? false)
    .map((entry) => entry.value.trim())
    .filter((value) => value !== "");
}

/**
 * Listings whose photography passes every automatic check but is not a product
 * photograph. Found by looking at the pages, recorded here with the reason, so
 * no future import brings them back. Keep in step with EXCLUDED_ITEMS in
 * scripts/fetch-specimen-images.mjs.
 */
export const EXCLUDED_ABO_ITEMS: ReadonlyMap<string, string> = new Map([
  ["B089LB7TJC", "the only image is the AmazonBasics logo on white"],
]);

/** Fabric swatches, spare parts and replacement covers are not products here. */
const NOT_A_PRODUCT = /\b(swatch|replacement|spare part|slipcovers?|cover only|sample|hardware kit)\b/i;

/**
 * ABO titles are written for marketplace search, not for people:
 *
 *   "Amazon Brand – Rivet Modern Geometric Wool Area Rug, 4 x 6 Foot, Blue, Grey, Brown"
 *   → "Modern Geometric Wool Area Rug"
 *
 * The retailer prefix and the brand go (the brand has its own line), model
 * numbers go, and everything after the first comma or a trailing " - 18 x 12"
 * goes, because that is size and colour, which the page shows elsewhere.
 */
export function cleanTitle(raw: string, brand: string | null): string {
  let title = raw
    .replace(/^Amazon\s*(Brand|Basics|Essentials)?\s*[-–—]\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();

  if (brand !== null && brand !== "") {
    const escaped = brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    title = title.replace(new RegExp(`^${escaped}\\s*[-–—,:]?\\s*`, "i"), "");
  }

  title = title
    // Model numbers and SKU fragments: letters and digits mixed, five or more characters.
    .replace(/\b(?=[A-Z0-9-]*\d)(?=[A-Z0-9-]*[A-Z])[A-Z0-9][A-Z0-9-]{4,}\b/g, "")
    // A trailing dash segment that carries a measurement: " - 18 x 12 x 12 Inches".
    .replace(/\s+[-–—|]\s+[^-–—|]*\d[^-–—|]*$/, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  const comma = title.indexOf(",");
  if (comma > 12) title = title.slice(0, comma);

  title = title.replace(/\s*\([^)]*\)?\s*$/, "");

  if (title.length > 80) {
    // One character past the limit, so a word ending exactly at 80 is kept.
    const cut = title.slice(0, 81);
    title = cut.slice(0, cut.lastIndexOf(" "));
  }

  title = title.replace(/[\s\-–—,:;|/&+]+$/, "").trim();

  // Some listings shout. Capitals are banned by the design system (4.6), and in
  // Greek they strip the accents, so a shouting title is recased.
  const letters = title.replace(/[^A-Za-z]/g, "");
  if (letters.length > 4 && letters === letters.toUpperCase()) {
    title = title.toLowerCase().replace(/\b[a-z]/g, (character) => character.toUpperCase());
  }

  return title.charAt(0).toUpperCase() + title.slice(1);
}

export function cleanBrand(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  const brand = raw.replace(/^Amazon\s*Brand\s*[-–—]?\s*/i, "").trim();
  return brand === "" ? null : brand;
}

/** A URL slug: ASCII words from the title, then the item id, which makes it unique. */
export function productSlug(title: string, itemId: string): string {
  const words = title
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .split("-")
    .slice(0, 8)
    .join("-");
  return `${words}-${itemId.toLowerCase()}`;
}

const INCH_CM = 2.54;
const POUND_GRAMS = 453.59237;

function toCentimetres(value: { normalized_value?: { unit: string; value: number } } | undefined): number | null {
  const normalized = value?.normalized_value;
  if (normalized === undefined) return null;
  const factor = normalized.unit === "inches" ? INCH_CM : normalized.unit === "centimeters" ? 1 : null;
  if (factor === null || !(normalized.value > 0)) return null;
  return normalized.value * factor;
}

/**
 * ABO dimensions are two horizontal measurements ("width" and "length") and a
 * height, in inches. Listings do not agree on which horizontal one is which —
 * one sofa lists 89 inches as its length and 42 as its width, a rug lists the
 * long side as its width — so the longer horizontal measurement is taken as the
 * width (side to side, facing the object) and the shorter as the depth, which
 * is the retail convention for furniture and what room placement (A4) assumes.
 *
 * Stored in whole centimetres, never below 1 (a rug is 0.8 cm thick, not 0),
 * and discarded when implausible for furniture.
 */
export function dimensionsCm(listing: AboListing): DimensionsCm | null {
  const first = toCentimetres(listing.item_dimensions?.width);
  const second = toCentimetres(listing.item_dimensions?.length);
  const h = toCentimetres(listing.item_dimensions?.height);
  if (first === null || second === null || h === null) return null;
  if ([first, second, h].some((value) => value > 600)) return null;
  const round = (value: number) => Math.max(1, Math.round(value));
  return { w: round(Math.max(first, second)), d: round(Math.min(first, second)), h: round(h) };
}

export function weightGrams(listing: AboListing): number | null {
  const normalized = listing.item_weight?.[0]?.normalized_value;
  if (normalized === undefined || !(normalized.value > 0)) return null;
  if (normalized.unit === "pounds") return Math.round(normalized.value * POUND_GRAMS);
  if (normalized.unit === "kilograms") return Math.round(normalized.value * 1000);
  return null;
}

function stripHtml(text: string): string {
  return text
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}

/**
 * Selling points: short, distinct, and not a bare measurement like "4' x 6'".
 * Lines about Amazon's own returns, warranty or Prime are dropped: they are the
 * retailer's promises, not Vitrine's.
 */
const RETAILER_POLICY = /\b(returns?|warranty|amazon|prime)\b/i;

export function highlights(listing: AboListing): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of englishValues(listing.bullet_point)) {
    const text = stripHtml(value).replace(/\s+/g, " ");
    const key = text.toLowerCase();
    if (text.length < 12 || text.length > 320 || seen.has(key) || RETAILER_POLICY.test(text)) continue;
    if (!/[a-z]{3}/i.test(text.replace(/\b(x|ft|in|cm|inch|inches|foot|feet)\b/gi, ""))) continue;
    seen.add(key);
    result.push(text);
    if (result.length === 6) break;
  }
  return result;
}

/**
 * Some products are on sale, so that compare-at pricing has something to show.
 * About one in eight, deterministically, at 15–35% above the price.
 */
function syntheticCompareAt(sourceId: string, priceCents: number): number | null {
  if (stableUnit(`sale:${sourceId}`) >= 0.125) return null;
  const markup = 1.15 + stableUnit(`markup:${sourceId}`) * 0.2;
  const euros = Math.round((priceCents * markup) / 100 / 10) * 10 - 1;
  return euros * 100 > priceCents ? euros * 100 : null;
}

export function parseAboListing(raw: unknown): ParseResult {
  const parsed = aboListingSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: "malformed" };
  const listing = parsed.data;
  if (EXCLUDED_ABO_ITEMS.has(listing.item_id)) return { ok: false, reason: "excluded" };

  // Whole Foods, Amazon Fresh and the like are groceries.
  if (listing.marketplace !== undefined && listing.marketplace !== "Amazon") {
    return { ok: false, reason: "not-amazon-marketplace" };
  }

  const kind = listing.product_type[0]!.value;
  const productKind = ABO_PRODUCT_KINDS[kind];
  if (productKind === undefined) return { ok: false, reason: "product-type-not-sold" };

  const rawTitle = englishValue(listing.item_name);
  if (rawTitle === undefined) return { ok: false, reason: "no-english-title" };
  if (NOT_A_PRODUCT.test(rawTitle)) return { ok: false, reason: "not-a-product" };

  const brand = cleanBrand(englishValue(listing.brand));
  const titleEn = cleanTitle(rawTitle, brand);
  if (titleEn.length < 8) return { ok: false, reason: "title-too-short" };

  if (listing.main_image_id === undefined) return { ok: false, reason: "no-main-image" };

  const colorValues = (listing.color ?? []).filter((entry) => entry.language_tag?.startsWith("en") ?? false);
  const colorLabel = colorValues[0]?.value.trim() || null;
  const colorText = colorValues.flatMap((entry) => [entry.value, ...(entry.standardized_values ?? [])]).join(" ");
  // The listing's colour field is authoritative; the title is a fallback,
  // because titles also name the colours of other parts ("black metal legs").
  const colors = extractTerms(colorText, COLORS, { greeklish: false });
  const materialText = [
    ...englishValues(listing.material),
    ...englishValues(listing.fabric_type),
    ...englishValues(listing.finish_type),
  ].join(" ");
  const materials = extractTerms(`${materialText} ${titleEn}`, MATERIALS, { greeklish: false });

  const attributes: Record<string, string> = {};
  for (const [key, entries] of [
    ["style", listing.style],
    ["pattern", listing.pattern],
    ["finish", listing.finish_type],
    ["shape", listing.item_shape],
    ["material", listing.material],
    ["fabric", listing.fabric_type],
  ] as const) {
    const value = englishValue(entries);
    if (value !== undefined && value.length <= 80) attributes[key] = value;
  }

  const descriptionRaw = englishValue(listing.product_description);
  const priceCents = syntheticPriceCents(listing.item_id, productKind.bands);

  return {
    ok: true,
    product: {
      sourceId: listing.item_id,
      slug: productSlug(titleEn, listing.item_id),
      kind,
      category: productKind.category,
      titleEn,
      brand,
      descriptionEn: descriptionRaw === undefined ? null : stripHtml(descriptionRaw).slice(0, 4000) || null,
      highlightsEn: highlights(listing),
      colorLabel,
      colors: colors.length > 0 ? colors : extractTerms(titleEn, COLORS, { greeklish: false }),
      materials,
      attributes,
      dimsCm: dimensionsCm(listing),
      weightGrams: weightGrams(listing),
      priceCents,
      compareAtCents: syntheticCompareAt(listing.item_id, priceCents),
      stock: syntheticStock(listing.item_id, productKind.bands),
      mainImageId: listing.main_image_id,
      otherImageIds: listing.other_image_id ?? [],
      spinId: listing.spin_id ?? null,
      modelId: listing["3dmodel_id"] ?? null,
    },
  };
}
