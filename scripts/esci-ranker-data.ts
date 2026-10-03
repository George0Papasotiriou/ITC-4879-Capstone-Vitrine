/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The learned ranker's data: ESCI queries searched by the shop, every candidate's features and its human grade.
 *
 *   pnpm ranker:data [--train 2000] [--seed 11]
 *
 * docs/adr/057. Three files in .local/esci/ranker/, one row per (query,
 * candidate): the query's id, the human grade (3 exact, 2 substitute,
 * 1 complement, 0 irrelevant or unlabelled), the product's ESCI id and the
 * features of src/lib/search/ranker.ts, in its order.
 *
 * - train.csv and valid.csv: queries drawn with `--seed` from the small
 *   version's TRAIN split, in corpora of 500 queries' products (about ten
 *   thousand products, the size of E1's), the last corpus kept for
 *   validation (early stopping). Train-split queries are never E1's.
 * - test.csv: E1's own 500 test queries over E1's own corpus — the same
 *   candidates E1 scores — for the offline evaluation and ablations. It is
 *   never used to fit or to choose anything.
 *
 * Candidates are the first RANKER_DEPTH of the shop's fused list (lexical +
 * fuzzy, before business re-ranking), exactly what the learned stage orders.
 * Beside each file, ideal-<name>.json holds every query's ten best grades over
 * all its judged products (retrieved or not), the ideal E1's NDCG divides by.
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import { seededSample } from "@/lib/search/esci";
import type { Grade } from "@/lib/search/metrics";
import { RANKER_DEPTH, rankingInputs, resetSearchVocabulary, searchProducts } from "@/lib/search/pipeline";
import { FEATURE_NAMES, rankingFeatures } from "@/lib/search/ranker";

import { CACHE, esciQueries, indexCorpus, productsFor, type EsciProduct, type EsciQuery } from "./esci-shared";

const OUT = path.join(CACHE, "ranker");
const PORT = 5437;
const GROUP = 500;
const out = (line = "") => process.stdout.write(`${line}\n`);

/** Searches each query over its corpus and writes one CSV row per candidate. */
/** Each query's ten best grades over everything judged for it: E1's ideal ranking. */
const idealOf = (queries: readonly EsciQuery[]) =>
  Object.fromEntries(queries.map((entry) => [entry.id, Object.values(entry.judgements).sort((a, b) => b - a).slice(0, 10)]));

async function rows(queries: readonly EsciQuery[], products: readonly EsciProduct[], label: string): Promise<string[]> {
  out(`  ${label}: ${queries.length} queries, ${products.length} products`);
  const corpus = await indexCorpus(products, PORT);
  resetSearchVocabulary();
  const lines: string[] = [];
  const started = Date.now();
  try {
    for (const [at, entry] of queries.entries()) {
      const result = await searchProducts(corpus.retrievers, entry.query, { retrievers: { lexical: true, fuzzy: true, semantic: false }, rerank: false, evidence: true, limit: RANKER_DEPTH });
      const evidence = result.evidence!;
      const ids = evidence.fused.slice(0, RANKER_DEPTH).map((fused) => fused.id);
      const inputs = await rankingInputs(corpus.retrievers, result.query, evidence, ids);
      for (const id of ids) {
        const product = inputs.products.get(id);
        if (product === undefined) continue;
        const source = corpus.sourceOf.get(id) ?? id;
        const grade: Grade = entry.judgements[source] ?? 0;
        const features = rankingFeatures(inputs.query, product).map((value) => (Number.isInteger(value) ? String(value) : value.toPrecision(9)));
        lines.push([entry.id, grade, source, ...features].join(","));
      }
      if ((at + 1) % 100 === 0) out(`    ${at + 1} of ${queries.length} (${Math.round((Date.now() - started) / 1000)} s)`);
    }
  } finally {
    await corpus.close();
  }
  return lines;
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { train: { type: "string" }, seed: { type: "string" } } });
  const count = Math.max(GROUP * 2, Number.parseInt(values.train ?? "2000", 10));
  const seed = Number.parseInt(values.seed ?? "11", 10);
  await mkdir(OUT, { recursive: true });
  const header = ["query", "grade", "product", ...FEATURE_NAMES].join(",");
  out(`Ranker data: ${count} train-split queries (seed ${seed}) in corpora of ${GROUP}, and E1's 500 test queries`);

  const trainQueries = await esciQueries("train");
  const chosen = seededSample([...trainQueries.keys()], count, seed).map((id) => ({ id, ...trainQueries.get(id)! }));
  const groups = Array.from({ length: Math.ceil(chosen.length / GROUP) }, (_, index) => chosen.slice(index * GROUP, (index + 1) * GROUP));
  // One read of the products file for every corpus, then each corpus takes its own queries' products.
  const everything = await productsFor(new Set(chosen.flatMap((entry) => Object.keys(entry.judgements))), path.join(CACHE, `ranker-products-${count}-${seed}.json`));
  const train: string[] = [];
  const valid: string[] = [];
  for (const [index, group] of groups.entries()) {
    const wanted = new Set(group.flatMap((entry) => Object.keys(entry.judgements)));
    const products = everything.filter((product) => wanted.has(product.id));
    const lines = await rows(group, products, `corpus ${index + 1} of ${groups.length}${index === groups.length - 1 ? " (validation)" : ""}`);
    (index === groups.length - 1 ? valid : train).push(...lines);
  }
  await writeFile(path.join(OUT, "train.csv"), `${header}\n${train.join("\n")}\n`);
  await writeFile(path.join(OUT, "valid.csv"), `${header}\n${valid.join("\n")}\n`);
  await writeFile(path.join(OUT, "ideal-train.json"), JSON.stringify(idealOf(groups.slice(0, -1).flat())));
  await writeFile(path.join(OUT, "ideal-valid.json"), JSON.stringify(idealOf(groups.at(-1) ?? [])));

  // E1's test queries over E1's own corpus: the sample and products evaluate-search-esci.ts wrote.
  const sampleFile = path.join(CACHE, "sample-500-7.json");
  if (!existsSync(sampleFile)) throw new Error("Run `pnpm evals:esci` first: it draws E1's sample.");
  const sample = JSON.parse(await readFile(sampleFile, "utf8")) as { queries: EsciQuery[] };
  const testWanted = new Set(sample.queries.flatMap((entry) => Object.keys(entry.judgements)));
  const test = await rows(sample.queries, await productsFor(testWanted, path.join(CACHE, "products-500-7.json")), "E1 test");
  await writeFile(path.join(OUT, "test.csv"), `${header}\n${test.join("\n")}\n`);
  await writeFile(path.join(OUT, "ideal-test.json"), JSON.stringify(idealOf(sample.queries)));
  out(`  wrote ${train.length} train, ${valid.length} validation and ${test.length} test rows to ${OUT}`);
}

main().catch((error: unknown) => {
  process.stderr.write(`[ranker:data] ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exitCode = 1;
});
