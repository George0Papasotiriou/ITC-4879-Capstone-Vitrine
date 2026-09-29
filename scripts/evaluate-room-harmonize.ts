/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Evaluation E4-H: does light harmonisation make a studio photograph look more like the piece truly lit in the room?
 */

/**
 * docs/adr/042.
 *
 *   pnpm e4:render                                        the test rooms (seed 4949)
 *   pnpm e4:render --seed 7100 --out .local/e4-render-dev the development rooms
 *   pnpm evals:room-harmonize [--set test|dev]             this evaluation
 *
 * Two sets of rooms, kept apart: the method was chosen and changed while
 * looking only at the development rooms (other floors, walls, cameras and
 * lights); the test rooms were measured once, with the method as it stood.
 *
 * For each rendered room the renderer made, from the same camera: the piece
 * truly lit in the room (the truth), the room without it (what a shopper
 * photographs), the piece under neutral studio light (the product
 * photograph), and its exact outline. The shop's harmonisation reads the
 * room photo only — never the truth — and its matrix is applied to the studio
 * photograph. Over the outline's pixels, the colour difference to the truth
 * (CIEDE2000, src/lib/vision/delta-e.ts) is measured three ways:
 *
 *   plain       the studio photograph as it is (what the planner showed before)
 *   harmonised  after the shop's matrix
 *   oracle      after the best diagonal matrix possible, fitted to the truth by
 *               least squares in linear light — the most any per-channel
 *               correction could do, so the harmonised result can be judged
 *               against what is reachable, not against zero.
 *
 * Writes docs/report/evaluations/e4-harmonize.md and .json.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import sharp from "sharp";

import { rgbToLab } from "@/lib/optimize/color";
import { deltaE2000 } from "@/lib/vision/delta-e";
import { applyMatrix, estimateLight, harmonizeMatrix, toLinear, toSrgb } from "@/lib/vision/harmonize";

import { manifestIn, RENDER_DIR, type RenderedScene } from "./render-room-scenes";

const OUT_DIR = path.join("docs", "report", "evaluations");
const STEP = 2;
const { values } = parseArgs({ options: { set: { type: "string", default: "test" } } });
const SET = values.set === "dev" ? "dev" : "test";
const DIR = SET === "dev" ? path.join(".local", "e4-render-dev") : RENDER_DIR;
const NAME = SET === "dev" ? "e4-harmonize-dev" : "e4-harmonize";

async function rgba(file: string) {
  const { data, info } = await sharp(await readFile(path.join(DIR, file))).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8ClampedArray(data), width: info.width, height: info.height };
}

const mean = (values: number[]) => (values.length === 0 ? Number.NaN : values.reduce((sum, value) => sum + value, 0) / values.length);
const lightName = (colour: number) => (colour === 0xffc58f ? "warm lamp" : colour === 0xd6e6ff ? "cool daylight" : "neutral bulb");

async function main(): Promise<void> {
  const rendered = JSON.parse(await readFile(manifestIn(DIR), "utf8")) as { seed: number; scenes: RenderedScene[] };
  const rows: { file: string; category: string; light: string; level: number; pixels: number; plain: number; harmonised: number; oracle: number; exposure: number; tint: number[] }[] = [];

  for (const scene of rendered.scenes) {
    if (scene.harmonise === undefined) continue;
    const [truth, room, studio, mask] = await Promise.all([rgba(scene.harmonise.truth), rgba(scene.harmonise.room), rgba(scene.harmonise.studio), rgba(scene.harmonise.mask)]);
    const { width, height } = room;
    const heightPx = Math.hypot(scene.top[0] - scene.base[0], scene.top[1] - scene.base[1]);
    // The shop's estimate, from the room photo alone.
    const light = estimateLight(room.data, width, height, scene.base, Math.max(24, heightPx * 0.6), 3);
    const gains = harmonizeMatrix(light);
    const harmonised = Uint8ClampedArray.from(studio.data);
    applyMatrix(harmonised, gains);

    // The piece's pixels: where the outline is white, sampled every other pixel.
    const at: number[] = [];
    for (let y = 0; y < height; y += STEP) for (let x = 0; x < width; x += STEP) if (mask.data[(y * width + x) * 4]! > 100) at.push((y * width + x) * 4);
    if (at.length < 50) continue;

    // The oracle: per channel, the gain g minimising Σ (truth − g · studio)² in linear light.
    const oracleGains = [0, 1, 2].map((c) => {
      let num = 0;
      let den = 0;
      for (const i of at) {
        const s = toLinear(studio.data[i + c]!);
        num += s * toLinear(truth.data[i + c]!);
        den += s * s;
      }
      return den === 0 ? 1 : num / den;
    });
    const difference = (pixels: Uint8ClampedArray | ((i: number) => [number, number, number])) =>
      mean(
        at.map((i) => {
          const colour: [number, number, number] = typeof pixels === "function" ? pixels(i) : [pixels[i]!, pixels[i + 1]!, pixels[i + 2]!];
          return deltaE2000(rgbToLab(colour), rgbToLab([truth.data[i]!, truth.data[i + 1]!, truth.data[i + 2]!]));
        }),
      );
    const oracle = (i: number): [number, number, number] => [0, 1, 2].map((c) => toSrgb(toLinear(studio.data[i + c]!) * oracleGains[c]!)) as [number, number, number];

    const row = {
      file: scene.file,
      category: scene.category,
      light: lightName(scene.light.colour),
      level: scene.light.level,
      pixels: at.length,
      plain: difference(studio.data),
      harmonised: difference(harmonised),
      oracle: difference(oracle),
      exposure: Math.round(light.exposure * 100) / 100,
      tint: light.tint.map((gain) => Math.round(gain * 100) / 100),
    };
    rows.push(row);
    console.log(`${scene.file.padEnd(22)} ${row.light.padEnd(13)} ΔE plain ${row.plain.toFixed(1).padStart(5)}  harmonised ${row.harmonised.toFixed(1).padStart(5)}  oracle ${row.oracle.toFixed(1).padStart(5)}`);
  }
  if (rows.length === 0) throw new Error(`No scenes with E4-H images in ${DIR}. Run \`pnpm e4:render\` first.`);

  const summary = {
    scenes: rows.length,
    plain: mean(rows.map((row) => row.plain)),
    harmonised: mean(rows.map((row) => row.harmonised)),
    oracle: mean(rows.map((row) => row.oracle)),
    better: rows.filter((row) => row.harmonised < row.plain).length,
  };
  const reduction = (summary.plain - summary.harmonised) / summary.plain;
  const reachable = (summary.plain - summary.harmonised) / Math.max(1e-9, summary.plain - summary.oracle);
  const byLight = ["warm lamp", "neutral bulb", "cool daylight"].map((name) => {
    const group = rows.filter((row) => row.light === name);
    return { light: name, scenes: group.length, plain: mean(group.map((row) => row.plain)), harmonised: mean(group.map((row) => row.harmonised)), oracle: mean(group.map((row) => row.oracle)) };
  });
  const at = new Date().toISOString();
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(path.join(OUT_DIR, `${NAME}.json`), `${JSON.stringify({ generatedAt: at, set: SET, seed: rendered.seed, summary, reduction, reachable, byLight, rows }, null, 2)}\n`);
  const f = (value: number) => (Number.isNaN(value) ? "—" : value.toFixed(1));
  const md = [
    `# E4-H: does light harmonisation make the piece look lit by the room? (${SET === "dev" ? "development rooms" : "test rooms"})`,
    "",
    `Generated ${at} by \`scripts/evaluate-room-harmonize.ts\` (\`pnpm evals:room-harmonize --set ${SET}\`), ${rows.length} rendered rooms (seed ${rendered.seed}).`,
    "",
    SET === "dev"
      ? "These are the DEVELOPMENT rooms: the method was chosen and changed while looking at them, so this table flatters it. Report the test rooms' table (e4-harmonize.md)."
      : "These are the TEST rooms: the method was chosen on separate development rooms (seed 7100, `--set dev`) and measured here as it stood. The first version (gray world) scored 7.9 here against 8.2 plain, better in 12 of 24; docs/adr/042 explains the change.",
    "",
    "Each room was rendered four ways from one camera: the piece truly lit in the room (the truth), the room without it, the piece under neutral studio light (the product photograph) and its outline. The shop's harmonisation (src/lib/vision/harmonize.ts) reads only the room without the piece. The table gives the mean CIEDE2000 difference to the truth over the piece's pixels: about 1 is just noticeable, 2–3 visible side by side, 10 a different colour.",
    "",
    "| | Plain studio photo | Harmonised | Best possible (oracle) |",
    "|---|---|---|---|",
    `| Mean ΔE2000 over ${rows.length} rooms | ${f(summary.plain)} | ${f(summary.harmonised)} | ${f(summary.oracle)} |`,
    "",
    `Harmonisation lowers the difference by **${(reduction * 100).toFixed(0)}%**, closer to the truth in ${summary.better} of ${rows.length} rooms, and closes **${(reachable * 100).toFixed(0)}%** of the gap a per-channel correction can close at all (the oracle is fitted to the truth itself, which the shop never sees).`,
    "",
    "## By the room's light",
    "",
    "| Light | Rooms | Plain | Harmonised | Oracle |",
    "|---|---|---|---|---|",
    ...byLight.map((group) => `| ${group.light} | ${group.scenes} | ${f(group.plain)} | ${f(group.harmonised)} | ${f(group.oracle)} |`),
    "",
    "## Room by room",
    "",
    "| Scene | Category | Light | Strength | Plain | Harmonised | Oracle | Exposure | Tint (R, G, B) |",
    "|---|---|---|---|---|---|---|---|---|",
    ...rows.map((row) => `| ${row.file} | ${row.category} | ${row.light} | ${row.level.toFixed(2)} | ${f(row.plain)} | ${f(row.harmonised)} | ${f(row.oracle)} | ${row.exposure} | ${row.tint.join(", ")} |`),
    "",
    "## Limitations",
    "",
    "- Renders, with the piece seen from the same camera in the studio and in the room: a real product photograph is taken from another angle, which this measurement leaves out on purpose to isolate the light.",
    "- A diagonal matrix can change a colour's balance and brightness, not its shading: the oracle row is the ceiling for any such method, and the rest of the difference is shading and reflections, which a relighting model would need.",
    "- The rooms' lights are three colours at five strengths chosen by seed, not measured rooms.",
    "",
  ].join("\n");
  await writeFile(path.join(OUT_DIR, `${NAME}.md`), md);
  console.log(`\nMean ΔE2000: plain ${f(summary.plain)}, harmonised ${f(summary.harmonised)}, oracle ${f(summary.oracle)}; better in ${summary.better} of ${rows.length}.`);
}

main().catch((error: unknown) => {
  process.stderr.write(`[evals:room-harmonize] ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exitCode = 1;
});
