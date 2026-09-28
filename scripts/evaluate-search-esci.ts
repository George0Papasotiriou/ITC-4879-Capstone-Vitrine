/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Evaluation E1 on public data: the shop's search, version by version, on a fixed sample of Amazon's ESCI queries.
 */

/**
 * docs/adr/036 (addendum).
 *
 *   pnpm evals:esci [--queries 500] [--seed 7]
 *
 * 1. Reads Amazon's Shopping Queries Dataset (github.com/amazon-science/esci-data,
 *    Apache-2.0): the labels file (51 MB, kept in .local/esci), and from the
 *    1.1 GB products file only the columns the search needs — id, title,
 *    brand, colour, locale (about 150 MB read by range, never stored whole).
 *    The descriptions and bullet points are not read.
 * 2. Takes a fixed-seed sample of queries from the small version's US test
 *    split, and the products labelled for them (about twenty each), cached in
 *    .local/esci so a rerun downloads nothing.
 * 3. Loads those products into a database of its own (PGlite in memory, gone
 *    when the script ends) through the shop's catalogue writer, so they are
 *    indexed exactly as the shop indexes its own.
 * 4. Runs every query through each version of the search (E1_SYSTEMS, the
 *    shop's code in src/lib/search) and scores the top ten with the same
 *    metrics as E1, E/S/C/I as grades 3/2/1/0 (src/lib/search/esci.ts).
 *
 * The corpus pools every sampled query's products, so each query is searched
 * among some ten thousand products, not only its own twenty. A product
 * labelled for another query counts as irrelevant here even if it would fit,
 * so the figures are a lower bound — the usual, conservative choice.
 *
 * Writes docs/report/evaluations/e1-esci.md and .json.
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

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
import { E1_SYSTEM_NAMES, E1_SYSTEMS } from "@/lib/search/evaluation";
import { esciGrade, seededSample } from "@/lib/search/esci";
import { scoreSystem, type Grade } from "@/lib/search/metrics";
import { searchProducts } from "@/lib/search/pipeline";
import { createRetrievers } from "@/lib/search/retrieve";
import { COLORS, extractTerms, MATERIALS } from "@/lib/search/vocabulary";

import { createPgliteServer } from "./pglite-server.mjs";

const DATASET = "https://media.githubusercontent.com/media/amazon-science/esci-data/main/shopping_queries_dataset";
const CACHE = path.join(".local", "esci");
const OUT_DIR = path.join("docs", "report", "evaluations");
const DB_PORT = 5436;

const out = (line = "") => process.stdout.write(`${line}\n`);

type Sampled = { queries: { id: number; query: string; judgements: Record<string, Grade> }[] };
type EsciProduct = { id: string; title: string; brand: string | null; color: string | null };

/** A whole local file as the reader's byte source. */
async function localFile(file: string): Promise<AsyncBuffer> {
  const bytes = await readFile(file);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return { byteLength: buffer.byteLength, slice: (start, end) => buffer.slice(start, end) };
}

