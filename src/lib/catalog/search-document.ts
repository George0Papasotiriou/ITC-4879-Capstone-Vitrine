/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Builds the weighted bilingual text a product is found by in search.
 */

import { ABO_PRODUCT_KINDS, CATEGORIES, type CategorySlug } from "@/lib/catalog/taxonomy";
import { normalize } from "@/lib/search/normalize";
import { COLORS, MATERIALS, type LabelledEntry } from "@/lib/search/vocabulary";

/**
 * The text a product is found by (A1, lexical and fuzzy retrieval).
 *
 * Four fields, weighted A to D by the generated `search_tsv` column:
 *
 *   title        A   what the product is called, in every language it has
 *   meta         B   what kind of thing it is, its brand and its category —
 *                    in English and Greek, so "καναπές" finds a sofa whose
 *                    title is still English
 *   attributes   C   colours and materials, as the source names them and as
 *                    canonical labels in both languages
 *   description  D   description and selling points
 *
 * Every field is folded with the same `normalize` the query goes through, so
 * a document and a query can only disagree about spelling, never about accents
 * or letter case. Descriptions are capped: past a few thousand characters,
 * extra text adds index size and noise, not findability.
 */

export type SearchDocumentInput = {
  kind: string;
  category: CategorySlug;
  titleEn: string;
  titleEl?: string | null;
  brand: string | null;
  colorLabel: string | null;
  colors: readonly string[];
  materials: readonly string[];
  attributes?: Readonly<Record<string, string>>;
  descriptionEn?: string | null;
  descriptionEl?: string | null;
  highlightsEn?: readonly string[];
  highlightsEl?: readonly string[] | null;
};

export type SearchDocument = {
  searchTitle: string;
  searchMeta: string;
  searchAttributes: string;
  searchDescription: string;
};

const DESCRIPTION_LIMIT = 4000;

function labels(ids: readonly string[], dictionary: Record<string, LabelledEntry>): string[] {
  return ids.flatMap((id) => {
    const entry = dictionary[id];
    return entry === undefined ? [] : [entry.labelEn, entry.labelEl];
  });
}

const join = (...parts: (string | null | undefined)[]) =>
  normalize(parts.filter((part): part is string => typeof part === "string" && part !== "").join(" "));

export function buildSearchDocument(input: SearchDocumentInput): SearchDocument {
  const kind = ABO_PRODUCT_KINDS[input.kind];
  const category = CATEGORIES.find((candidate) => candidate.slug === input.category);

  const description = join(
    input.descriptionEn,
    ...(input.highlightsEn ?? []),
    input.descriptionEl,
    ...(input.highlightsEl ?? []),
  );

  return {
    searchTitle: join(input.titleEn, input.titleEl),
    searchMeta: join(kind?.kindEn, kind?.kindEl, input.brand, category?.nameEn, category?.nameEl),
    searchAttributes: join(
      input.colorLabel,
      ...labels(input.colors, COLORS),
      ...labels(input.materials, MATERIALS),
      ...Object.values(input.attributes ?? {}),
    ),
    searchDescription:
      description.length <= DESCRIPTION_LIMIT
        ? description
        : description.slice(0, description.lastIndexOf(" ", DESCRIPTION_LIMIT)),
  };
}
