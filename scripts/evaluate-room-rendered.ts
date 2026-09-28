/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Evaluation E4 (rendered rooms): the paper-free method on real scans photographed by a virtual phone, where the truth is exact.
 */

/**
 * docs/adr/036 (addendum).
 *
 *   pnpm e4:render                 render the scenes (.local/e4-render)
 *   pnpm evals:room-rendered       measure them and write the report
 *
 * The same depth model, letterbox, floor finder and verdict as the room page
 * and the web-photo bench (evaluate-room-web.ts). What is new is the truth:
 * the piece's height is its scan's, the marks are computed, and the camera's
 * real height is known — so the report can also say how far the floor the
 * method found sits from the real one, which is where a size error comes from.
 *
 * Writes docs/report/evaluations/e4-rendered.md and .json.
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import * as ort from "onnxruntime-web";
import sharp from "sharp";

import { seededRandom } from "@/lib/reco/simulate";
import { focalFromFov, intrinsics } from "@/lib/vision/camera";
import { floorFromDepth, judgeFloor } from "@/lib/vision/depth";
import { depthToPhoto, letterbox } from "@/lib/vision/depth-image";
import { measureWithPose, type E4MethodResult } from "@/lib/vision/e4";

import { loadModel } from "./evaluate-room-web";
import { RENDER_DIR, RENDER_MANIFEST, type RenderedScene } from "./render-room-scenes";

const OUT_DIR = path.join("docs", "report", "evaluations");
const TARGET = 0.1;
/** The lens the scenes were rendered with (the app's own assumption), then two wrong guesses, then no lens correction. */
const VARIANTS = [
  { id: "true-lens", fov: 69, corrected: true },
  { id: "lens-55", fov: 55, corrected: true },
  { id: "lens-80", fov: 80, corrected: true },
  { id: "uncorrected", fov: 69, corrected: false },
] as const;

type Outcome = { id: (typeof VARIANTS)[number]["id"]; result: (E4MethodResult & { tiltDegrees: number; floorShare: number }) | null; refused: string | null };

