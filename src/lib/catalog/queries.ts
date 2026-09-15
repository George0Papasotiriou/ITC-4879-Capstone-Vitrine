/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Catalogue database reads: listings, product details, cards and categories.
 */

import type postgres from "postgres";

import type { ListingState } from "@/lib/catalog/listing";
import { ABO_PRODUCT_KINDS, ROOM_PLACEMENT } from "@/lib/catalog/taxonomy";
import { money, type Money } from "@/lib/commerce/money";
import type { DimensionsCm } from "@/lib/db/schema";

/**
 * Catalogue reads (docs/PLAN.md Phase 3).
 *
 * Written against the postgres.js client rather than a framework, so the same
 * functions serve pages, route handlers, the Concierge's tools and the
 * integration tests. Everything a component shows comes from here: prices and
 * stock are read from the database on every request and never computed in the
 * browser or by a model (CLAUDE.md golden rule 5).
 *
 * Arrays are passed as `${values}::text[]`, the form proven identical on PGlite
 * and PostgreSQL (tests/integration/sql-arrays.test.ts, ADR-008).
 */

type Sql = postgres.Sql;

export type CatalogImage = { src: string; width: number; height: number; alt: string };

export type ProductCard = {
  id: string;
  slug: string;
  title: string;
  /** The ABO product type ("SOFA"), for logic; never shown. */
  kind: string;
  /** "Sofa" / "Καναπές": what kind of object it is, in the page language. */
  kindLabel: string | null;
  brand: string | null;
  category: string;
  price: Money;
  compareAt: Money | null;
  inStock: boolean;
  image: CatalogImage | null;
  /** A second angle for the hover swap, only when it also sits on white. */
  hoverImage: CatalogImage | null;
};

export type ProductDetail = ProductCard & {
  categoryName: string;
  description: string | null;
  highlights: string[];
  colorLabel: string | null;
  colors: string[];
  materials: string[];
  attributes: Record<string, string>;
  dimsCm: DimensionsCm | null;
  weightGrams: number | null;
  stock: number;
  media: CatalogImage[];
  ratingSum: number;
  ratingCount: number;
  attribution: string;
  /** False when the Greek page is showing English copy because no translation exists yet. */
  translated: boolean;
  updatedAt: Date;
};

export type CategorySummary = { slug: string; name: string; description: string | null; productCount: number };

export type FacetValue = { value: string; label: string; count: number };

export type Listing = {
  products: ProductCard[];
  total: number;
  pageCount: number;
  facets: {
    colors: FacetValue[];
    materials: FacetValue[];
    brands: FacetValue[];
    price: { minCents: number; maxCents: number } | null;
  };
};

type ImageRow = { src: string; width: number | null; height: number | null; altEn: string; altEl: string | null; whiteGround: boolean };

type CardRow = {
  id: string;
  slug: string;
  title_en: string;
  title_el: string | null;
  kind: string;
  brand: string | null;
  category: string;
  price_cents: number;
  compare_at_cents: number | null;
  currency: string;
  stock: number;
  images: ImageRow[] | null;
};

function image(row: ImageRow | undefined, locale: string): CatalogImage | null {
  if (row === undefined) return null;
  return {
    src: row.src,
    width: row.width ?? 1100,
    height: row.height ?? 1100,
    alt: locale === "el" ? (row.altEl ?? row.altEn) : row.altEn,
  };
}

function toCard(row: CardRow, locale: string): ProductCard {
  const kind = ABO_PRODUCT_KINDS[row.kind];
  const images = row.images ?? [];
  const second = images[1];
  return {
    id: row.id,
    slug: row.slug,
    title: locale === "el" ? (row.title_el ?? row.title_en) : row.title_en,
    kind: row.kind,
    kindLabel: kind === undefined ? null : locale === "el" ? kind.kindEl : kind.kindEn,
    brand: row.brand,
    category: row.category,
    price: money(row.price_cents, row.currency),
    compareAt: row.compare_at_cents === null ? null : money(row.compare_at_cents, row.currency),
    inStock: row.stock > 0,
    image: image(images[0], locale),
    hoverImage: second?.whiteGround === true ? image(second, locale) : null,
  };
}

