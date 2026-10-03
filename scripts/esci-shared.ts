/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Reading Amazon's Shopping Queries Dataset (ESCI) and indexing it with the shop's own catalogue writer, for E1 and the ranker.
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { unaccent } from "@electric-sql/pglite/contrib/unaccent";
import { vector } from "@electric-sql/pglite-pgvector";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { asyncBufferFromUrl, parquetMetadataAsync, parquetRead, type AsyncBuffer } from "hyparquet";
import postgres from "postgres";

import type { ProductInput } from "@/lib/catalog/input";
import { upsertCatalog } from "@/lib/catalog/write";
import * as schema from "@/lib/db/schema";
import { esciGrade } from "@/lib/search/esci";
import type { Grade } from "@/lib/search/metrics";
import { createRetrievers } from "@/lib/search/retrieve";
import { COLORS, extractTerms, MATERIALS } from "@/lib/search/vocabulary";

import { createPgliteServer } from "./pglite-server.mjs";

/**
 * Shared by scripts/evaluate-search-esci.ts (E1) and
 * scripts/esci-ranker-data.ts (the learned ranker's training data, docs/adr/057).
 * The labels file is downloaded once (51 MB); products are read from the
 * products file by byte range, only the columns and rows needed. Every corpus
 * is indexed into its own in-memory PostgreSQL by the shop's catalogue writer,
 * so the search runs exactly as it does in the shop.
 */

export const DATASET = "https://media.githubusercontent.com/media/amazon-science/esci-data/main/shopping_queries_dataset";
export const CACHE = path.join(".local", "esci");

export type EsciQuery = { id: number; query: string; judgements: Record<string, Grade> };
export type EsciProduct = { id: string; title: string; brand: string | null; color: string | null };

const out = (line = "") => process.stdout.write(`${line}\n`);

/** A whole local file as the reader's byte source. */
async function localFile(file: string): Promise<AsyncBuffer> {
  const bytes = await readFile(file);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return { byteLength: buffer.byteLength, slice: (start, end) => buffer.slice(start, end) };
}

/** Reads the named columns in full, as plain arrays in row order. */
export async function readColumns(file: AsyncBuffer, columns: string[]): Promise<Record<string, unknown[]>> {
  const metadata = await parquetMetadataAsync(file);
  const rows = Number(metadata.num_rows);
  const data: Record<string, unknown[]> = Object.fromEntries(columns.map((column) => [column, new Array<unknown>(rows)]));
  // One column at a time, so only one column's pages are in memory at once.
  for (const column of columns) {
    await parquetRead({
      file,
      metadata,
      columns: [column],
      onChunk: (chunk) => {
        const target = data[chunk.columnName]!;
        for (let i = 0; i < chunk.columnData.length; i += 1) target[chunk.rowStart + i] = chunk.columnData[i];
      },
    });
  }
  return data;
}

/**
 * Every US query of the small version in one split, with its graded products.
 * Only queries with something relevant to find (an exact or substitute
 * product): one whose products are all complements or irrelevant scores zero
 * for every system and says nothing.
 */
export async function esciQueries(split: "train" | "test"): Promise<Map<number, Omit<EsciQuery, "id">>> {
  const examples = path.join(CACHE, "examples.parquet");
  if (!existsSync(examples)) {
    out("  downloading the ESCI labels (51 MB)…");
    await mkdir(CACHE, { recursive: true });
    const response = await fetch(`${DATASET}/shopping_queries_dataset_examples.parquet`);
    if (!response.ok) throw new Error(`ESCI labels: ${response.status}`);
    await writeFile(examples, Buffer.from(await response.arrayBuffer()));
  }
  const data = await readColumns(await localFile(examples), ["query_id", "query", "product_id", "product_locale", "esci_label", "small_version", "split"]);
  const byQuery = new Map<number, Omit<EsciQuery, "id">>();
  for (let i = 0; i < data.query_id!.length; i += 1) {
    if (Number(data.small_version![i]) !== 1 || data.split![i] !== split || data.product_locale![i] !== "us") continue;
    const grade = esciGrade(String(data.esci_label![i]));
    if (grade === null) continue;
    const id = Number(data.query_id![i]);
    const entry = byQuery.get(id) ?? { query: String(data.query![i]), judgements: {} };
    entry.judgements[String(data.product_id![i])] = grade;
    byQuery.set(id, entry);
  }
  for (const [id, entry] of byQuery) if (!Object.values(entry.judgements).some((grade) => grade >= 2)) byQuery.delete(id);
  return byQuery;
}

