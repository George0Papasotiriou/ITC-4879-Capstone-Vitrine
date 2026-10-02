/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * E1's AI judge checked against people: a blind, balanced sample of Amazon's human-labelled ESCI pairs.
 */

/**
 * docs/adr/049 (addendum).
 *
 *   pnpm evals:e1-esci-check sample     writes the blind sample and, apart, its key
 *   pnpm evals:e1-esci-check score      compares the judge's grades with the key
 *
 * E1's grades come from an AI judge (docs/adr/049). How far such a judge can be
 * trusted is measured by its agreement with people. Amazon's Shopping Queries
 * Dataset (ESCI, already in .local/esci for `pnpm evals:esci`) was labelled by
 * Amazon's human annotators on the very scale the shop's rubric uses —
 * Exact 3, Substitute 2, Complement 1, Irrelevant 0 — so it is a ready set of
 * people's grades to check the judge against.
 *
 * SAMPLE. 200 (query, product) pairs from the fixed 500-query sample, 50 for
 * each human label (the shop's own balanced sampler, judge-check.ts, seed
 * 4949), shown in shuffled order. The blind file holds only what the judge may
 * see: the query and the product's title, brand and colour. The labels go to a
 * separate key file, which the judge does not open before grading.
 *
 * SCORE. Exact agreement, agreement within one grade, and Cohen's
 * quadratically weighted kappa (judge-check.ts), with the full table.
 *
 * Limits, stated in the report: the annotators saw Amazon's product pages; the
 * judge sees the title, brand and colour only. And ESCI's own labels are known
 * to be noisy, so agreement is bounded by how much the annotators agree with
 * one another, which the dataset does not publish.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

import { agreement, checkSample, type JudgedPair } from "@/lib/search/judge-check";
import type { Grade } from "@/lib/search/metrics";

const ESCI = path.join(".local", "esci");
const OUT = path.join("docs", "report", "e1");
const BLIND = path.join(OUT, "esci-check-blind.json");
const KEY = path.join(OUT, "esci-check-key.json");
const JUDGE = path.join(OUT, "esci-check-judge.json");
const REPORT = path.join("docs", "report", "evaluations", "e1-judge-esci");
const SIZE = 200;
const SEED = 4949;

type Query = { id: number; query: string; judgements: Record<string, Grade> };
type Product = { id: string; title: string; brand: string | null; color: string | null };
type KeyEntry = { n: number; asin: string; query: string; label: Grade };

async function sample(): Promise<void> {
  const { queries } = JSON.parse(await readFile(path.join(ESCI, "sample-500-7.json"), "utf8")) as { queries: Query[] };
  const products = new Map((JSON.parse(await readFile(path.join(ESCI, "products-500-7.json"), "utf8")) as Product[]).map((product) => [product.id, product]));
  const pairs: JudgedPair[] = [];
  for (const query of queries) {
    for (const [asin, label] of Object.entries(query.judgements)) {
      const product = products.get(asin);
      if (product !== undefined && product.title.trim() !== "") pairs.push({ query: query.query, locale: "en", slug: asin, grade: label });
    }
  }
  const chosen = checkSample(pairs, SIZE, SEED);
  const blind = chosen.map((pair, index) => {
    const product = products.get(pair.slug)!;
    return { n: index + 1, query: pair.query, title: product.title, brand: product.brand, color: product.color };
  });
  const key: KeyEntry[] = chosen.map((pair, index) => ({ n: index + 1, asin: pair.slug, query: pair.query, label: pair.grade }));
  await mkdir(OUT, { recursive: true });
  await writeFile(BLIND, JSON.stringify({ seed: SEED, size: blind.length, pairs: blind }, null, 1) + "\n");
  await writeFile(KEY, JSON.stringify({ seed: SEED, size: key.length, pairs: key }, null, 1) + "\n");
  const counts = [0, 1, 2, 3].map((grade) => chosen.filter((pair) => pair.grade === grade).length);
  console.log(`${blind.length} pairs (from ${pairs.length}; per label 0–3: ${counts.join(", ")}) → ${BLIND}; key apart in ${KEY}`);
}

async function score(): Promise<void> {
  const { pairs: key } = JSON.parse(await readFile(KEY, "utf8")) as { pairs: KeyEntry[] };
  const judged = JSON.parse(await readFile(JUDGE, "utf8")) as { judge: string; rubric: string; at: string; grades: Record<string, Grade> };
  const joined = key.filter((entry) => judged.grades[String(entry.n)] !== undefined).map((entry) => ({ judge: judged.grades[String(entry.n)]!, person: entry.label }));
  if (joined.length !== key.length) throw new Error(`the judge graded ${joined.length} of ${key.length} pairs`);
  const result = agreement(joined);
  const names = ["Irrelevant", "Complement", "Substitute", "Exact"];
  const perLabel = [0, 1, 2, 3].map((label) => {
    const rows = joined.filter((pair) => pair.person === label);
    return { label, n: rows.length, sameGrade: rows.length === 0 ? 0 : rows.filter((pair) => pair.judge === label).length / rows.length };
  });
  // Grades 2 and 3 count as relevant in E1's precision; does the judge draw that line where people do?
  const relevant = joined.filter((pair) => pair.judge >= 2 === pair.person >= 2).length / joined.length;
  const report = { judge: judged.judge, rubric: judged.rubric, gradedAt: judged.at, seed: SEED, ...result, relevantAgreement: relevant, perLabel };
  await mkdir(path.dirname(REPORT), { recursive: true });
  await writeFile(`${REPORT}.json`, JSON.stringify(report, null, 2) + "\n");
  const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
  const lines = [
    "# E1: the AI judge against Amazon's human annotators (ESCI)",
    "",
    `Written by \`pnpm evals:e1-esci-check score\`. ${result.n} (query, product) pairs from the fixed 500-query ESCI sample, ` +
      `${perLabel.map((row) => row.n).join("/")} per human label (Irrelevant/Complement/Substitute/Exact), seed ${SEED}, graded blind ` +
      `by ${judged.judge} on ${judged.at.slice(0, 10)} from the query and the product's title, brand and colour.`,
    "",
    "| Measure | Value |",
    "|---|---|",
    `| Exact agreement | ${percent(result.exact)} |`,
    `| Within one grade | ${percent(result.withinOne)} |`,
    `| Relevant or not (grade 2–3 against 0–1) | ${percent(relevant)} |`,
    `| Cohen's quadratically weighted κ | ${result.kappa === null ? "undefined" : result.kappa.toFixed(3)} |`,
    "",
    "Rows: the judge's grade. Columns: the annotators' label.",
    "",
    `| Judge \\ People | ${names.join(" | ")} |`,
    "|---|---|---|---|---|",
    ...result.table.map((row, grade) => `| ${names[grade]} | ${row.join(" | ")} |`),
    "",
    "Agreement per human label (the share the judge graded the same):",
    "",
    ...perLabel.map((row) => `- ${names[row.label]}: ${percent(row.sameGrade)} of ${row.n}`),
    "",
    "Limits: the annotators saw Amazon's product pages, the judge only the title, brand and colour; ESCI's labels are " +
      "themselves noisy and the dataset publishes no agreement between its annotators, so this is a floor on how well " +
      "the judge agrees with people, not a ceiling. The sample is balanced across labels, so κ here weighs the rare " +
      "Complement and Substitute pairs as much as the common Exact ones.",
  ];
  await writeFile(`${REPORT}.md`, lines.join("\n") + "\n");
  console.log(lines.slice(4, 10).join("\n"));
}

const command = process.argv[2];
if (command === "sample") await sample();
else if (command === "score") await score();
else {
  console.error("usage: pnpm evals:e1-esci-check sample | score");
  process.exitCode = 1;
}
