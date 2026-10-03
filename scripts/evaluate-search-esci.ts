/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Evaluation E1 on public data: the shop's search, version by version, on a fixed sample of Amazon's ESCI queries.
 */

/**
 * docs/adr/036 (addendum), docs/adr/057.
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
 *    indexed exactly as the shop indexes its own (scripts/esci-shared.ts).
 * 4. Runs every query through each version of the search and scores the top
 *    ten with the same metrics as E1, E/S/C/I as grades 3/2/1/0. The versions
 *    are E1's (lexical, fuzzy, fusion, full), the same without the lexical
 *    words' rarity weights ("-plain", the ablation of ADR-009's addendum), and,
 *    when a trained model is in src/lib/search/models, the learned ranking
 *    stage over fusion ("ranker") and with the shop's business re-ranking and
 *    diversity after it ("ranker-full").
 * 5. Compares versions on the same queries: each difference with a paired
 *    bootstrap 95% interval (src/lib/search/metrics.ts pairedBootstrap).
 *
 * The corpus pools every sampled query's products, so each query is searched
 * among some ten thousand products, not only its own twenty. A product
 * labelled for another query counts as irrelevant here even if it would fit,
 * so the figures are a lower bound — the usual, conservative choice.
 *
 * Writes docs/report/evaluations/e1-esci.md and .json (with every query's
 * scores, so any comparison can be checked again).
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import { E1_SYSTEMS } from "@/lib/search/evaluation";
import { seededSample } from "@/lib/search/esci";
import { pairedBootstrap, perQuery, scoreSystem, type Grade } from "@/lib/search/metrics";
import { searchProducts, type SearchOptions } from "@/lib/search/pipeline";
import { checkModel, type RankerModel } from "@/lib/search/ranker";

import { CACHE, esciQueries, indexCorpus, productsFor, type EsciQuery } from "./esci-shared";

const OUT_DIR = path.join("docs", "report", "evaluations");
const MODEL_FILE = path.join("src", "lib", "search", "models", "ranker-v1.json");
const DB_PORT = 5436;

const out = (line = "") => process.stdout.write(`${line}\n`);

type Sampled = { queries: EsciQuery[] };

async function sampleQueries(count: number, seed: number): Promise<Sampled> {
  const byQuery = await esciQueries("test");
  out(`  ${byQuery.size} US test queries in the small version with an exact or substitute product`);
  return { queries: seededSample([...byQuery.keys()], count, seed).map((id) => ({ id, ...byQuery.get(id)! })) };
}

/** The versions compared, in the table's order. */
function systems(model: RankerModel | null): Record<string, SearchOptions> {
  return {
    "lexical-plain": { ...E1_SYSTEMS.lexical, lexicalWeighting: "plain" },
    lexical: E1_SYSTEMS.lexical,
    fuzzy: E1_SYSTEMS.fuzzy,
    "fusion-plain": { ...E1_SYSTEMS.fusion, lexicalWeighting: "plain" },
    fusion: E1_SYSTEMS.fusion,
    full: E1_SYSTEMS.full,
    ...(model === null ? {} : { ranker: { ...E1_SYSTEMS.fusion, ranker: model }, "ranker-full": { ...E1_SYSTEMS.full, ranker: model } }),
  };
}

