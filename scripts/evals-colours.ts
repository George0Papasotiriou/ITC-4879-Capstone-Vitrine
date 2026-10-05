/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * E15: does the colour reading stay the same when the lamp changes? AFLW2000's faces under warm, cold and dim light, with and without the whites of the eyes correcting it.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import sharp from "sharp";

import type { Point2 } from "@/lib/vision/camera";
import { readColours, type ColourReading, type Season } from "@/lib/vision/colour-season";
import { toLinear, toSrgb } from "@/lib/vision/harmonize";
import { CANONICAL_FACE_MM } from "@/lib/vision/mirror/face-model";
import { frameIntrinsics, headAngles, solveHeadPose } from "@/lib/vision/mirror/pose";

/**
 * docs/adr/066, docs/report/evaluations/e15-colours.md.
 *
 *   pnpm evals:colours        (after pnpm evals:mirror has cached the landmarks)
 *
 * No dataset labels anyone's "season", so the reading's accuracy cannot be
 * measured; its stability can. Each face (landmarks found, turned less than
 * 25° so both eyes show) is read as photographed, then under three lamps
 * applied in linear light: warm (about 3,000 K: red ×1.25, blue ×0.65),
 * cold (about 7,500 K: red ×0.85, blue ×1.25) and dim (half the light).
 * Measured: how often the season stays the same, and how far the skin's hue
 * angle moves, with the whites of the eyes correcting the light and without.
 */

const DATA = resolve(".local/headpose/AFLW2000");
const CACHE = resolve(".local/headpose/landmarks.json");
const OUT = resolve("docs/report/evaluations/e15-colours");

type Detection = { name: string; width: number; height: number; landmarks: [number, number, number][] | null };

const LAMPS: Record<string, [number, number, number]> = { warm: [1.25, 1, 0.65], cold: [0.85, 1, 1.25], dim: [0.5, 0.5, 0.5] };

function underLamp(rgba: Uint8ClampedArray, gains: readonly [number, number, number]): Uint8ClampedArray {
  const tables = gains.map((gain) => Array.from({ length: 256 }, (_, value) => toSrgb(toLinear(value) * gain)));
  const out = new Uint8ClampedArray(rgba.length);
  for (let i = 0; i < rgba.length; i += 4) {
    out[i] = tables[0]![rgba[i]!]!;
    out[i + 1] = tables[1]![rgba[i + 1]!]!;
    out[i + 2] = tables[2]![rgba[i + 2]!]!;
    out[i + 3] = 255;
  }
  return out;
}

async function main() {
  if (!existsSync(CACHE)) throw new Error("No cached landmarks: run pnpm evals:mirror first.");
  const detections = (JSON.parse(readFileSync(CACHE, "utf8")) as Detection[]).filter((detection) => detection.landmarks !== null);
  const faces: { name: string; pixels: Point2[] }[] = [];
  for (const detection of detections) {
    const pixels = detection.landmarks!.map(([x, y]) => [x * detection.width, y * detection.height] as Point2);
    const K = frameIntrinsics(detection.width, detection.height, 35);
    const pose = solveHeadPose(pixels.slice(0, 468), CANONICAL_FACE_MM, K);
    if (pose !== null && Math.abs(headAngles(pose.R).yaw) < 25) faces.push({ name: detection.name, pixels });
  }
  console.log(`${faces.length} faces turned less than 25°`);

  type Row = { name: string; base: Record<"wb" | "raw", ColourReading | null>; lamps: Record<string, Record<"wb" | "raw", ColourReading | null>> };
  const rows: Row[] = [];
  for (const [index, face] of faces.entries()) {
    const { data, info } = await sharp(join(DATA, face.name)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const rgba = new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength);
    const read = (pixels: Uint8ClampedArray, whiteBalance: boolean) => readColours({ rgba: pixels, width: info.width, height: info.height }, face.pixels, { whiteBalance });
    const row: Row = { name: face.name, base: { wb: read(rgba, true), raw: read(rgba, false) }, lamps: {} };
    for (const [lamp, gains] of Object.entries(LAMPS)) {
      const lit = underLamp(rgba, gains);
      row.lamps[lamp] = { wb: read(lit, true), raw: read(lit, false) };
    }
    rows.push(row);
    if ((index + 1) % 200 === 0) console.log(`  ${index + 1}/${faces.length}`);
  }

  const results: Record<string, Record<"wb" | "raw", { same: number; hueShift: number; n: number }>> = {};
  for (const lamp of Object.keys(LAMPS)) {
    results[lamp] = { wb: { same: 0, hueShift: 0, n: 0 }, raw: { same: 0, hueShift: 0, n: 0 } };
    for (const mode of ["wb", "raw"] as const) {
      const pairs = rows.map((row) => [row.base[mode], row.lamps[lamp]![mode]] as const).filter((pair): pair is [ColourReading, ColourReading] => pair[0] !== null && pair[1] !== null);
      const same = pairs.filter(([a, b]) => a.season === b.season).length / Math.max(1, pairs.length);
      const shift = pairs.reduce((sum, [a, b]) => sum + Math.abs(((((b.hue - a.hue + 180) % 360) + 360) % 360) - 180), 0) / Math.max(1, pairs.length);
      results[lamp]![mode] = { same, hueShift: shift, n: pairs.length };
      console.log(`  ${lamp.padEnd(5)} ${mode === "wb" ? "eyes correct the light" : "no correction         "}  season unchanged ${(same * 100).toFixed(1)}%  skin hue moved ${shift.toFixed(1)}° (${pairs.length} faces)`);
    }
  }
  const seasons: Record<Season, number> = { spring: 0, summer: 0, autumn: 0, winter: 0 };
  for (const row of rows) if (row.base.wb !== null) seasons[row.base.wb.season] += 1;
  const balanced = rows.filter((row) => row.base.wb?.whiteBalanced === true).length;
  console.log("  seasons as photographed:", seasons, `; light corrected on ${balanced} of ${rows.length}`);
  writeFileSync(`${OUT}.json`, `${JSON.stringify({ ranAt: new Date().toISOString(), faces: rows.length, lamps: LAMPS, results, seasons, whiteBalanced: balanced }, null, 2)}\n`);
  console.log(`Written ${OUT}.json`);
}

void main();
