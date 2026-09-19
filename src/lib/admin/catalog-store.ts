/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Catalogue editing in the database: the staff product list, one product's editable fields, and audited edits and stock changes.
 */

import type postgres from "postgres";

import { diffFields, recordAudit, type AuditActor } from "@/lib/admin/audit";
import { LOW_STOCK, type ProductDetails } from "@/lib/admin/catalog";
import { buildSearchDocument } from "@/lib/catalog/search-document";
import { isCategorySlug, type CategorySlug } from "@/lib/catalog/taxonomy";

/**
 * Staff edits (docs/adr/018). Every write locks the row, compares, writes the
 * change and its audit entry in one transaction, and marks the product as
 * edited so the deploy's catalogue sync leaves it alone. Editing the words
 * also rebuilds the product's search text, so search finds the new title at
 * once. Stock is set to the counted number with a reason; orders keep moving
 * it as before.
 */

type Sql = postgres.Sql;

export type ProductStatus = "draft" | "active" | "archived";

export type StaffProductRow = {
  id: string;
  slug: string;
  titleEn: string;
  titleEl: string | null;
  category: string;
  status: ProductStatus;
  priceCents: number;
  stock: number;
  skus: string[];
  image: string | null;
  staffEditedAt: Date | null;
};

export type StaffProduct = {
  id: string;
  slug: string;
  source: string;
  kind: string;
  category: CategorySlug;
  brand: string | null;
  titleEn: string;
  titleEl: string | null;
  descriptionEn: string | null;
  descriptionEl: string | null;
  highlightsEn: string[];
  highlightsEl: string[] | null;
  priceCents: number;
  compareAtCents: number | null;
  status: ProductStatus;
  translation: "none" | "machine" | "reviewed";
  staffEditedAt: Date | null;
  image: string | null;
  variants: { id: string; sku: string; colorLabel: string | null; stock: number }[];
};

export type ProductListQuery = {
  query?: string | null;
  category?: string | null;
  status?: ProductStatus | null;
  lowStock?: boolean;
  limit?: number;
  offset?: number;
};

const BACKSLASH = String.fromCharCode(92);
/** "%oak%" for ILIKE, with a typed % or _ meaning itself rather than a wildcard. */
const containing = (text: string) => `%${[...text].map((character) => (character === "%" || character === "_" || character === BACKSLASH ? BACKSLASH + character : character)).join("")}%`;

const FIRST_IMAGE = (sql: Sql) =>
  sql`(SELECT m.src FROM product_media m WHERE m.product_id = p.id AND m.kind = 'image' ORDER BY m.position LIMIT 1)`;