/** The pairs compared on the same queries: what each tells. */
const COMPARISONS: [string, string, string][] = [
  ["lexical", "lexical-plain", "rarity weights, lexical alone"],
  ["fusion", "fusion-plain", "rarity weights, in fusion"],
  ["full", "fusion", "business re-ranking and diversity"],
  ["ranker", "fusion", "the learned ranking stage"],
  ["ranker-full", "full", "the learned stage inside the full search"],
  ["ranker-full", "fusion", "the full search with the learned stage, against fusion"],
];

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { queries: { type: "string" }, seed: { type: "string" } } });
  const count = Math.max(10, Number.parseInt(values.queries ?? "500", 10));
  const seed = Number.parseInt(values.seed ?? "7", 10);
  out(`E1 on ESCI: ${count} queries, seed ${seed}`);

  const model = existsSync(MODEL_FILE) ? (JSON.parse(await readFile(MODEL_FILE, "utf8")) as RankerModel) : null;
  if (model !== null && !checkModel(model)) throw new Error(`${MODEL_FILE} was trained on other features than src/lib/search/ranker.ts computes.`);
  const versions = systems(model);
  const names = Object.keys(versions);

  const sampleFile = path.join(CACHE, `sample-${count}-${seed}.json`);
  const sample: Sampled = existsSync(sampleFile) ? (JSON.parse(await readFile(sampleFile, "utf8")) as Sampled) : await sampleQueries(count, seed);
  await mkdir(CACHE, { recursive: true });
  await writeFile(sampleFile, JSON.stringify(sample));
  const wanted = new Set(sample.queries.flatMap((entry) => Object.keys(entry.judgements)));
  const products = await productsFor(wanted, path.join(CACHE, `products-${count}-${seed}.json`));
  out(`  ${sample.queries.length} queries, ${wanted.size} labelled products, ${products.length} found in the products file`);

  const loadStarted = Date.now();
  const corpus = await indexCorpus(products, DB_PORT);
  try {
    out(`  indexed ${products.length} products in ${Math.round((Date.now() - loadStarted) / 1000)} s`);
    const lists: Record<string, string[][]> = Object.fromEntries(names.map((system) => [system, [] as string[][]]));
    const latency: Record<string, number[]> = Object.fromEntries(names.map((system) => [system, [] as number[]]));
    const started = Date.now();
    for (const [at, entry] of sample.queries.entries()) {
      for (const system of names) {
        const begun = performance.now();
        const result = await searchProducts(corpus.retrievers, entry.query, { ...versions[system], limit: 10 });
        latency[system]!.push(performance.now() - begun);
        lists[system]!.push(result.ids.slice(0, 10).map((id) => corpus.sourceOf.get(id) ?? id));
      }
      if ((at + 1) % 50 === 0) out(`  ${at + 1} of ${sample.queries.length} queries (${Math.round((Date.now() - started) / 1000)} s)`);
    }

    const judgements = sample.queries.map((entry) => new Map(Object.entries(entry.judgements)) as Map<string, Grade>);
    const runsOf = (system: string) => lists[system]!.map((ranking, i) => ({ ranking, judgements: judgements[i]! }));
    const scores = names.map((system) => scoreSystem(system, runsOf(system)));
    const queries = Object.fromEntries(names.map((system) => [system, perQuery(runsOf(system))]));
    const comparisons = COMPARISONS.filter(([a, b]) => a in queries && b in queries).map(([a, b, what]) => ({
      a,
      b,
      what,
      ndcg10: pairedBootstrap(queries[a]!.ndcg, queries[b]!.ndcg),
      mrr: pairedBootstrap(queries[a]!.rr, queries[b]!.rr),
    }));
    const median = (values: number[]) => [...values].sort((x, y) => x - y)[Math.floor(values.length / 2)] ?? 0;
    const p95 = (values: number[]) => [...values].sort((x, y) => x - y)[Math.floor(values.length * 0.95)] ?? 0;
    const empty = Object.fromEntries(names.map((system) => [system, lists[system]!.filter((list) => list.length === 0).length]));
    const at = new Date().toISOString();
    const labels = sample.queries.reduce((sum, entry) => sum + Object.keys(entry.judgements).length, 0);

    await mkdir(OUT_DIR, { recursive: true });
    await writeFile(
      path.join(OUT_DIR, "e1-esci.json"),
      `${JSON.stringify(
        {
          at,
          seed,
          queries: sample.queries.length,
          labels,
          corpus: products.length,
          model: model === null ? null : { version: model.version, trees: model.trees.length },
          scores,
          comparisons,
          empty,
          latencyMs: Object.fromEntries(names.map((system) => [system, { median: median(latency[system]!), p95: p95(latency[system]!) }])),
          perQuery: { ids: sample.queries.map((entry) => entry.id), ...queries },
        },
        null,
        2,
      )}\n`,
    );
    const n = (value: number) => value.toFixed(3);
    const signed = (value: number) => `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(3)}`;
    const interval = (result: { mean: number; low: number; high: number }) => `${signed(result.mean)} [${signed(result.low)}, ${signed(result.high)}]`;
    const lines = [
      "# E1 on ESCI: the shop's search on Amazon's labelled queries",
      "",
      `Written by \`pnpm evals:esci\` on ${at.slice(0, 10)}. ${sample.queries.length} queries drawn with seed ${seed} from the Shopping Queries Dataset's small version, US test split (queries with at least one exact or substitute product); ${labels} labels; all their products (${products.length}) indexed together by the shop's catalogue writer.${model === null ? "" : ` Learned ranker: ${model.version}, ${model.trees.length} trees, trained on the dataset's train split only.`}`,
      "",
      "| Version | NDCG@10 | MRR | Recall@10 | No results | Median ms | p95 ms |",
      "|---|---|---|---|---|---|---|",
      ...scores.map((score) => `| ${score.system} | ${n(score.ndcg10)} | ${n(score.mrr)} | ${n(score.recall10)} | ${empty[score.system]} | ${Math.round(median(latency[score.system]!))} | ${Math.round(p95(latency[score.system]!))} |`),
      "",
      "## Paired comparisons",
      "",
      "Each difference on the same queries, with a 95% interval from 1,000 paired bootstrap resamples of the queries. An interval that does not cross zero is a difference these queries support.",
      "",
      "| Comparison | What it measures | NDCG@10 | MRR |",
      "|---|---|---|---|",
      ...comparisons.map((entry) => `| ${entry.a} − ${entry.b} | ${entry.what} | ${interval(entry.ndcg10)} | ${interval(entry.mrr)} |`),
      "",
      "Grades: exact 3, substitute 2, complement 1, irrelevant 0; exact and substitute count as relevant for MRR and Recall. Products labelled for other queries count as irrelevant, so every figure is a lower bound. Only titles, brands and colours are indexed (the dataset's descriptions and bullet points are not read). Every product carries the same stand-in price and category: a category word in a query (\"chair\") narrows to a category none of them is in, and the search relaxes it, as it would in the shop.",
      "",
      "**Rarity weights (\"-plain\" is without them).** PostgreSQL's ts_rank_cd has no inverse document frequency: a word in half the catalogue counted as much as a brand or model name in one product. The lexical retriever now weighs each word by ln(1 + N / df), from counts cached for ten minutes (ADR-009, addendum).",
      "",
      "**Why the full version can score below fusion here.** Its re-ranking multiplies relevance by business signals (stock, a Bayesian rating, popularity), which are identical for every ESCI product, so only its last step acts: Maximal Marginal Relevance, which moves near-duplicates apart so a first row is not one chair in six colours. On ESCI those near-duplicates — the same item in another size or colour — are often exactly the products labelled exact, so spreading them costs NDCG while MRR (the first relevant result) holds. In the shop, where the signals differ, this is the trade the step is for; the figure shows its price on data that does not reward it.",
      "",
      "**The learned stage (ADR-057).** LambdaMART, written for this project (research/ranker), orders the first 50 fused candidates from 20 features the shop computes (src/lib/search/ranker.ts); it was trained and stopped early on the train split's queries alone, so these test queries never shaped it.",
      "",
      "These figures are not comparable with the ESCI paper's (its ranking task orders each query's own twenty products, with gains 1 / 0.1 / 0.01 / 0); here each query searches the pooled corpus of ten thousand. Latency is on PGlite in one process on a laptop, not the production database: the trigram (fuzzy) retriever in particular is slower there. Semantic search is not in the table until an embedding model is set up.",
      "",
      "Data: Shopping Queries Dataset, Reddy et al., 2022, arXiv:2206.06588, Apache-2.0.",
    ];
    await writeFile(path.join(OUT_DIR, "e1-esci.md"), `${lines.join("\n")}\n`);
    out(`  wrote ${path.join(OUT_DIR, "e1-esci.md")}`);
    for (const score of scores) out(`  ${score.system.padEnd(13)} NDCG@10 ${n(score.ndcg10)}  MRR ${n(score.mrr)}  Recall@10 ${n(score.recall10)}  empty ${empty[score.system]}`);
    for (const entry of comparisons) out(`  ${`${entry.a} − ${entry.b}`.padEnd(26)} NDCG@10 ${interval(entry.ndcg10)}  MRR ${interval(entry.mrr)}`);
  } finally {
    await corpus.close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`[evals:esci] ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exitCode = 1;
});
