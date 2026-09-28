/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The user study's analysis: task completion and time from the shop's records, SUS from the questionnaires.
 */

/**
 * docs/adr/037, docs/report/user-study/protocol.md.
 *
 *   pnpm study analyse
 *
 * Reads the study events the shop recorded and docs/report/user-study/sus.csv
 * (typed in from the paper questionnaires), and writes
 * docs/report/evaluations/e6-user-study.md. With no sessions yet it writes
 * that plainly and nothing else: no figure appears here that a real session
 * did not produce.
 */

import { readFile, writeFile } from "node:fs/promises";

import postgres from "postgres";

import { bootstrapInterval, mean, median, summariseTasks, susScore, type Interval } from "@/lib/study/analysis";
import { attemptsFromEvents, PARTICIPANT_CODE, STUDY_TASKS } from "@/lib/study/tasks";

const SUS_FILE = "docs/report/user-study/sus.csv";
const OUT = "docs/report/evaluations/e6-user-study.md";

const percent = (value: number) => `${Math.round(value * 100)}%`;
const range = (interval: Interval | null, format: (value: number) => string) => (interval === null ? "—" : `${format(interval.estimate)} (95% CI ${format(interval.low)}–${format(interval.high)})`);

async function analyse(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (url === undefined || url === "") throw new Error("DATABASE_URL is not set. Run this through `pnpm study`.");
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  let events: { participant: string; task: string; event: string; at: Date }[];
  try {
    events = (await sql<{ participant: string; task: string; event: string; occurred_at: Date }[]>`
      SELECT participant, task, event, occurred_at FROM study_events ORDER BY occurred_at
    `).map((row) => ({ participant: row.participant, task: row.task, event: row.event, at: new Date(row.occurred_at) }));
  } finally {
    await sql.end();
  }

  const susRows = (await readFile(SUS_FILE, "utf8").catch(() => ""))
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.split(",").map((cell) => cell.trim()))
    .filter((cells) => PARTICIPANT_CODE.test(cells[0] ?? ""));
  const sus = susRows.map((cells) => ({ code: cells[0]!, score: susScore(cells.slice(1, 11).map(Number)), own: cells.slice(11, 14).map(Number) }));

  const attempts = attemptsFromEvents(events);
  const participants = new Set(attempts.map((attempt) => attempt.participant));
  const lines = [
    "# E6: user study results",
    "",
    `Written by \`pnpm study analyse\` on ${new Date().toISOString().slice(0, 10)}. Protocol: docs/report/user-study/protocol.md.`,
    "",
  ];

  if (participants.size === 0 && sus.length === 0) {
    lines.push("**No sessions have been run yet.** This file has no results, and none may be written into it by hand.");
  } else {
    lines.push(`Participants with recorded tasks: ${participants.size}. Questionnaires: ${sus.length}.`, "");
    lines.push("## Tasks", "", "| Task | Attempts | Completed | Median time, successful attempts |", "|---|---|---|---|");
    for (const row of summariseTasks(attempts, STUDY_TASKS)) {
      lines.push(`| ${row.task} | ${row.attempts} | ${range(row.completion, percent)} | ${range(row.medianSeconds, (value) => `${Math.round(value)} s`)} |`);
    }
    const partials = attempts.filter((attempt) => attempt.outcome === "partial").length;
    lines.push("", `Partly done (not counted as completed): ${partials}.`, "");
    const scores = sus.map((entry) => entry.score);
    lines.push("## SUS", "", `Mean ${range(bootstrapInterval(scores, mean), (value) => value.toFixed(1))} over ${scores.length} questionnaires (about 68 is average in published studies).`, "");
    const own = ["Trusted the Concierge to do only what was asked", "The shop explained why it suggested things", "Would shop here again"];
    lines.push("## Our three questions (1–5)", "", "| Question | Median |", "|---|---|");
    own.forEach((question, index) => lines.push(`| ${question} | ${median(sus.map((entry) => entry.own[index]!).filter((value) => Number.isFinite(value))) ?? "—"} |`));
    lines.push("", "With this many people the intervals are wide; the problems found (docs/report/user-study/problems.md) are the main result.");
  }
  await writeFile(OUT, `${lines.join("\n")}\n`);
  process.stdout.write(`wrote ${OUT}\n`);
}

const [command] = process.argv.slice(2);
if (command === "analyse") {
  analyse().catch((error: unknown) => {
    process.stderr.write(`[study] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
} else {
  process.stdout.write("Usage: pnpm study analyse\n");
  process.exitCode = 1;
}
