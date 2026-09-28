/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Evaluation E1 as a report: every version of the search scored on the queries graded at /admin/labeling.
 */

/**
 * docs/adr/036.
 *
 *   pnpm evals:search
 *
 * Runs the fixed query set through each version of the search (the shop's
 * own code, src/lib/search), scores them against the grades people gave at
 * /admin/labeling, and writes docs/report/evaluations/e1-search.md and .json.
 * Nothing is estimated: a query nobody has graded is left out and counted.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import postgres from "postgres";

import { E1_QUERIES, E1_SYSTEM_NAMES, E1_SYSTEMS } from "@/lib/search/evaluation";
import { createJudgmentStore, judgmentKey } from "@/lib/search/judgments-store";
import { scoreSystem, type Grade } from "@/lib/search/metrics";
import { searchProducts } from "@/lib/search/pipeline";
import { createRetrievers } from "@/lib/search/retrieve";

const OUT_DIR = path.join("docs", "report", "evaluations");

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (url === undefined || url === "") throw new Error("DATABASE_URL is not set. Run this through `pnpm evals:search`.");
  const sql = postgres(url, { max: 2, onnotice: () => {} });
  try {
    const retrievers = createRetrievers(sql);
    const judgments = await createJudgmentStore(sql).all();
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

    await mkdir(OUT_DIR, { recursive: true });
    await writeFile(path.join(OUT_DIR, "e1-search.json"), `${JSON.stringify({ at, queries: E1_QUERIES.length, graded, judgedPairs, scores, byKind }, null, 2)}\n`);
    const n = (value: number) => value.toFixed(3);
    const lines = [
      "# E1: search, each version scored",
      "",
      `Written by \`pnpm evals:search\` on ${at.slice(0, 10)}: ${E1_QUERIES.length} fixed queries, ${graded} with grades, ${judgedPairs} graded query–product pairs (graded at /admin/labeling).`,
      "",
    ];
    if (graded === 0) {
      lines.push("**Nothing has been graded yet.** Grade at /admin/labeling, then run this again.");
    } else {
      lines.push("| Version | Queries scored | NDCG@10 | MRR | Recall@10 |", "|---|---|---|---|---|");
      for (const score of scores) lines.push(`| ${score.system} | ${score.queries} | ${n(score.ndcg10)} | ${n(score.mrr)} | ${n(score.recall10)} |`);
      lines.push("", "## NDCG@10 by kind of query", "", `| Kind | ${E1_SYSTEM_NAMES.join(" | ")} |`, `|---|${E1_SYSTEM_NAMES.map(() => "---").join("|")}|`);
      for (const kind of kinds) lines.push(`| ${kind} | ${E1_SYSTEM_NAMES.map((system) => (byKind[kind]![system]!.queries === 0 ? "—" : n(byKind[kind]![system]!.ndcg10))).join(" | ")} |`);
      lines.push("", "Products nobody graded count as irrelevant (the usual, conservative choice). Semantic search is not in the table until an embedding model is set up.");
    }
    await writeFile(path.join(OUT_DIR, "e1-search.md"), `${lines.join("\n")}\n`);
    process.stdout.write(`E1: ${graded} of ${E1_QUERIES.length} queries graded; wrote ${path.join(OUT_DIR, "e1-search.md")}\n`);
    for (const score of scores) process.stdout.write(`  ${score.system.padEnd(8)} NDCG@10 ${n(score.ndcg10)}  MRR ${n(score.mrr)}  Recall@10 ${n(score.recall10)}  (${score.queries} queries)\n`);
  } finally {
    await sql.end();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`[evals:search] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
