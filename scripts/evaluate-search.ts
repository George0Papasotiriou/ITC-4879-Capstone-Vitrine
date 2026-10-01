/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Evaluation E1 as a report: every version of the search scored, from people's grades or an AI judge's, and the two compared.
 */

/**
 * docs/adr/036, docs/adr/049.
 *
 *   pnpm evals:search                 scores from the grades people gave at /admin/labeling
 *   pnpm evals:search --judge ai      scores from the AI judge's grades (docs/report/e1/ai-judgments.json)
 *   pnpm evals:search --check-set     draws the blind sample a person grades at /admin/labeling?view=check
 *   pnpm evals:search --agreement     how far the person and the AI judge agree on that sample
 *
 * Runs the fixed query set through each version of the search (the shop's own
 * code, src/lib/search) and scores each against the chosen grades, writing a
 * report to docs/report/evaluations/. Nothing is estimated: a query nobody has
 * graded is left out and counted, and an AI judge's grades are always reported
 * as an AI judge's, never as a person's.
 *
 * The AI judgments name products by slug (the same in every database the
 * catalogue is synced into); they are matched to this database's ids here.
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import postgres from "postgres";

import { E1_QUERIES, E1_SYSTEM_NAMES, E1_SYSTEMS } from "@/lib/search/evaluation";
import { agreement, checkSample, type JudgedPair } from "@/lib/search/judge-check";
import { createJudgmentStore, judgmentKey } from "@/lib/search/judgments-store";
import { scoreSystem, type Grade } from "@/lib/search/metrics";
import { searchProducts } from "@/lib/search/pipeline";
import { createRetrievers } from "@/lib/search/retrieve";

const OUT_DIR = path.join("docs", "report", "evaluations");
const E1_DIR = path.join("docs", "report", "e1");
const AI_JUDGMENTS = path.join(E1_DIR, "ai-judgments.json");
export const CHECK_SET = path.join(E1_DIR, "check-set.json");

type AiFile = { judge: string; rubric: string; at: string; judgments: JudgedPair[] };

async function readAi(): Promise<AiFile> {
  if (!existsSync(AI_JUDGMENTS)) throw new Error(`${AI_JUDGMENTS} does not exist: the AI judge has not graded the pool yet (pnpm evals:e1-pool, then the grading).`);
  return JSON.parse(await readFile(AI_JUDGMENTS, "utf8")) as AiFile;
}

async function slugIds(sql: postgres.Sql): Promise<Map<string, string>> {
  const rows = await sql<{ id: string; slug: string }[]>`SELECT id, slug FROM products`;
  return new Map(rows.map((row) => [row.slug, row.id]));
}

/** The AI judge's grades in the store's own shape: "query|locale" → product id → grade. */
function aiGrades(file: AiFile, ids: ReadonlyMap<string, string>): { grades: Map<string, Map<string, Grade>>; missing: number } {
  const grades = new Map<string, Map<string, Grade>>();
  let missing = 0;
  for (const judgment of file.judgments) {
    const id = ids.get(judgment.slug);
    if (id === undefined) {
      missing += 1;
      continue;
    }
    const key = `${judgmentKey(judgment.query)}|${judgment.locale}`;
    const byProduct = grades.get(key) ?? new Map<string, Grade>();
    byProduct.set(id, judgment.grade);
    grades.set(key, byProduct);
  }
  return { grades, missing };
}

