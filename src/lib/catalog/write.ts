/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Idempotent catalogue writer that upserts products, images and search documents.
 */

import { and, eq, inArray, ne, sql, type SQL } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { PgTable } from "drizzle-orm/pg-core";

import type { ProductInput } from "@/lib/catalog/input";
import { buildSearchDocument } from "@/lib/catalog/search-document";
import { CATEGORIES } from "@/lib/catalog/taxonomy";
import * as schema from "@/lib/db/schema";

/**
 * Writes catalogue input into the database, idempotently.
 *
 * Products are matched on (source, source_id), so re-running an import
 * updates what changed and never duplicates a product; the product id — which
 * carts, orders and reviews will point at — survives every re-import. Media and
 * the default variant are replaced wholesale, because the importer owns them,
 * until staff edit the product: from then on the shop owns it and the import
 * adds nothing to it but its variant's colour label (docs/adr/018).
 *
 * Each batch is one transaction: a failure part-way leaves earlier batches
 * written and the failing batch untouched, never half a product.
 */

export type CatalogDatabase = PostgresJsDatabase<typeof schema>;

/** `SET col = excluded.col` for an upsert, for every named column. */
function excluded<T extends PgTable>(table: T, columns: readonly (keyof T["_"]["columns"] & string)[]): Record<string, SQL> {
  const set: Record<string, SQL> = {};
  const tableColumns = (table as unknown as Record<string, { name: string }>);
  for (const key of columns) {
    set[key] = sql.raw(`excluded."${tableColumns[key]!.name}"`);
  }
  return set;
}

export function brandSlug(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return slug === "" ? "brand" : slug;
}

export async function upsertCategories(db: CatalogDatabase): Promise<Map<string, string>> {
  const rows = await db
    .insert(schema.categories)
    .values(
      CATEGORIES.map((category) => ({
        slug: category.slug,
        nameEn: category.nameEn,
        nameEl: category.nameEl,
        descriptionEn: category.descriptionEn,
        descriptionEl: category.descriptionEl,
        position: category.position,
      })),
    )
    .onConflictDoUpdate({
      target: schema.categories.slug,
      set: {
        ...excluded(schema.categories, ["nameEn", "nameEl", "descriptionEn", "descriptionEl", "position"]),
        updatedAt: sql`now()`,
      },
    })
    .returning({ id: schema.categories.id, slug: schema.categories.slug });
  return new Map(rows.map((row) => [row.slug, row.id]));
}

async function upsertBrands(db: CatalogDatabase, names: readonly string[]): Promise<Map<string, string>> {
  const bySlug = new Map<string, string>();
  for (const name of names) bySlug.set(brandSlug(name), name);
  if (bySlug.size === 0) return new Map();

  const rows = await db
    .insert(schema.brands)
    .values([...bySlug].map(([slug, name]) => ({ slug, name })))
    .onConflictDoUpdate({ target: schema.brands.slug, set: { name: sql`excluded."name"`, updatedAt: sql`now()` } })
    .returning({ id: schema.brands.id, slug: schema.brands.slug });
  return new Map(rows.map((row) => [row.slug, row.id]));
}

/**
 * Takes excluded source listings off the shop floor. Archived, not deleted:
 * a product that has been in carts or orders must keep its row, and an
 * exclusion added by mistake is undone by removing it from the list and
 * importing again.
 */
export async function archiveExcluded(db: CatalogDatabase, source: "abo" | "capsule", sourceIds: readonly string[]): Promise<number> {
  if (sourceIds.length === 0) return 0;
  const rows = await db
    .update(schema.products)
    .set({ status: "archived", updatedAt: sql`now()` })
    // inArray rather than `= ANY(${array})`: Drizzle's sql template expands a JS
    // array into a parenthesised parameter list, which is not an array literal.
    .where(and(eq(schema.products.source, source), inArray(schema.products.sourceId, [...sourceIds]), ne(schema.products.status, "archived")))
    .returning({ id: schema.products.id });
  return rows.length;
}

export type WriteSummary = {
  products: number;
  media: number;
  brands: number;
  /** Products that did not exist before this write: new to the shop. */
  inserted: number;
  /** Products staff have edited, left as staff left them (docs/adr/018). */
  keptStaffEdits: number;
};

export type UpsertOptions = {
  batchSize?: number;
  /**
   * Leave the stock of products that already exist alone. A fixture's stock is
   * where a new product starts; once the shop is selling, stock belongs to the
   * orders (reservations, cancellations, returns). A deploy that syncs the
   * catalogue must add new products and refresh their descriptions without
   * quietly putting back what customers have bought.
   */
  preserveStock?: boolean;
};