const pct = (value: number | null | undefined, digits = 1) => (value === null || value === undefined || Number.isNaN(value) ? "—" : `${(value * 100).toFixed(digits)}%`);
const mean = (values: number[]) => (values.length === 0 ? Number.NaN : values.reduce((sum, value) => sum + value, 0) / values.length);
const median = (values: number[]) => (values.length === 0 ? Number.NaN : [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!);

async function main(): Promise<void> {
  if (!existsSync(RENDER_MANIFEST)) throw new Error("No rendered scenes. Run `pnpm e4:render` first.");
  const rendered = JSON.parse(await readFile(RENDER_MANIFEST, "utf8")) as { seed: number; scenes: RenderedScene[] };
  const { session, manifest } = await loadModel();
  const inputName = manifest.inputName ?? session.inputNames[0]!;
  const outputName = manifest.outputName ?? session.outputNames[0]!;
  const metric = manifest.output === "metric_depth";
  console.log(`Model ${manifest.model}, ${rendered.scenes.length} rendered scenes (seed ${rendered.seed})\n`);

  const rows: { scene: RenderedScene; outcomes: Outcome[]; control: Outcome }[] = [];
  for (const scene of rendered.scenes) {
    const { data, info } = await sharp(await readFile(path.join(RENDER_DIR, scene.file))).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const box = letterbox(data, info.width, info.height, manifest.inputSize);
    const output = await session.run({ [inputName]: new ort.Tensor("float32", box.tensor, [1, 3, box.size, box.size]) });
    const mapped = depthToPhoto(output[outputName]!.data as Float32Array, box, info.width, info.height);
    const depth = manifest.canonicalFocal === undefined ? mapped : { ...mapped, focal: manifest.canonicalFocal * box.scale };
    const marks = { sheet: [], base: scene.base, top: scene.top, objectHeightCm: scene.heightCm };

    const outcomes: Outcome[] = VARIANTS.map(({ id, fov, corrected }) => {
      const K = intrinsics(focalFromFov(fov, Math.max(info.width, info.height)), info.width, info.height);
      const floor = floorFromDepth(corrected ? depth : mapped, K, { metric, cameraHeight: 1.4, random: seededRandom(4949) });
      const verdict = judgeFloor(floor);
      if (floor === null || !verdict.ok) return { id, result: null, refused: verdict.reason ?? "no_floor" };
      const result = measureWithPose(K, floor.pose, marks, floor.cameraHeight);
      if (result === null) return { id, result: null, refused: "foot_beyond_horizon" };
      return { id, result: { ...result, tiltDegrees: floor.tiltDegrees, floorShare: floor.floorShare }, refused: null };
    });
    // The control: the same method on the renderer's exact depth. What it gets wrong is the method's
    // geometry or the marks; what the model's depth adds on top is the depth model's.
    const exact = await readFile(path.join(RENDER_DIR, scene.exactDepth.file));
    const exactMap = { data: new Float32Array(exact.buffer, exact.byteOffset, exact.byteLength / 4), width: scene.exactDepth.width, height: scene.exactDepth.height };
    const shrink = scene.exactDepth.width / scene.width;
    const exactK = intrinsics(focalFromFov(scene.fovDegrees, Math.max(exactMap.width, exactMap.height)), exactMap.width, exactMap.height);
    const exactFloor = floorFromDepth(exactMap, exactK, { metric, cameraHeight: 1.4, random: seededRandom(4949) });
    const exactVerdict = judgeFloor(exactFloor);
    const exactMarks = { sheet: [], base: [scene.base[0] * shrink, scene.base[1] * shrink] as [number, number], top: [scene.top[0] * shrink, scene.top[1] * shrink] as [number, number], objectHeightCm: scene.heightCm };
    const exactResult = exactFloor === null || !exactVerdict.ok ? null : measureWithPose(exactK, exactFloor.pose, exactMarks, exactFloor.cameraHeight);
    const control: Outcome = {
      id: "true-lens",
      result: exactResult === null || exactFloor === null ? null : { ...exactResult, tiltDegrees: exactFloor.tiltDegrees, floorShare: exactFloor.floorShare },
      refused: exactResult === null ? (exactVerdict.reason ?? "no_floor") : null,
    };
    rows.push({ scene, outcomes, control });
    const shop = outcomes[0]!;
    console.log(
      `${scene.file.padEnd(22)} ${scene.category.padEnd(10)} ${String(scene.heightCm).padStart(6)} cm  ${
        shop.result === null ? `refused (${shop.refused})` : `error ${pct(shop.result.sizeError).padStart(6)}  camera ${shop.result.cameraHeight.toFixed(2)} m (true ${scene.cameraHeightM.toFixed(2)})`
      }  exact depth: ${control.result === null ? `refused (${control.refused})` : pct(control.result.sizeError)}`,
    );
  }
  await session.release();

  const summaries = VARIANTS.map((variant, index) => {
    const answered = rows.map((row) => ({ row, result: row.outcomes[index]!.result })).filter((entry) => entry.result !== null);
    const errors = answered.map((entry) => entry.result!.sizeError);
    const cameraErrors = answered.map((entry) => Math.abs(entry.result!.cameraHeight - entry.row.scene.cameraHeightM) / entry.row.scene.cameraHeightM);
    return {
      ...variant,
      answered: answered.length,
      refused: rows.length - answered.length,
      mape: mean(errors),
      median: median(errors),
      within10: errors.length === 0 ? Number.NaN : errors.filter((error) => error <= TARGET).length / errors.length,
      cameraHeightError: mean(cameraErrors),
    };
  });
  const shop = summaries[0]!;
  const controlAnswered = rows.filter((row) => row.control.result !== null);
  const controlErrors = controlAnswered.map((row) => row.control.result!.sizeError);
  const controlCamera = controlAnswered.map((row) => Math.abs(row.control.result!.cameraHeight - row.scene.cameraHeightM) / row.scene.cameraHeightM);
  const controlSummary = { answered: controlAnswered.length, mape: mean(controlErrors), median: median(controlErrors), max: Math.max(...controlErrors), cameraHeightError: mean(controlCamera) };
  const at = new Date().toISOString();
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(
    path.join(OUT_DIR, "e4-rendered.json"),
    `${JSON.stringify({ generatedAt: at, seed: rendered.seed, model: manifest.model, scenes: rows.length, summaries, control: controlSummary, rows: rows.map((row) => ({ ...row.scene, outcomes: row.outcomes, control: row.control })) }, null, 2)}\n`,
  );

  const byCategory = [...new Set(rows.map((row) => row.scene.category))].map((category) => {
    const errors = rows.filter((row) => row.scene.category === category && row.outcomes[0]!.result !== null).map((row) => row.outcomes[0]!.result!.sizeError);
    return { category, n: rows.filter((row) => row.scene.category === category).length, answered: errors.length, mape: mean(errors) };
  });
  const md = `# E4 (rendered rooms): the paper-free method where the truth is exact

Generated ${at} by \`scripts/evaluate-room-rendered.ts\` (\`pnpm evals:room-rendered\`), model \`${manifest.model}\`,
${rows.length} scenes rendered by \`pnpm e4:render\` (seed ${rendered.seed}).

The web-photo proxy (e4-web.md) has hand marks, manufacturers' heights and low, level product
cameras. Here each piece is one of the catalogue's own 3D scans (Amazon Berkeley Objects, CC BY 4.0)
stood on a plank floor before a wall, lit with soft shadows, and photographed by a virtual phone held
at 1.25–1.55 m and tilted towards it, with a ${rendered.scenes[0]?.fovDegrees ?? 69}° lens at 1600 × 1200. The height is the scan's,
the marks are the projection of the piece's vertical axis, and the camera's height is known. Pieces
were taken by rule: the first four with a stored scan in each category, by ABO id.

## Verdict (the lens the scenes were shot with, as the shop assumes without EXIF)

| Scenes | With an answer | Refused | Mean size error | Median | Within 10% | Mean camera-height error |
|---|---|---|---|---|---|---|
| ${rows.length} | ${shop.answered} | ${shop.refused} | ${pct(shop.mape)} | ${pct(shop.median)} | ${pct(shop.within10, 0)} | ${pct(shop.cameraHeightError)} |

## The control: the same method on exact depth

Each scene is also measured with the renderer's own depth (the distance of every pixel along the
camera's axis, exact) in place of the model's. Whatever error is left there belongs to the method's
geometry and the marks; the difference from the verdict above is the depth model's.

| Depth | With an answer | Mean size error | Median | Worst | Mean camera-height error |
|---|---|---|---|---|---|
| Exact (the renderer's) | ${controlSummary.answered} of ${rows.length} | ${pct(controlSummary.mape)} | ${pct(controlSummary.median)} | ${pct(controlSummary.max)} | ${pct(controlSummary.cameraHeightError)} |
| The model's (the shop) | ${shop.answered} of ${rows.length} | ${pct(shop.mape)} | ${pct(shop.median)} | ${pct(Math.max(...rows.filter((row) => row.outcomes[0]!.result !== null).map((row) => row.outcomes[0]!.result!.sizeError)))} | ${pct(shop.cameraHeightError)} |

**What this says.** With exact depth the method is exact to within the rounding of the marks, so its
geometry — the floor fit, the pose, the vertical through the foot — is not where the error comes from.
With the model's depth the camera is placed ${pct(shop.cameraHeightError)} too high or too low on average, and a piece's
size is wrong by about as much again: a single photograph's metric scale is the model's guess from how
big familiar things look, and on these standing-height, tilted views that guess is less steady than on
the level product photographs of the web-photo proxy. Taller pieces seen close and the beds (a large
pale surface with little texture) are hurt most. This is the case for the room page's A4-sheet mode,
which measures the scale on the floor instead of guessing it, and for saying "about" on a paper-free size.

## Scene by scene

| Scene | Category | Height | Size error | Exact depth | Camera found | Camera true | Floor share |
|---|---|---|---|---|---|---|---|
${rows
  .map((row) => {
    const r = row.outcomes[0]!.result;
    return `| ${row.scene.file} | ${row.scene.category} | ${row.scene.heightCm} cm | ${r === null ? `refused (${row.outcomes[0]!.refused})` : pct(r.sizeError)} | ${row.control.result === null ? `refused (${row.control.refused})` : pct(row.control.result.sizeError)} | ${r === null ? "—" : `${r.cameraHeight.toFixed(2)} m`} | ${row.scene.cameraHeightM.toFixed(2)} m | ${r === null ? "—" : pct(r.floorShare, 0)} |`;
  })
  .join("\n")}

## By category

| Category | Scenes | With an answer | Mean size error |
|---|---|---|---|
${byCategory.map((entry) => `| ${entry.category} | ${entry.n} | ${entry.answered} | ${pct(entry.mape)} |`).join("\n")}

## When the lens is guessed wrong

A phone photograph normally carries its lens in EXIF. Without it the shop assumes 69°; these rows
show what a wrong guess costs on the same scenes, and what the lens correction of the model's
distances is worth.

| Lens assumed | With an answer | Mean size error | Median | Within 10% | Mean camera-height error |
|---|---|---|---|---|---|
${summaries.map((summary) => `| ${summary.corrected ? `${summary.fov}°${summary.id === "true-lens" ? " (true)" : ""}` : `${summary.fov}°, no lens correction`} | ${summary.answered} of ${rows.length} | ${pct(summary.mape)} | ${pct(summary.median)} | ${pct(summary.within10, 0)} | ${pct(summary.cameraHeightError)} |`).join("\n")}

## Limitations

- Renders, not photographs: clean floors, one piece, no clutter. The depth model was trained on
  real photographs and on Hypersim's renders, which look different from these; the domain gap can
  flatter or hurt it, and the web-photo proxy and George's real rooms remain the measurements that count.
- ${rows.length} scenes; the camera heights, distances and angles come from a seed, not from how people hold phones.
- The mark sits on the piece's vertical axis, computed exactly; a shopper's marks carry their own error.

## Reproduce

\`\`\`
pnpm catalog models          # the compressed scans, in .local/storage
pnpm e4:render               # the scenes, in .local/e4-render (never committed)
pnpm evals:room-rendered
\`\`\`
`;
  await writeFile(path.join(OUT_DIR, "e4-rendered.md"), md);
  console.log(`\nExact depth (control): ${pct(controlSummary.mape)} over ${controlSummary.answered}, camera height off by ${pct(controlSummary.cameraHeightError)}.`);
  console.log(`Mean size error with the true lens: ${pct(shop.mape)} over ${shop.answered} of ${rows.length} (refused ${shop.refused}); camera height off by ${pct(shop.cameraHeightError)} on average.`);
  for (const summary of summaries.slice(1)) console.log(`  ${summary.id}: ${pct(summary.mape)} over ${summary.answered}`);
  console.log(`Written ${OUT_DIR}/e4-rendered.md`);
}

main().catch((error: unknown) => {
  process.stderr.write(`[evals:room-rendered] ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exitCode = 1;
});