async function score(sql: postgres.Sql, source: "people" | "ai"): Promise<void> {
  const retrievers = createRetrievers(sql);
  const ai = source === "ai" ? await readAi() : null;
  const fromAi = ai === null ? null : aiGrades(ai, await slugIds(sql));
  const judgments = fromAi?.grades ?? (await createJudgmentStore(sql).all());
  const runs: { entry: (typeof E1_QUERIES)[number]; grades: Map<string, Grade>; lists: Record<string, string[]> }[] = [];
  for (const entry of E1_QUERIES) {
    const grades = judgments.get(`${judgmentKey(entry.query)}|${entry.locale}`) ?? new Map<string, Grade>();
    const lists = Object.fromEntries(
      await Promise.all(E1_SYSTEM_NAMES.map(async (system) => [system, (await searchProducts(retrievers, entry.query, { ...E1_SYSTEMS[system], limit: 10 })).ids.slice(0, 10)] as const)),
    );
    runs.push({ entry, grades, lists });
  }
  const graded = runs.filter((run) => run.grades.size > 0).length;
  const scores = E1_SYSTEM_NAMES.map((system) => scoreSystem(system, runs.map((run) => ({ ranking: run.lists[system]!, judgements: run.grades }))));
  const kinds = [...new Set(E1_QUERIES.map((entry) => entry.kind))];
  const byKind = Object.fromEntries(
    kinds.map((kind) => [kind, Object.fromEntries(E1_SYSTEM_NAMES.map((system) => [system, scoreSystem(system, runs.filter((run) => run.entry.kind === kind).map((run) => ({ ranking: run.lists[system]!, judgements: run.grades })))]))]),
  );
  const judgedPairs = [...judgments.values()].reduce((sum, grades) => sum + grades.size, 0);
  const at = new Date().toISOString();
  const name = source === "ai" ? "e1-search-ai" : "e1-search";

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(path.join(OUT_DIR, `${name}.json`), `${JSON.stringify({ at, source, judge: ai?.judge ?? "people at /admin/labeling", queries: E1_QUERIES.length, graded, judgedPairs, scores, byKind }, null, 2)}\n`);
  const n = (value: number) => value.toFixed(3);
  const lines =
    source === "ai"
      ? [
          "# E1: search, each version scored by an AI judge",
          "",
          `Written by \`pnpm evals:search --judge ai\` on ${at.slice(0, 10)}: ${E1_QUERIES.length} fixed queries, ${graded} graded, ${judgedPairs} query–product pairs.`,
          "",
          `**The grades are an AI judge's, not a person's.** Judge: ${ai!.judge}. Rubric: ${ai!.rubric}`,
          "",
          "How far the judge agrees with a person, on a blind sample, is in e1-agreement.md.",
          ...(fromAi!.missing > 0 ? ["", `${fromAi!.missing} graded products are not in this database and were left out.`] : []),
          "",
        ]
      : [
          "# E1: search, each version scored",
          "",
          `Written by \`pnpm evals:search\` on ${at.slice(0, 10)}: ${E1_QUERIES.length} fixed queries, ${graded} with grades, ${judgedPairs} graded query–product pairs (graded at /admin/labeling).`,
          "",
        ];
  if (graded === 0) {
    lines.push("**Nothing has been graded yet.** Grade at /admin/labeling, then run this again.");
  } else {
    lines.push("| Version | Queries scored | NDCG@10 | MRR | Recall@10 |", "|---|---|---|---|---|");
    for (const result of scores) lines.push(`| ${result.system} | ${result.queries} | ${n(result.ndcg10)} | ${n(result.mrr)} | ${n(result.recall10)} |`);
    lines.push("", "## NDCG@10 by kind of query", "", `| Kind | ${E1_SYSTEM_NAMES.join(" | ")} |`, `|---|${E1_SYSTEM_NAMES.map(() => "---").join("|")}|`);
    for (const kind of kinds) lines.push(`| ${kind} | ${E1_SYSTEM_NAMES.map((system) => (byKind[kind]![system]!.queries === 0 ? "—" : n(byKind[kind]![system]!.ndcg10))).join(" | ")} |`);
    lines.push("", "Products nobody graded count as irrelevant (the usual, conservative choice). Semantic search is not in the table until an embedding model is set up.");
  }
  await writeFile(path.join(OUT_DIR, `${name}.md`), `${lines.join("\n")}\n`);
  process.stdout.write(`E1 (${source === "ai" ? "AI judge" : "people"}): ${graded} of ${E1_QUERIES.length} queries graded; wrote ${path.join(OUT_DIR, `${name}.md`)}\n`);
  for (const result of scores) process.stdout.write(`  ${result.system.padEnd(8)} NDCG@10 ${n(result.ndcg10)}  MRR ${n(result.mrr)}  Recall@10 ${n(result.recall10)}  (${result.queries} queries)\n`);
}