export async function upsertCatalog(
  db: CatalogDatabase,
  products: readonly ProductInput[],
  { batchSize = 100, preserveStock = false }: UpsertOptions = {},
): Promise<WriteSummary> {
  const categoryIds = await upsertCategories(db);
  const summary: WriteSummary = { products: 0, media: 0, brands: 0, inserted: 0, keptStaffEdits: 0 };

  for (let start = 0; start < products.length; start += batchSize) {
    const batch = products.slice(start, start + batchSize);

    await db.transaction(async (tx) => {
      const brands = [...new Set(batch.map((product) => product.brand).filter((brand): brand is string => brand !== null))];
      const brandIds = await upsertBrands(tx, brands);
      summary.brands += brandIds.size;

      const existing = await tx
        .select({ source: schema.products.source, sourceId: schema.products.sourceId })
        .from(schema.products)
        .where(inArray(schema.products.sourceId, batch.map((product) => product.sourceId)));
      const known = new Set(existing.map((row) => `${row.source}:${row.sourceId}`));
      summary.inserted += batch.filter((product) => !known.has(`${product.source}:${product.sourceId}`)).length;

      await tx
        .insert(schema.products)
        .values(
          batch.map((product) => {
            const categoryId = categoryIds.get(product.category);
            if (categoryId === undefined) throw new Error(`Unknown category ${product.category}`);
            return {
              slug: product.slug,
              source: product.source,
              sourceId: product.sourceId,
              status: "active" as const,
              categoryId,
              brandId: product.brand === null ? null : (brandIds.get(brandSlug(product.brand)) ?? null),
              kind: product.kind,
              titleEn: product.titleEn,
              titleEl: product.titleEl,
              descriptionEn: product.descriptionEn,
              descriptionEl: product.descriptionEl,
              highlightsEn: product.highlightsEn,
              highlightsEl: product.highlightsEl,
              translation: product.translation,
              colorLabel: product.colorLabel,
              colors: product.colors,
              materials: product.materials,
              attributes: product.attributes,
              dimsCm: product.dimsCm,
              weightGrams: product.weightGrams,
              priceCents: product.priceCents,
              compareAtCents: product.compareAtCents,
              license: product.license,
              attribution: product.attribution,
              ...buildSearchDocument(product),
            };
          }),
        )
        .onConflictDoUpdate({
          target: [schema.products.source, schema.products.sourceId],
          set: {
            ...excluded(schema.products, [
              "slug", "categoryId", "brandId", "kind", "titleEn", "titleEl", "descriptionEn", "descriptionEl",
              "highlightsEn", "highlightsEl", "translation", "colorLabel", "colors", "materials", "attributes",
              "dimsCm", "weightGrams", "priceCents", "compareAtCents", "license", "attribution",
              "searchTitle", "searchMeta", "searchAttributes", "searchDescription",
            ]),
            updatedAt: sql`now()`,
          },
          // Once staff have edited a product the shop owns its text, prices and
          // photos; the sync leaves it alone (docs/adr/018).
          setWhere: sql`${schema.products.staffEditedAt} IS NULL`,
        });

      // Read back every product in the batch, including those the sync left alone.
      const rows = await tx
        .select({ id: schema.products.id, source: schema.products.source, sourceId: schema.products.sourceId, staffEditedAt: schema.products.staffEditedAt })
        .from(schema.products)
        .where(inArray(schema.products.sourceId, batch.map((product) => product.sourceId)));
      const idFor = new Map(rows.map((row) => [`${row.source}:${row.sourceId}`, row.id]));
      const edited = new Set(rows.filter((row) => row.staffEditedAt !== null).map((row) => row.id));
      const refreshed = batch.filter((product) => !edited.has(idFor.get(`${product.source}:${product.sourceId}`)!));
      summary.keptStaffEdits += batch.length - refreshed.length;

      const refreshedIds = refreshed.map((product) => idFor.get(`${product.source}:${product.sourceId}`)!);
      if (refreshedIds.length > 0) await tx.delete(schema.productMedia).where(inArray(schema.productMedia.productId, refreshedIds));
      const media = refreshed.flatMap((product) => {
        const productId = idFor.get(`${product.source}:${product.sourceId}`)!;
        const positions = new Map<string, number>();
        return product.media.map((item) => {
          const position = positions.get(item.kind) ?? 0;
          positions.set(item.kind, position + 1);
          return { productId, position, ...item };
        });
      });
      if (media.length > 0) await tx.insert(schema.productMedia).values(media);
      summary.media += media.length;

      await tx
        .insert(schema.productVariants)
        .values(
          batch.map((product) => ({
            productId: idFor.get(`${product.source}:${product.sourceId}`)!,
            sku: `VT-${product.source.toUpperCase()}-${product.sourceId}`,
            colorLabel: product.colorLabel,
            stock: product.stock,
          })),
        )
        .onConflictDoUpdate({
          target: schema.productVariants.sku,
          set: {
            ...excluded(schema.productVariants, preserveStock ? ["colorLabel"] : ["colorLabel", "stock"]),
            updatedAt: sql`now()`,
          },
        });

      summary.products += refreshed.length;
    });
  }

  return summary;
}
