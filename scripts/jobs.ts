/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Running a background job from the command line: the schedules, and one run of any of them.
 */

/**
 * Jobs (docs/adr/020).
 *
 *   pnpm jobs list                  the recurring jobs, when they run, and how often locally
 *   pnpm jobs run <name>            run one now, in this process, and print what it did
 *   pnpm jobs run weekly-report --end-day 2026-09-13
 *
 * `run` calls the processor directly rather than enqueueing it, so the result
 * is printed here and the exit code says whether it worked. It is the same
 * processor the worker runs in production (src/worker/registry.ts): there is
 * one definition of what a job does.
 */

import { parseArgs } from "node:util";

import { SCHEDULES } from "@/lib/jobs/schedule";
import type { JobName } from "@/lib/jobs/types";
import { processors } from "@/worker/registry";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { "end-day": { type: "string" }, "dry-run": { type: "boolean", default: false } },
});
const [command, name] = positionals;

const RUNNABLE: readonly JobName[] = ["price-watches", "weekly-report", "rebuild-taste-graph", "ping"];

function list(): void {
  console.log("Recurring jobs (UTC):");
  for (const schedule of SCHEDULES) {
    console.log(`  ${schedule.job.padEnd(20)} ${schedule.pattern.padEnd(12)} locally every ${Math.round(schedule.localEveryMs / 60_000)} min`);
  }
  console.log(`\nRun one now: pnpm jobs run <${RUNNABLE.join(" | ")}>`);
}

async function run(job: JobName): Promise<void> {
  const payload = {
    requestedAt: new Date().toISOString(),
    reason: "manual" as const,
    ...(job === "weekly-report" && values["end-day"] !== undefined ? { endDay: values["end-day"] } : {}),
  };
  console.log(`Running ${job}…`);
  const result = await (processors[job] as (payload: unknown, jobId: string) => Promise<unknown>)(payload, "cli");
  console.log(JSON.stringify(result, null, 2));
}

async function main(): Promise<void> {
  if (command === "list" || command === undefined) {
    list();
    return;
  }
  if (command !== "run") throw new Error(`Unknown command "${command}". Try: pnpm jobs list`);
  if (name === undefined || !RUNNABLE.includes(name as JobName)) {
    throw new Error(`Name a job to run: ${RUNNABLE.join(", ")}`);
  }
  if (values["dry-run"]) {
    console.log(`Would run ${name}. Jobs write to the database and send emails, so there is nothing to preview.`);
    return;
  }
  await run(name as JobName);
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