export function createCatalogAdminStore(sql: Sql) {
  /** Staff's product list: newest edits first, then by title; filterable, searchable by title or SKU. */
  async function listProducts({ query = null, category = null, status = null, lowStock = false, limit = 50, offset = 0 }: ProductListQuery = {}) {
    const term = query === null || query.trim() === "" ? null : containing(query.trim());
    const conditions = [
      term === null ? sql`TRUE` : sql`(p.title_en ILIKE ${term} OR p.title_el ILIKE ${term} OR EXISTS (SELECT 1 FROM product_variants s WHERE s.product_id = p.id AND s.sku ILIKE ${term}))`,
      category === null ? sql`TRUE` : sql`c.slug = ${category}`,
      status === null ? sql`TRUE` : sql`p.status = ${status}`,
      lowStock ? sql`p.status = 'active' AND v.stock <= ${LOW_STOCK}` : sql`TRUE`,
    ];
    const where = conditions.reduce((all, condition) => sql`${all} AND ${condition}`);
    const rows = await sql<{
      id: string;
      slug: string;
      title_en: string;
      title_el: string | null;
      category: string;
      status: ProductStatus;
      price_cents: number;
      stock: number;
      skus: string[];
      image: string | null;
      staff_edited_at: Date | null;
      total: number;
    }[]>`
      SELECT p.id, p.slug, p.title_en, p.title_el, c.slug AS category, p.status, p.price_cents,
             v.stock, v.skus, ${FIRST_IMAGE(sql)} AS image, p.staff_edited_at, count(*) OVER ()::int AS total
      FROM products p
      JOIN categories c ON c.id = p.category_id
      JOIN LATERAL (
        SELECT COALESCE(sum(stock), 0)::int AS stock, array_agg(sku ORDER BY position, sku) AS skus
        FROM product_variants WHERE product_id = p.id
      ) v ON TRUE
      WHERE ${where}
      ORDER BY ${lowStock ? sql`v.stock ASC,` : sql``} p.staff_edited_at DESC NULLS LAST, p.title_en ASC, p.id
      LIMIT ${limit} OFFSET ${offset}
    `;
    return {
      total: rows[0]?.total ?? 0,
      rows: rows.map(
        (row): StaffProductRow => ({
          id: row.id,
          slug: row.slug,
          titleEn: row.title_en,
          titleEl: row.title_el,
          category: row.category,
          status: row.status,
          priceCents: row.price_cents,
          stock: row.stock,
          skus: row.skus ?? [],
          image: row.image,
          staffEditedAt: row.staff_edited_at === null ? null : new Date(row.staff_edited_at),
        }),
      ),
    };
  }

  async function readProduct(id: string, db: Sql | postgres.TransactionSql = sql, { lock = false } = {}): Promise<StaffProduct | null> {
    const [row] = await db<{
      id: string;
      slug: string;
      source: string;
      kind: string;
      category: string;
      brand: string | null;
      title_en: string;
      title_el: string | null;
      description_en: string | null;
      description_el: string | null;
      highlights_en: string[];
      highlights_el: string[] | null;
      price_cents: number;
      compare_at_cents: number | null;
      status: ProductStatus;
      translation: StaffProduct["translation"];
      staff_edited_at: Date | null;
      image: string | null;
    }[]>`
      SELECT p.id, p.slug, p.source, p.kind, c.slug AS category, b.name AS brand, p.title_en, p.title_el,
             p.description_en, p.description_el, p.highlights_en, p.highlights_el, p.price_cents, p.compare_at_cents,
             p.status, p.translation, p.staff_edited_at, ${FIRST_IMAGE(db as Sql)} AS image
      FROM products p JOIN categories c ON c.id = p.category_id LEFT JOIN brands b ON b.id = p.brand_id
      WHERE p.id = ${id}
      ${lock ? db`FOR UPDATE OF p` : db``}
    `;
    if (row === undefined || !isCategorySlug(row.category)) return null;
    const variants = await db<{ id: string; sku: string; color_label: string | null; stock: number }[]>`
      SELECT id, sku, color_label, stock FROM product_variants WHERE product_id = ${id} ORDER BY position, sku
    `;
    return {
      id: row.id,
      slug: row.slug,
      source: row.source,
      kind: row.kind,
      category: row.category,
      brand: row.brand,
      titleEn: row.title_en,
      titleEl: row.title_el,
      descriptionEn: row.description_en,
      descriptionEl: row.description_el,
      highlightsEn: row.highlights_en,
      highlightsEl: row.highlights_el,
      priceCents: row.price_cents,
      compareAtCents: row.compare_at_cents,
      status: row.status,
      translation: row.translation,
      staffEditedAt: row.staff_edited_at === null ? null : new Date(row.staff_edited_at),
      image: row.image,
      variants: variants.map((variant) => ({ id: variant.id, sku: variant.sku, colorLabel: variant.color_label, stock: variant.stock })),
    };
  }

  /**
   * Saves an edit. Returns the fields that changed; an edit that changes
   * nothing writes nothing, not even the audit entry or the edited mark.
   */
  async function updateProduct(id: string, details: ProductDetails, actor: AuditActor, now = new Date()) {
    return sql.begin(async (tx) => {
      const current = await readProduct(id, tx, { lock: true });
      if (current === null) return { ok: false, reason: "not_found" } as const;

      const touchedGreek = details.titleEl !== current.titleEl || details.descriptionEl !== current.descriptionEl || JSON.stringify(details.highlightsEl) !== JSON.stringify(current.highlightsEl);
      // Greek text a person wrote or checked is reviewed, whatever produced it first.
      const translation = touchedGreek && (details.titleEl !== null || details.descriptionEl !== null) ? "reviewed" : current.translation;
      const changes = diffFields<Record<string, unknown>>({ ...current }, { ...details, translation });
      const fields = Object.keys(changes);
      if (fields.length === 0) return { ok: true, changed: [] as string[] } as const;

      const [attributes] = await tx<{ color_label: string | null; colors: string[]; materials: string[]; attributes: Record<string, string> }[]>`
        SELECT color_label, colors, materials, attributes FROM products WHERE id = ${id}
      `;
      const search = buildSearchDocument({
        kind: current.kind,
        category: current.category,
        brand: current.brand,
        colorLabel: attributes!.color_label,
        colors: attributes!.colors,
        materials: attributes!.materials,
        attributes: attributes!.attributes,
        titleEn: details.titleEn,
        titleEl: details.titleEl,
        descriptionEn: details.descriptionEn,
        descriptionEl: details.descriptionEl,
        highlightsEn: details.highlightsEn,
        highlightsEl: details.highlightsEl,
      });
      const at = now.toISOString();
      await tx`
        UPDATE products SET
          title_en = ${details.titleEn}, title_el = ${details.titleEl},
          description_en = ${details.descriptionEn}, description_el = ${details.descriptionEl},
          highlights_en = ${details.highlightsEn}::text[], highlights_el = ${details.highlightsEl}::text[],
          price_cents = ${details.priceCents}, compare_at_cents = ${details.compareAtCents},
          status = ${details.status}, translation = ${translation},
          search_title = ${search.searchTitle}, search_meta = ${search.searchMeta},
          search_attributes = ${search.searchAttributes}, search_description = ${search.searchDescription},
          staff_edited_at = ${at}::timestamptz, updated_at = ${at}::timestamptz
        WHERE id = ${id}
      `;
      await recordAudit(tx, { actor, action: "product.update", entityType: "product", entityId: id, changes }, now);
      return { ok: true, changed: fields } as const;
    });
  }

  /** Sets a variant's stock to the number counted, with the reason, audited. */
  async function setStock(productId: string, variantId: string, stock: number, reason: string, actor: AuditActor, now = new Date()) {
    return sql.begin(async (tx) => {
      const [variant] = await tx<{ stock: number; sku: string }[]>`
        SELECT stock, sku FROM product_variants WHERE id = ${variantId} AND product_id = ${productId} FOR UPDATE
      `;
      if (variant === undefined) return { ok: false, reason: "not_found" } as const;
      if (variant.stock === stock) return { ok: true, changed: false } as const;
      await tx`UPDATE product_variants SET stock = ${stock}, updated_at = ${now.toISOString()}::timestamptz WHERE id = ${variantId}`;
      await recordAudit(
        tx,
        { actor, action: "stock.set", entityType: "variant", entityId: variantId, changes: { stock: { before: variant.stock, after: stock } }, reason },
        now,
      );
      return { ok: true, changed: true } as const;
    });
  }

  return { listProducts, readProduct: (id: string) => readProduct(id), updateProduct, setStock };
}

export type CatalogAdminStore = ReturnType<typeof createCatalogAdminStore>;