/** The blind sample: 40 pairs, balanced across the judge's grades, written without the grades a person must not see. */
async function writeCheckSet(): Promise<void> {
  const ai = await readAi();
  const sample = checkSample(ai.judgments, 40);
  await mkdir(E1_DIR, { recursive: true });
  await writeFile(CHECK_SET, `${JSON.stringify({ at: new Date().toISOString(), seed: 4949, pairs: sample.map(({ query, locale, slug }) => ({ query, locale, slug })) }, null, 2)}\n`);
  process.stdout.write(`Wrote ${CHECK_SET}: ${sample.length} pairs (${[0, 1, 2, 3].map((grade) => `${sample.filter((pair) => pair.grade === grade).length}×${grade}`).join(", ")} by the judge). Grade them blind at /admin/labeling?view=check.\n`);
}

async function writeAgreement(sql: postgres.Sql): Promise<void> {
  if (!existsSync(CHECK_SET)) throw new Error(`${CHECK_SET} does not exist: run pnpm evals:search --check-set first.`);
  const ai = await readAi();
  const check = JSON.parse(await readFile(CHECK_SET, "utf8")) as { pairs: { query: string; locale: "en" | "el"; slug: string }[] };
  const ids = await slugIds(sql);
  const people = await createJudgmentStore(sql).all();
  const judged = new Map(ai.judgments.map((pair) => [`${pair.locale}|${pair.query}|${pair.slug}`, pair.grade]));
  const pairs: { judge: Grade; person: Grade; query: string; slug: string }[] = [];
  for (const pair of check.pairs) {
    const id = ids.get(pair.slug);
    const person = id === undefined ? undefined : people.get(`${judgmentKey(pair.query)}|${pair.locale}`)?.get(id);
    const judge = judged.get(`${pair.locale}|${pair.query}|${pair.slug}`);
    if (person !== undefined && judge !== undefined) pairs.push({ judge, person, query: pair.query, slug: pair.slug });
  }
  const result = agreement(pairs);
  const at = new Date().toISOString();
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(path.join(OUT_DIR, "e1-agreement.json"), `${JSON.stringify({ at, judge: ai.judge, sample: check.pairs.length, ...result, disagreements: pairs.filter((pair) => pair.judge !== pair.person) }, null, 2)}\n`);
  const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
  const lines = [
    "# E1: how far the AI judge agrees with a person",
    "",
    `Written by \`pnpm evals:search --agreement\` on ${at.slice(0, 10)}. Judge: ${ai.judge}.`,
    "",
    `A person graded ${result.n} of the ${check.pairs.length} pairs in the blind sample (balanced across the judge's grades, docs/adr/049), without seeing the judge's grades.`,
    "",
  ];
  if (result.n === 0) {
    lines.push("**Nobody has graded the sample yet.** Grade it at /admin/labeling?view=check, then run this again.");
  } else {
    lines.push(
      "| Measure | Value |",
      "|---|---|",
      `| Exact agreement | ${percent(result.exact)} |`,
      `| Within one grade | ${percent(result.withinOne)} |`,
      `| Cohen's κ, quadratically weighted | ${result.kappa === null ? "undefined (one grade only)" : result.kappa.toFixed(3)} |`,
      "",
      "Rows: the judge's grade; columns: the person's.",
      "",
      "| | 0 | 1 | 2 | 3 |",
      "|---|---|---|---|---|",
      ...result.table.map((row, grade) => `| **${grade}** | ${row.join(" | ")} |`),
      "",
      "κ above 0.80 is usually read as almost perfect agreement, 0.61–0.80 substantial, 0.41–0.60 moderate (Landis & Koch, 1977).",
    );
  }
  await writeFile(path.join(OUT_DIR, "e1-agreement.md"), `${lines.join("\n")}\n`);
  process.stdout.write(`E1 agreement: ${result.n} pairs; exact ${result.n === 0 ? "—" : percent(result.exact)}, κ_w ${result.kappa === null ? "—" : result.kappa.toFixed(3)}. Wrote ${path.join(OUT_DIR, "e1-agreement.md")}\n`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--check-set")) return writeCheckSet();
  const url = process.env.DATABASE_URL;
  if (url === undefined || url === "") throw new Error("DATABASE_URL is not set. Run this through `pnpm evals:search`.");
  const sql = postgres(url, { max: 2, onnotice: () => {} });
  try {
    if (args.includes("--agreement")) await writeAgreement(sql);
    else await score(sql, args.includes("--judge") && args[args.indexOf("--judge") + 1] === "ai" ? "ai" : "people");
  } finally {
    await sql.end();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`[evals:search] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
