/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Evaluation E4 (real photos): turns the measurement bench's export into the report's table and verdict.
 */

/**
 * Evaluation E4, the real-photo half (docs/PLAN.md Phase 10, acceptance: mean
 * size error ≤ 10% over at least 12 rooms).
 *
 *   pnpm evals:room-real                     reads .local/e4/e4-real.json
 *   pnpm evals:room-real path/to/other.json
 *
 * The measurements come from the bench at /en/lab/e4, which George runs on his
 * own photographs; it exports numbers only. No photograph is read here, and none
 * is ever committed: the repository sees file names, heights and errors.
 *
 * Writes docs/report/evaluations/e4-real.md and .json.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";

import { compareMethods, summariseE4, type E4Record } from "@/lib/vision/e4";

const OUT_DIR = "docs/report/evaluations";
const DEFAULT_INPUT = ".local/e4/e4-real.json";
const TARGET = 0.1;

const pct = (value: number, digits = 1) => (Number.isNaN(value) ? "—" : `${(value * 100).toFixed(digits)}%`);
const metres = (value: number) => (Number.isNaN(value) ? "—" : `${value.toFixed(2)} m`);

function parse(text: string): E4Record[] {
  const data: unknown = JSON.parse(text);
  if (!Array.isArray(data)) throw new Error("The export should be a list of measurements");
  // A light check rather than a schema: this file is written by our own bench.
  for (const record of data) {
    if (typeof record !== "object" || record === null || typeof (record as E4Record).file !== "string") {
      throw new Error("Each measurement needs at least a file name");
    }
  }
  return data as E4Record[];
}

async function main() {
  const input = process.argv[2] ?? DEFAULT_INPUT;
  let records: E4Record[];
  try {
    records = parse(await readFile(input, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      console.error(`No measurements at ${input}.

Open /en/lab/e4 on the local build (pnpm local), mark your room photos, then
export and save the file there. The plan asks for at least 12 rooms, each with
an A4 sheet on the floor and an object whose height you measured.`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  const paper = summariseE4(records, "paper");
  const depth = summariseE4(records, "depth");
  const { both } = compareMethods(records);
  const verdict = {
    rooms: records.length,
    enoughRooms: records.length >= 12,
    paperMeetsTarget: paper.count > 0 && paper.mape <= TARGET,
    depthMeetsTarget: depth.count > 0 && depth.mape <= TARGET,
  };

  const report = { generatedAt: new Date().toISOString(), input, verdict, paper, depth, both, records };
  const md = `# E4 (real photos): placing a piece at its true size

Generated ${report.generatedAt} by \`scripts/evaluate-room-real.ts\` from \`${input}\`.
Measured with the bench at \`/en/lab/e4\`: in each photograph an A4 sheet lies on the
floor and an object of measured height stands on it. Each method recovers the camera
from the same photograph — one from the four sheet corners, one from a depth map with
no sheet at all — and the size error is how wrong that object's height comes out on
screen. No photograph leaves the machine; this file holds numbers only.

**Plan target:** mean size error ≤ 10% over at least 12 rooms.

## Verdict

| | Rooms measured | Mean size error | Target |
|---|---|---|---|
| With a sheet of paper | ${paper.count}${paper.failed > 0 ? ` (${paper.failed} without an answer)` : ""} | ${pct(paper.mape)} | ${verdict.paperMeetsTarget ? "met" : "not met"} |
| Without paper | ${depth.count}${depth.failed > 0 ? ` (${depth.failed} without an answer)` : ""} | ${pct(depth.mape)} | ${verdict.depthMeetsTarget ? "met" : "not met"} |

${verdict.enoughRooms ? `Rooms: ${records.length}, at or above the twelve the plan asks for.` : `**Only ${records.length} of the 12 rooms the plan asks for.** The numbers below are provisional.`}

## By method

| | With a sheet | Without paper |
|---|---|---|
| Rooms with an answer | ${paper.count} | ${depth.count} |
| Rooms without one | ${paper.failed} | ${depth.failed} |
| Mean size error | ${pct(paper.mape)} | ${pct(depth.mape)} |
| Median | ${pct(paper.p50)} | ${pct(depth.p50)} |
| p90 | ${pct(paper.p90)} | ${pct(depth.p90)} |
| Within 10% | ${pct(paper.within10, 0)} | ${pct(depth.within10, 0)} |
| Mean camera height recovered | ${metres(paper.meanCameraHeight)} | ${metres(depth.meanCameraHeight)} |

On the ${both.count} rooms where both methods answered: ${pct(both.paperMape)} with the sheet,
${pct(both.depthMape)} without it${Number.isNaN(both.depthWorseBy) ? "" : ` (${both.depthWorseBy >= 0 ? "+" : ""}${pct(both.depthWorseBy)} for the paper-free method)`}.

## Room by room

| Photo | Object | Lens | With a sheet | Without paper | Note |
|---|---|---|---|---|---|
${records
  .map(
    (record) =>
      `| ${record.file} | ${record.objectHeightCm} cm | ${record.focalFrom === "exif" ? "from the photo" : "assumed 69°"} | ${record.paper === null ? "—" : pct(record.paper.sizeError)} | ${record.depth === null ? "—" : pct(record.depth.sizeError)} | ${record.note ?? ""} |`,
  )
  .join("\n")}

## How to read a failure

A dash means the method gave no answer at all: the sheet could not be a rectangle on
the floor, or the paper-free method found no floor it trusted. Those are refusals, not
wrong sizes — the shop shows nothing rather than a piece at the wrong scale — and they
are counted in "rooms without an answer" above.
`;

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(`${OUT_DIR}/e4-real.json`, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(`${OUT_DIR}/e4-real.md`, md);
  console.log(md);
}

await main();