/** Reads the named columns in full, as plain arrays in row order. */
async function readColumns(file: AsyncBuffer, columns: string[]): Promise<Record<string, unknown[]>> {
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

async function sampleQueries(count: number, seed: number): Promise<Sampled> {
  const examples = path.join(CACHE, "examples.parquet");
  if (!existsSync(examples)) {
    out("  downloading the ESCI labels (51 MB)…");
    await mkdir(CACHE, { recursive: true });
    const response = await fetch(`${DATASET}/shopping_queries_dataset_examples.parquet`);
    if (!response.ok) throw new Error(`ESCI labels: ${response.status}`);
    await writeFile(examples, Buffer.from(await response.arrayBuffer()));
  }
  const data = await readColumns(await localFile(examples), ["query_id", "query", "product_id", "product_locale", "esci_label", "small_version", "split"]);
  const byQuery = new Map<number, { query: string; judgements: Record<string, Grade> }>();
  const rows = data.query_id!.length;
  for (let i = 0; i < rows; i += 1) {
    if (Number(data.small_version![i]) !== 1 || data.split![i] !== "test" || data.product_locale![i] !== "us") continue;
    const grade = esciGrade(String(data.esci_label![i]));
    if (grade === null) continue;
    const id = Number(data.query_id![i]);
    const entry = byQuery.get(id) ?? { query: String(data.query![i]), judgements: {} };
    entry.judgements[String(data.product_id![i])] = grade;
    byQuery.set(id, entry);
  }
  // Only queries with something relevant to find: a query whose products are all
  // complements or irrelevant scores zero for every system and says nothing.
  const usable = [...byQuery.entries()].filter(([, entry]) => Object.values(entry.judgements).some((grade) => grade >= 2)).map(([id]) => id);
  out(`  ${byQuery.size} US test queries in the small version, ${usable.length} with an exact or substitute product`);
  return { queries: seededSample(usable, count, seed).map((id) => ({ id, ...byQuery.get(id)! })) };
}

async function productsFor(wanted: ReadonlySet<string>, cacheFile: string): Promise<EsciProduct[]> {
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
function asCatalogEntry(product: EsciProduct): ProductInput {
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

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { queries: { type: "string" }, seed: { type: "string" } } });
  const count = Math.max(10, Number.parseInt(values.queries ?? "500", 10));
  const seed = Number.parseInt(values.seed ?? "7", 10);
  out(`E1 on ESCI: ${count} queries, seed ${seed}`);

  const sampleFile = path.join(CACHE, `sample-${count}-${seed}.json`);
  const sample: Sampled = existsSync(sampleFile) ? (JSON.parse(await readFile(sampleFile, "utf8")) as Sampled) : await sampleQueries(count, seed);
  await mkdir(CACHE, { recursive: true });
  await writeFile(sampleFile, JSON.stringify(sample));
  const wanted = new Set(sample.queries.flatMap((entry) => Object.keys(entry.judgements)));
  const products = await productsFor(wanted, path.join(CACHE, `products-${count}-${seed}.json`));
  out(`  ${sample.queries.length} queries, ${wanted.size} labelled products, ${products.length} found in the products file`);

  const pglite = await PGlite.create("memory://", { extensions: { vector, pg_trgm, unaccent } });
  const server = createPgliteServer({ db: pglite, port: DB_PORT, host: "127.0.0.1", maxConnections: 4 });
  await server.start();
  const sql = postgres(`postgres://postgres:postgres@127.0.0.1:${DB_PORT}/postgres`, { max: 2, onnotice: () => {} });
  try {
    const db = drizzle(sql, { schema });
    await migrate(db, { migrationsFolder: "./drizzle" });
    const loadStarted = Date.now();
    await upsertCatalog(db, products.map(asCatalogEntry), { batchSize: 500 });
    out(`  indexed ${products.length} products in ${Math.round((Date.now() - loadStarted) / 1000)} s`);
    const idBySource = new Map((await sql<{ id: string; source_id: string }[]>`SELECT id, source_id FROM products`).map((row) => [row.id, row.source_id.slice("esci-".length)]));

    const retrievers = createRetrievers(sql);
    const lists: Record<string, string[][]> = Object.fromEntries(E1_SYSTEM_NAMES.map((system) => [system, [] as string[][]]));
    const latency: Record<string, number[]> = Object.fromEntries(E1_SYSTEM_NAMES.map((system) => [system, [] as number[]]));
    const started = Date.now();
    for (const [at, entry] of sample.queries.entries()) {
      for (const system of E1_SYSTEM_NAMES) {
        const begun = performance.now();
        const result = await searchProducts(retrievers, entry.query, { ...E1_SYSTEMS[system], limit: 10 });
        latency[system]!.push(performance.now() - begun);
        lists[system]!.push(result.ids.slice(0, 10).map((id) => idBySource.get(id) ?? id));
      }
      if ((at + 1) % 50 === 0) out(`  ${at + 1} of ${sample.queries.length} queries (${Math.round((Date.now() - started) / 1000)} s)`);
    }

    const judgements = sample.queries.map((entry) => new Map(Object.entries(entry.judgements)) as Map<string, Grade>);
    const scores = E1_SYSTEM_NAMES.map((system) => scoreSystem(system, lists[system]!.map((ranking, i) => ({ ranking, judgements: judgements[i]! }))));
    const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;
    const p95 = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length * 0.95)] ?? 0;
    const empty = Object.fromEntries(E1_SYSTEM_NAMES.map((system) => [system, lists[system]!.filter((list) => list.length === 0).length]));
    const at = new Date().toISOString();
    const labels = sample.queries.reduce((sum, entry) => sum + Object.keys(entry.judgements).length, 0);

    await mkdir(OUT_DIR, { recursive: true });
    await writeFile(
      path.join(OUT_DIR, "e1-esci.json"),
      `${JSON.stringify({ at, seed, queries: sample.queries.length, labels, corpus: products.length, scores, empty, latencyMs: Object.fromEntries(E1_SYSTEM_NAMES.map((system) => [system, { median: median(latency[system]!), p95: p95(latency[system]!) }])) }, null, 2)}\n`,
    );
    const n = (value: number) => value.toFixed(3);
    const lines = [
      "# E1 on ESCI: the shop's search on Amazon's labelled queries",
      "",
      `Written by \`pnpm evals:esci\` on ${at.slice(0, 10)}. ${sample.queries.length} queries drawn with seed ${seed} from the Shopping Queries Dataset's small version, US test split (queries with at least one exact or substitute product); ${labels} labels; all their products (${products.length}) indexed together by the shop's catalogue writer.`,
      "",
      "| Version | NDCG@10 | MRR | Recall@10 | No results | Median ms | p95 ms |",
      "|---|---|---|---|---|---|---|",
      ...scores.map((score) => `| ${score.system} | ${n(score.ndcg10)} | ${n(score.mrr)} | ${n(score.recall10)} | ${empty[score.system]} | ${Math.round(median(latency[score.system]!))} | ${Math.round(p95(latency[score.system]!))} |`),
      "",
      "Grades: exact 3, substitute 2, complement 1, irrelevant 0; exact and substitute count as relevant for MRR and Recall. Products labelled for other queries count as irrelevant, so every figure is a lower bound. Only titles, brands and colours are indexed (the dataset's descriptions and bullet points are not read). Every product carries the same stand-in price and category: a category word in a query (\"chair\") narrows to a category none of them is in, and the search relaxes it, as it would in the shop.",
      "",
      "**Why the full version can score below fusion here.** Its re-ranking multiplies relevance by business signals (stock, a Bayesian rating, popularity), which are identical for every ESCI product, so only its last step acts: Maximal Marginal Relevance, which moves near-duplicates apart so a first row is not one chair in six colours. On ESCI those near-duplicates — the same item in another size or colour — are often exactly the products labelled exact, so spreading them costs NDCG while MRR (the first relevant result) holds. In the shop, where the signals differ, this is the trade the step is for; the figure shows its price on data that does not reward it.",
      "",
      "These figures are not comparable with the ESCI paper's (its ranking task orders each query's own twenty products, with gains 1 / 0.1 / 0.01 / 0); here each query searches the pooled corpus of ten thousand. Latency is on PGlite in one process on a laptop, not the production database: the trigram (fuzzy) retriever in particular is slower there. Semantic search is not in the table until an embedding model is set up.",
      "",
      "Data: Shopping Queries Dataset, Reddy et al., 2022, arXiv:2206.06588, Apache-2.0.",
    ];
    await writeFile(path.join(OUT_DIR, "e1-esci.md"), `${lines.join("\n")}\n`);
    out(`  wrote ${path.join(OUT_DIR, "e1-esci.md")}`);
    for (const score of scores) out(`  ${score.system.padEnd(8)} NDCG@10 ${n(score.ndcg10)}  MRR ${n(score.mrr)}  Recall@10 ${n(score.recall10)}  empty ${empty[score.system]}`);
  } finally {
    await sql.end();
    await server.stop();
    await pglite.close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`[evals:esci] ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exitCode = 1;
});