export function createCatalogQueries(sql: Sql) {
  /** Columns every card needs: two images, summed stock, brand and category. */
  const cardColumns = sql`
    p.id, p.slug, p.title_en, p.title_el, p.kind, p.price_cents, p.compare_at_cents, p.currency,
    c.slug AS category, b.name AS brand,
    COALESCE((SELECT sum(v.stock) FROM product_variants v WHERE v.product_id = p.id), 0)::int AS stock,
    (
      SELECT json_agg(json_build_object(
        'src', m.src, 'width', m.width, 'height', m.height,
        'altEn', m.alt_en, 'altEl', m.alt_el, 'whiteGround', m.white_ground
      ) ORDER BY m.position)
      FROM (
        SELECT * FROM product_media m
        WHERE m.product_id = p.id AND m.kind = 'image'
        ORDER BY m.position
        LIMIT 2
      ) m
    ) AS images
  `;

  const fromProducts = sql`
    FROM products p
    JOIN categories c ON c.id = p.category_id
    LEFT JOIN brands b ON b.id = p.brand_id
  `;

  const inStockCondition = sql`EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id AND v.stock > 0)`;

  type Facet = "colors" | "materials" | "brands";

  /** WHERE conditions for a listing, optionally leaving one facet out (for that facet's counts). */
  function conditions(category: string | null, state: ListingState, except?: Facet) {
    const parts = [sql`p.status = 'active'`];
    if (category !== null) parts.push(sql`c.slug = ${category}`);
    if (except !== "colors" && state.colors.length > 0) parts.push(sql`p.colors && ${state.colors}::text[]`);
    if (except !== "materials" && state.materials.length > 0) parts.push(sql`p.materials && ${state.materials}::text[]`);
    if (except !== "brands" && state.brands.length > 0) parts.push(sql`b.slug = ANY(${state.brands}::text[])`);
    if (state.minCents !== null) parts.push(sql`p.price_cents >= ${state.minCents}`);
    if (state.maxCents !== null) parts.push(sql`p.price_cents <= ${state.maxCents}`);
    if (state.inStock) parts.push(inStockCondition);
    return parts.reduce((all, part) => sql`${all} AND ${part}`);
  }

  function order(state: ListingState) {
    switch (state.sort) {
      case "price-asc":
        return sql`p.price_cents ASC, p.id`;
      case "price-desc":
        return sql`p.price_cents DESC, p.id`;
      case "newest":
        return sql`p.created_at DESC, p.id DESC`;
      default:
        // Featured: available first, then demand, then a stable order.
        return sql`(${inStockCondition}) DESC, p.popularity DESC, p.source_id`;
    }
  }

  async function listProducts(params: {
    category: string | null;
    state: ListingState;
    locale: string;
    pageSize: number;
    labels: { color: (id: string) => string; material: (id: string) => string };
  }): Promise<Listing> {
    const { category, state, locale, pageSize } = params;
    const offset = (state.page - 1) * pageSize;

    const [rows, colors, materials, brands, price] = await Promise.all([
      sql<(CardRow & { total: number })[]>`
        SELECT ${cardColumns}, count(*) OVER ()::int AS total
        ${fromProducts}
        WHERE ${conditions(category, state)}
        ORDER BY ${order(state)}
        LIMIT ${pageSize} OFFSET ${offset}
      `,
      sql<{ value: string; count: number }[]>`
        SELECT value, count(*)::int AS count
        ${fromProducts}, unnest(p.colors) AS value
        WHERE ${conditions(category, state, "colors")}
        GROUP BY value ORDER BY count DESC, value
      `,
      sql<{ value: string; count: number }[]>`
        SELECT value, count(*)::int AS count
        ${fromProducts}, unnest(p.materials) AS value
        WHERE ${conditions(category, state, "materials")}
        GROUP BY value ORDER BY count DESC, value
      `,
      sql<{ value: string; label: string; count: number }[]>`
        SELECT b.slug AS value, b.name AS label, count(*)::int AS count
        ${fromProducts}
        WHERE ${conditions(category, state, "brands")} AND b.id IS NOT NULL
        GROUP BY b.slug, b.name ORDER BY count DESC, b.name
        LIMIT 30
      `,
      sql<{ min: number | null; max: number | null }[]>`
        SELECT min(p.price_cents)::int AS min, max(p.price_cents)::int AS max
        ${fromProducts}
        WHERE p.status = 'active' ${category === null ? sql`` : sql`AND c.slug = ${category}`}
      `,
    ]);

    // A page past the end (after a filter narrowed the results) reports the
    // real total, so the page can offer a way back.
    let total = rows[0]?.total ?? 0;
    if (rows.length === 0 && state.page > 1) {
      const [row] = await sql<{ total: number }[]>`
        SELECT count(*)::int AS total ${fromProducts} WHERE ${conditions(category, state)}
      `;
      total = row?.total ?? 0;
    }

    const bounds = price[0];
    return {
      products: rows.map((row) => toCard(row, locale)),
      total,
      pageCount: Math.max(1, Math.ceil(total / pageSize)),
      facets: {
        colors: colors.map((row) => ({ ...row, label: params.labels.color(row.value) })),
        materials: materials.map((row) => ({ ...row, label: params.labels.material(row.value) })),
        brands,
        price: bounds?.min == null || bounds.max == null ? null : { minCents: bounds.min, maxCents: bounds.max },
      },
    };
  }

  async function listCategories(locale: string): Promise<CategorySummary[]> {
    const rows = await sql<{ slug: string; name_en: string; name_el: string; description_en: string | null; description_el: string | null; count: number }[]>`
      SELECT c.slug, c.name_en, c.name_el, c.description_en, c.description_el,
             count(p.id) FILTER (WHERE p.status = 'active')::int AS count
      FROM categories c
      LEFT JOIN products p ON p.category_id = c.id
      GROUP BY c.id
      ORDER BY c.position, c.slug
    `;
    return rows.map((row) => ({
      slug: row.slug,
      name: locale === "el" ? row.name_el : row.name_en,
      description: locale === "el" ? row.description_el : row.description_en,
      productCount: row.count,
    }));
  }

  async function featured(params: { locale: string; limit: number; category?: string; excludeIds?: string[] }): Promise<ProductCard[]> {
    const exclude = params.excludeIds ?? [];
    const rows = await sql<CardRow[]>`
      SELECT ${cardColumns}
      ${fromProducts}
      WHERE p.status = 'active'
        ${params.category === undefined ? sql`` : sql`AND c.slug = ${params.category}`}
        AND NOT (p.id = ANY(${exclude}::uuid[]))
      ORDER BY (${inStockCondition}) DESC, p.popularity DESC, p.source_id
      LIMIT ${params.limit}
    `;
    return rows.map((row) => toCard(row, params.locale));
  }

  /** Products that can be shown in a room photo: known dimensions and a kind that stands or lies on the floor. */
  async function placeable(params: { locale: string; limit: number }): Promise<ProductCard[]> {
    const kinds = Object.keys(ROOM_PLACEMENT);
    const rows = await sql<CardRow[]>`
      SELECT ${cardColumns}
      ${fromProducts}
      WHERE p.status = 'active'
        AND p.dims_cm IS NOT NULL
        AND p.kind = ANY(${kinds}::text[])
      ORDER BY (${inStockCondition}) DESC, p.popularity DESC, p.source_id
      LIMIT ${params.limit}
    `;
    return rows.map((row) => toCard(row, params.locale));
  }

  /** Cards for ids in the caller's order (search results, recommendations). */
  async function cardsByIds(ids: readonly string[], locale: string): Promise<ProductCard[]> {
    if (ids.length === 0) return [];
    const rows = await sql<CardRow[]>`
      SELECT ${cardColumns}
      FROM unnest(${[...ids]}::uuid[]) WITH ORDINALITY AS wanted(id, position)
      JOIN products p ON p.id = wanted.id
      JOIN categories c ON c.id = p.category_id
      LEFT JOIN brands b ON b.id = p.brand_id
      WHERE p.status = 'active'
      ORDER BY wanted.position
    `;
    return rows.map((row) => toCard(row, locale));
  }

  async function productBySlug(slug: string, locale: string): Promise<ProductDetail | null> {
    type DetailRow = CardRow & {
      category_name_en: string;
      category_name_el: string;
      description_en: string | null;
      description_el: string | null;
      highlights_en: string[];
      highlights_el: string[] | null;
      color_label: string | null;
      colors: string[];
      materials: string[];
      attributes: Record<string, string>;
      dims_cm: DimensionsCm | null;
      weight_grams: number | null;
      rating_sum: number;
      rating_count: number;
      attribution: string;
      translation: "none" | "machine" | "reviewed";
      updated_at: Date;
      all_images: ImageRow[] | null;
    };

    const [row] = await sql<DetailRow[]>`
      SELECT ${cardColumns},
        c.name_en AS category_name_en, c.name_el AS category_name_el,
        p.description_en, p.description_el, p.highlights_en, p.highlights_el,
        p.color_label, p.colors, p.materials, p.attributes, p.dims_cm, p.weight_grams,
        p.rating_sum, p.rating_count, p.attribution, p.translation, p.updated_at,
        (
          SELECT json_agg(json_build_object(
            'src', m.src, 'width', m.width, 'height', m.height,
            'altEn', m.alt_en, 'altEl', m.alt_el, 'whiteGround', m.white_ground
          ) ORDER BY m.position)
          FROM product_media m WHERE m.product_id = p.id AND m.kind = 'image'
        ) AS all_images
      ${fromProducts}
      WHERE p.slug = ${slug} AND p.status = 'active'
    `;
    if (row === undefined) return null;

    const greek = locale === "el";
    const hasGreek = row.translation !== "none" && row.title_el !== null;
    return {
      ...toCard(row, locale),
      categoryName: greek ? row.category_name_el : row.category_name_en,
      description: greek ? (row.description_el ?? row.description_en) : row.description_en,
      highlights: greek ? (row.highlights_el ?? row.highlights_en) : row.highlights_en,
      colorLabel: row.color_label,
      colors: row.colors,
      materials: row.materials,
      attributes: row.attributes,
      dimsCm: row.dims_cm,
      weightGrams: row.weight_grams,
      stock: row.stock,
      media: (row.all_images ?? []).map((media) => image(media, locale)!),
      ratingSum: row.rating_sum,
      ratingCount: row.rating_count,
      attribution: row.attribution,
      translated: !greek || hasGreek,
      updatedAt: new Date(row.updated_at),
    };
  }

  async function allProductSlugs(): Promise<{ slug: string; updatedAt: Date }[]> {
    const rows = await sql<{ slug: string; updated_at: Date }[]>`
      SELECT slug, updated_at FROM products WHERE status = 'active' ORDER BY slug
    `;
    return rows.map((row) => ({ slug: row.slug, updatedAt: new Date(row.updated_at) }));
  }

  return { listProducts, listCategories, featured, placeable, cardsByIds, productBySlug, allProductSlugs };
}

export type CatalogQueries = ReturnType<typeof createCatalogQueries>;