/** The products wanted, read from the products file by range (about 150 MB of its columns), cached as JSON. */
export async function productsFor(wanted: ReadonlySet<string>, cacheFile: string): Promise<EsciProduct[]> {
  if (existsSync(cacheFile)) return JSON.parse(await readFile(cacheFile, "utf8")) as EsciProduct[];
  out("  reading id, title, brand, colour and locale from the ESCI products file by range (about 150 MB)…");
  const file = await asyncBufferFromUrl({ url: `${DATASET}/shopping_queries_dataset_products.parquet` });
  const data = await readColumns(file, ["product_id", "product_locale", "product_title", "product_brand", "product_color"]);
  const products: EsciProduct[] = [];
  for (let i = 0; i < data.product_id!.length; i += 1) {
    const id = String(data.product_id![i]);
    if (data.product_locale![i] !== "us" || !wanted.has(id)) continue;
    const text = (value: unknown) => (typeof value === "string" && value.trim() !== "" ? value.trim() : null);
    products.push({ id, title: text(data.product_title![i]) ?? id, brand: text(data.product_brand![i]), color: text(data.product_color![i]) });
  }
  await mkdir(path.dirname(cacheFile), { recursive: true });
  await writeFile(cacheFile, JSON.stringify(products));
  return products;
}

/**
 * An ESCI product as a catalogue entry. Only the words matter to the search;
 * the rest is what the writer requires (a stand-in photograph path that is
 * never served, one price, one category) and is the same for every product,
 * so no system gains from it. Colours and materials are read from the colour
 * field and the title exactly as the ABO import reads them.
 */
export function asCatalogEntry(product: EsciProduct): ProductInput {
  const title = product.title.slice(0, 160);
  const slugId = product.id.toLowerCase().replace(/[^a-z0-9]/g, "");
  return {
    source: "abo",
    sourceId: `esci-${product.id}`,
    slug: `esci-${slugId}`,
    kind: "ESCI_PRODUCT",
    category: "accents",
    titleEn: title,
    titleEl: null,
    brand: product.brand === null ? null : product.brand.slice(0, 80),
    descriptionEn: null,
    descriptionEl: null,
    highlightsEn: [],
    highlightsEl: null,
    translation: "none",
    colorLabel: product.color,
    colors: product.color === null ? extractTerms(title, COLORS, { greeklish: false }) : extractTerms(product.color, COLORS, { greeklish: false }),
    materials: extractTerms(title, MATERIALS, { greeklish: false }),
    attributes: {},
    dimsCm: null,
    weightGrams: null,
    priceCents: 1000,
    compareAtCents: null,
    stock: 10,
    license: "Apache-2.0",
    attribution: "Shopping Queries Dataset (ESCI), Amazon Science (Reddy et al., 2022)",
    media: [{ kind: "image", src: "/products/esci-not-served.webp", width: null, height: null, bytes: null, altEn: title, whiteGround: false }],
  };
}

/** A corpus indexed into its own in-memory PostgreSQL, with the shop's retrievers over it and a way back to ESCI's ids. */
export async function indexCorpus(products: readonly EsciProduct[], port: number) {
  const pglite = await PGlite.create("memory://", { extensions: { vector, pg_trgm, unaccent } });
  const server = createPgliteServer({ db: pglite, port, host: "127.0.0.1", maxConnections: 4 });
  await server.start();
  const sql = postgres(`postgres://postgres:postgres@127.0.0.1:${port}/postgres`, { max: 2, onnotice: () => {} });
  const db = drizzle(sql, { schema });
  await migrate(db, { migrationsFolder: "./drizzle" });
  await upsertCatalog(db, products.map(asCatalogEntry), { batchSize: 500 });
  const sourceOf = new Map((await sql<{ id: string; source_id: string }[]>`SELECT id, source_id FROM products`).map((row) => [row.id, row.source_id.slice("esci-".length)]));
  return {
    sql,
    retrievers: createRetrievers(sql),
    sourceOf,
    async close() {
      await sql.end();
      await server.stop();
      await pglite.close();
    },
  };
}
