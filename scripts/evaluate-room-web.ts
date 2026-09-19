/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Evaluation E4 (web photos): runs the installed depth model on twelve published room photos of pieces with a known height.
 */

/**
 * A proxy for the real-photo half of evaluation E4, while George's own twelve
 * rooms (with the A4 sheet and a tape-measured object) are still to be taken.
 *
 *   pnpm evals:room-web              download what is missing, measure, write the report
 *   pnpm evals:room-web --dry-run    say what would be downloaded, measure nothing
 *   pnpm evals:room-web --limit 3    only the first three photos
 *   pnpm evals:room-web --overlay    also draw the marks and the prediction on each photo (.local only)
 *
 * THE PHOTOS. Twelve lifestyle photographs from the Amazon Berkeley Objects
 * dataset (CC BY-NC 4.0): real rooms, each with a piece whose listing gives its
 * height. They were chosen for a clean ground truth — a vertical edge from the
 * floor to the top, a visible foot — and marked by hand; the marks are below.
 * The photos are downloaded into `.local/e4-web/` and never committed.
 *
 * WHAT IT MEASURES. Only the paper-free method (no sheet lies on these floors),
 * run exactly as the room page runs it: the same letterbox, the same model file,
 * the same floor finder and the same verdict. The size error is the one in
 * `src/lib/vision/e4.ts`.
 *
 * WHY IT IS ONLY A PROXY. The heights are the manufacturer's, not a tape's; the
 * photos carry no EXIF, so the lens is the app's 69° assumption, which product
 * photography (often a longer lens, then cropped square) does not respect; and
 * some are renders rather than photographs. A second table repeats the
 * measurement at other fields of view, to show how much of the error is the
 * lens guess rather than the depth.
 *
 * Writes docs/report/evaluations/e4-web.md and .json.
 */

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import * as ort from "onnxruntime-web";
import sharp from "sharp";

import { ABO_BUCKET, ABO_LICENSE } from "@/lib/catalog/abo";
import { seededRandom } from "@/lib/reco/simulate";
import { focalFromFov, intrinsics, type Point2 } from "@/lib/vision/camera";
import { floorFromDepth, judgeFloor } from "@/lib/vision/depth";
import { depthToPhoto, letterbox } from "@/lib/vision/depth-image";
import { measureWithPose, type E4MethodResult } from "@/lib/vision/e4";

const MODEL_DIR = path.join("public", "models", "depth");
const PHOTO_DIR = path.join(".local", "e4-web");
const OUT_DIR = path.join("docs", "report", "evaluations");
/** The measuring bench's working size: large enough to mark, small enough for the depth map. */
const MAX_SIDE = 2048;
/** What the room page assumes when a photo has no EXIF. */
const APP_FOV = 69;
/**
 * The ways each photo is measured. The first is what the shop does; the others
 * change one thing each: the lens assumed (a phone's main camera is about 69°,
 * product photography often 40–55°), or leaving the model's distances as it
 * gives them instead of correcting them for the lens (DepthMap.focal).
 */
const VARIANTS = [
  { id: "shop", fov: APP_FOV, corrected: true },
  { id: "lens-60", fov: 60, corrected: true },
  { id: "lens-50", fov: 50, corrected: true },
  { id: "lens-40", fov: 40, corrected: true },
  { id: "uncorrected", fov: APP_FOV, corrected: false },
] as const;
/**
 * The same twelve photos measured on 2026-09-19 with the floor finder as it was
 * before this evaluation (RANSAC restricted to planes within the tilt limit, the
 * farthest candidate taken as the floor) and without the lens correction. That
 * code is gone, so the numbers are recorded rather than recomputed.
 */
const BEFORE = { answered: 8, refused: 4, mape: 0.532 };
const TARGET = 0.1;

type WebPhoto = {
  /** ABO listing and image, so the photo can be fetched again and cited. */
  sourceId: string;
  imageId: string;
  /** Path inside the dataset's `images/original/` folder. */
  aboPath: string;
  piece: string;
  /** Height from the listing, centimetres. */
  heightCm: number;
  /** Hand-marked, in the original photo's pixels: where the piece meets the floor, and its top directly above. */
  base: Point2;
  top: Point2;
  note?: string;
};

/**
 * The marks. Each pair follows one vertical edge of the piece — a wardrobe's
 * front corner, a table's front leg — from the floor to the top surface, read
 * off a zoomed grid at 10-pixel spacing. Where the top surface is seen from
 * above, the mark sits on the edge nearest the camera, which is the point above
 * the marked foot to within a few pixels (about 1% of the height).
 */
export const WEB_PHOTOS: readonly WebPhoto[] = [
  { sourceId: "B07B3XXD3P", imageId: "81-xvMdJoNL", aboPath: "5e/5ef645cc.jpg", piece: "wardrobe", heightCm: 178, base: [850, 1849], top: [850, 223] },
  { sourceId: "B07B3XXD3P", imageId: "811DmFwz9kL", aboPath: "85/851fdd90.jpg", piece: "wardrobe, doors open", heightCm: 178, base: [830, 1851], top: [830, 221] },
  {
    sourceId: "B07QC85X9C",
    imageId: "913oT8UMBiL",
    aboPath: "bb/bbb6ecc1.jpg",
    piece: "bookcase",
    heightCm: 183,
    base: [1060, 2445],
    top: [1060, 422],
    note: "only a strip of floor in view",
  },
  { sourceId: "B07QD6V1VT", imageId: "91hM+Dv6iyL", aboPath: "dd/ddb437b2.jpg", piece: "desk", heightCm: 76, base: [540, 2028], top: [540, 882] },
  { sourceId: "B07MM5H3HX", imageId: "91qvy9m8BLL", aboPath: "94/94d4757e.jpg", piece: "console table", heightCm: 76, base: [1870, 2468], top: [1870, 1112] },
  { sourceId: "B082JH6LSF", imageId: "81UQeN529cL", aboPath: "74/745dd521.jpg", piece: "filing cabinet", heightCm: 60, base: [1693, 1799], top: [1700, 1265] },
  { sourceId: "B07DBFT2YG", imageId: "91Zyr3pygsL", aboPath: "d4/d42f6e0c.jpg", piece: "coffee table", heightCm: 51, base: [1198, 2240], top: [1198, 1714] },
  { sourceId: "B072ZLCB3M", imageId: "A1OdfC9iHhL", aboPath: "bc/bcc8aed7.jpg", piece: "side table", heightCm: 48, base: [1755, 2368], top: [1755, 1789] },
  {
    sourceId: "B072ZLCB3M",
    imageId: "91A-nCul3fL",
    aboPath: "69/694d4c3c.jpg",
    piece: "side table, close-up",
    heightCm: 48,
    base: [1000, 2515],
    top: [1000, 948],
    note: "leg sinks into a shag rug",
  },
  { sourceId: "B075X61WKJ", imageId: "91gw1bHlK7L", aboPath: "a0/a09f43c8.jpg", piece: "round ottoman", heightCm: 44, base: [1060, 2282], top: [1060, 1572], note: "domed cushion" },
  { sourceId: "B07MBFDHRY", imageId: "A1fHDcWb1RL", aboPath: "0b/0b5ad456.jpg", piece: "garden stool", heightCm: 41, base: [810, 2226], top: [810, 1648] },
  {
    sourceId: "B07QFRSLZB",
    imageId: "A15d9SYHqOL",
    aboPath: "24/24f6fd2f.jpg",
    piece: "dining chair",
    heightCm: 90,
    base: [60, 2330],
    top: [18, 1257],
    note: "rear leg and backrest both lean back",
  },
];

type Manifest = {
  model: string;
  sha256: string;
  inputSize: number;
  inputName?: string;
  outputName?: string;
  output: string;
  compression?: string;
  canonicalFocal?: number;
};

type PhotoResult = {
  file: string;
  sourceId: string;
  imageId: string;
  piece: string;
  heightCm: number;
  width: number;
  height: number;
  note?: string;
  modelMs: number;
  /** One entry per VARIANTS, in the same order. */
  byVariant: {
    id: (typeof VARIANTS)[number]["id"];
    result: (E4MethodResult & { floorShare: number; planeRmsRelative: number; tiltDegrees: number; lensFactor: number }) | null;
    refused: string | null;
  }[];
};

const flag = (name: string) => process.argv.includes(name);
function numberAfter(name: string): number | null {
  const at = process.argv.indexOf(name);
  return at === -1 ? null : Number(process.argv[at + 1]);
}
const pct = (value: number | null | undefined, digits = 1) =>
  value === null || value === undefined || Number.isNaN(value) ? "—" : `${(value * 100).toFixed(digits)}%`;
const mean = (values: number[]) => (values.length === 0 ? Number.NaN : values.reduce((sum, value) => sum + value, 0) / values.length);

function fileFor(photo: WebPhoto): string {
  return path.join(PHOTO_DIR, `${photo.sourceId.toLowerCase()}-${photo.imageId.toLowerCase()}.jpg`);
}

async function ensurePhoto(photo: WebPhoto): Promise<Buffer> {
  const file = fileFor(photo);
  if (existsSync(file)) return readFile(file);
  const response = await fetch(`${ABO_BUCKET}/images/original/${photo.aboPath}`);
  if (!response.ok) throw new Error(`Could not download ${photo.aboPath}: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  await mkdir(PHOTO_DIR, { recursive: true });
  await writeFile(file, bytes);
  return bytes;
}

async function loadModel(): Promise<{ session: ort.InferenceSession; manifest: Manifest }> {
  const manifestPath = path.join(MODEL_DIR, "manifest.json");
  if (!existsSync(manifestPath)) {
    throw new Error("No depth model installed in public/models/depth. See `pnpm depth-model` and research/export_depth_model.py.");
  }
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Manifest;
  const bytes = await readFile(path.join(MODEL_DIR, manifest.model));
  // The same integrity check the browser does: the file measured is the file shipped.
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== manifest.sha256) throw new Error(`The installed model does not match its manifest (sha256 ${digest.slice(0, 16)}…)`);
  ort.env.wasm.numThreads = 1;
  const session = await ort.InferenceSession.create(bytes, { executionProviders: ["wasm"] });
  return { session, manifest };
}

/** The marks moved onto the photo as measured (reduced to MAX_SIDE, like the bench). */
function scaled(point: Point2, factor: number): Point2 {
  return [point[0] * factor, point[1] * factor];
}

/**
 * A 1000-pixel copy of the photo with the marks (green) and where the model's
 * camera puts the top of the piece (orange), for checking the marks by eye.
 * `predictedPx` is in the measured photo's pixels, `factor` from the original.
 */
async function drawOverlay(photo: WebPhoto, bytes: Buffer, factor: number, predictedPx: number | null) {
  const meta = await sharp(bytes).metadata();
  const view = 1000 / Math.max(meta.width!, meta.height!);
  const width = Math.round(meta.width! * view);
  const height = Math.round(meta.height! * view);
  const [bx, by] = scaled(photo.base, view);
  const [tx, ty] = scaled(photo.top, view);
  const length = Math.hypot(tx - bx, ty - by);
  const marks = [
    `<line x1="${bx}" y1="${by}" x2="${tx}" y2="${ty}" stroke="#18e070" stroke-width="3"/>`,
    `<circle cx="${bx}" cy="${by}" r="7" fill="none" stroke="#18e070" stroke-width="3"/>`,
    `<circle cx="${tx}" cy="${ty}" r="7" fill="none" stroke="#18e070" stroke-width="3"/>`,
  ];
  if (predictedPx !== null) {
    const along = (predictedPx / factor) * view;
    const px = bx + ((tx - bx) / length) * along;
    const py = by + ((ty - by) / length) * along;
    marks.push(`<line x1="${px - 30}" y1="${py}" x2="${px + 30}" y2="${py}" stroke="#ff8a1f" stroke-width="4"/>`);
  }
  const svg = Buffer.from(`<svg width="${width}" height="${height}">${marks.join("")}</svg>`);
  const resized = await sharp(bytes).resize(width, height).toBuffer();
  await mkdir(path.join(PHOTO_DIR, "marked"), { recursive: true });
  await sharp(resized)
    .composite([{ input: svg, top: 0, left: 0 }])
    .jpeg({ quality: 82 })
    .toFile(path.join(PHOTO_DIR, "marked", path.basename(fileFor(photo))));
}

async function main() {
  const limit = numberAfter("--limit");
  const photos = WEB_PHOTOS.slice(0, limit ?? WEB_PHOTOS.length);
  const missing = photos.filter((photo) => !existsSync(fileFor(photo)));

  if (flag("--dry-run")) {
    console.log(`${photos.length} photos; ${missing.length} to download from the ABO bucket (about 1 MB each, ${ABO_LICENSE}).`);
    for (const photo of missing) console.log(`  ${photo.sourceId} ${photo.imageId}  ${photo.piece}`);
    console.log(existsSync(path.join(MODEL_DIR, "manifest.json")) ? "Depth model: installed." : "Depth model: NOT installed (pnpm depth-model).");
    return;
  }

  const { session, manifest } = await loadModel();
  const inputName = manifest.inputName ?? session.inputNames[0]!;
  const outputName = manifest.outputName ?? session.outputNames[0]!;
  const metric = manifest.output === "metric_depth";
  console.log(`Model ${manifest.model} (${manifest.compression ?? "fp32"}), ${photos.length} photos\n`);

  const results: PhotoResult[] = [];
  for (const photo of photos) {
    const bytes = await ensurePhoto(photo);
    const meta = await sharp(bytes).metadata();
    const factor = Math.min(1, MAX_SIDE / Math.max(meta.width!, meta.height!));
    const { data, info } = await sharp(bytes)
      .resize(Math.round(meta.width! * factor), Math.round(meta.height! * factor))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const started = performance.now();
    const box = letterbox(data, info.width, info.height, manifest.inputSize);
    const output = await session.run({ [inputName]: new ort.Tensor("float32", box.tensor, [1, 3, box.size, box.size]) });
    const values = output[outputName]!.data as Float32Array;
    const mapped = depthToPhoto(values, box, info.width, info.height);
    // As the room page does: the training camera's focal length, in this photo's pixels.
    const depth = manifest.canonicalFocal === undefined ? mapped : { ...mapped, focal: manifest.canonicalFocal * box.scale };
    const modelMs = performance.now() - started;

    const marks = { sheet: [], base: scaled(photo.base, factor), top: scaled(photo.top, factor), objectHeightCm: photo.heightCm };
    const byVariant: PhotoResult["byVariant"] = VARIANTS.map(({ id, fov, corrected }) => {
      const K = intrinsics(focalFromFov(fov, Math.max(info.width, info.height)), info.width, info.height);
      // Seeded, so the report is the same on every run; the page uses Math.random.
      const floor = floorFromDepth(corrected ? depth : mapped, K, { metric, cameraHeight: 1.4, random: seededRandom(4949) });
      const verdict = judgeFloor(floor);
      if (floor === null || !verdict.ok) return { id, result: null, refused: verdict.reason ?? "no_floor" };
      const result = measureWithPose(K, floor.pose, marks, floor.cameraHeight);
      if (result === null) return { id, result: null, refused: "foot_beyond_horizon" };
      return {
        id,
        result: {
          ...result,
          floorShare: floor.floorShare,
          planeRmsRelative: floor.planeRmsRelative,
          tiltDegrees: floor.tiltDegrees,
          lensFactor: floor.lensFactor,
        },
        refused: null,
      };
    });

    const app = byVariant[0]!;
    console.log(
      `${photo.piece.padEnd(22)} ${String(photo.heightCm).padStart(3)} cm  ${app.result === null ? `refused (${app.refused})` : `error ${pct(app.result.sizeError).padStart(6)}  camera ${app.result.cameraHeight.toFixed(2)} m`}  ${Math.round(modelMs)} ms`,
    );
    if (flag("--overlay")) await drawOverlay(photo, bytes, factor, app.result?.predictedPx ?? null);
    results.push({
      file: path.basename(fileFor(photo)),
      sourceId: photo.sourceId,
      imageId: photo.imageId,
      piece: photo.piece,
      heightCm: photo.heightCm,
      width: info.width,
      height: info.height,
      note: photo.note,
      modelMs,
      byVariant,
    });
  }
  await session.release();

  const summaries = VARIANTS.map(({ id, fov, corrected }, index) => {
    const answered = results.map((result) => result.byVariant[index]!.result).filter((result) => result !== null);
    const errors = answered.map((result) => result.sizeError).sort((a, b) => a - b);
    return {
      id,
      fov,
      corrected,
      answered: answered.length,
      refused: results.length - answered.length,
      mape: mean(errors),
      median: errors.length === 0 ? Number.NaN : errors[Math.floor(errors.length / 2)]!,
      within10: errors.length === 0 ? Number.NaN : errors.filter((error) => error <= TARGET).length / errors.length,
      meanCameraHeight: mean(answered.map((result) => result.cameraHeight)),
    };
  });
  const app = summaries[0]!;
  const uncorrected = summaries.find((summary) => !summary.corrected)!;
  const lensRange = summaries.filter((summary) => summary.corrected);

  const report = {
    generatedAt: new Date().toISOString(),
    model: { file: manifest.model, compression: manifest.compression ?? "fp32", sha256: manifest.sha256 },
    photos: results.length,
    before: BEFORE,
    summaries,
    results,
  };

  const md = `# E4 (web photos): the paper-free method on published room photographs

Generated ${report.generatedAt} by \`scripts/evaluate-room-web.ts\` (\`pnpm evals:room-web\`).
Model: \`${manifest.model}\` (${report.model.compression}, sha256 \`${manifest.sha256.slice(0, 16)}…\`), run on the CPU
exactly as the room page runs it.

**This is a proxy, not the plan's E4.** The plan asks for twelve of George's own rooms with an A4
sheet on the floor and an object measured with a tape (\`pnpm evals:room-real\`). Until those are
taken, this measures the paper-free method on twelve published room photographs (Amazon Berkeley
Objects, ${ABO_LICENSE}) of pieces whose listing gives their height. Three things make it harder
than the real test, and one makes it easier:

- the heights are the manufacturer's, not a tape's (a domed cushion or a shag rug moves them by a centimetre or two);
- the photos carry no EXIF, so the lens is the app's ${APP_FOV}° assumption, while product photography
  often uses a longer lens and is then cropped square;
- the pieces were marked by hand on a zoomed grid, about ±1% of each height;
- but the rooms are tidy and well lit, and most of them look like the computer renders furniture
  retailers use (only the close-up side table and the ottoman are clearly photographs). Renders are
  closer to what the model was trained on — Hypersim is rendered too — which may flatter it.

## Verdict (what the shop would show, lens assumed at ${APP_FOV}°)

| Photos | With an answer | Refused | Mean size error | Median | Within 10% | Target (≤ 10%) |
|---|---|---|---|---|---|---|
| ${results.length} | ${app.answered} | ${app.refused} | ${pct(app.mape)} | ${pct(app.median)} | ${pct(app.within10, 0)} | ${app.answered > 0 && app.mape <= TARGET ? "met on this proxy" : "not met"} |

## Photo by photo (lens assumed at ${APP_FOV}°)

| Piece | Height | Size error | Camera height | Distance | Camera tilt | Floor share | Note |
|---|---|---|---|---|---|---|---|
${results
  .map((result) => {
    const at = result.byVariant[0]!;
    const r = at.result;
    return `| ${result.piece} | ${result.heightCm} cm | ${r === null ? `refused (${at.refused})` : pct(r.sizeError)} | ${r === null ? "—" : `${r.cameraHeight.toFixed(2)} m`} | ${r === null ? "—" : `${r.distance.toFixed(2)} m`} | ${r === null ? "—" : `${r.tiltDegrees.toFixed(0)}°`} | ${r === null ? "—" : pct(r.floorShare, 0)} | ${result.note ?? ""} |`;
  })
  .join("\n")}

The camera heights (about 0.6 to 1.05 m) are low for a person holding a phone and ordinary for
product photography, which is shot from waist height so the piece is seen level. A refusal is the
method declining to place anything, which the shop then says, rather than a wrong size.

## What this evaluation changed

The first run on these photos gave a mean size error of ${pct(BEFORE.mape)} over ${BEFORE.answered} photos, with
${BEFORE.refused} refused. Two faults were behind it, both now fixed in \`src/lib/vision/depth.ts\`:

1. **A wall taken for the floor.** RANSAC was told to consider only planes within 70° of level. Shown
   a back wall it could not have, it returned the steepest plane it was allowed — a band of wall
   points cut at exactly 70° — and since that band is further from the camera than the floor is
   below it, the "lowest plane" rule chose it. Planes are now fitted freely (a wall comes out as a
   wall) and the floor is chosen only among planes parallel to the most level one.
2. **The model's camera.** Depth Anything V2 Metric Indoor was fine-tuned on Hypersim, rendered with
   a 60° lens; on its 518-pixel input that lens is 598 px. It judges distance largely by how big
   familiar things look *through that lens*, so on a photo from any other lens every distance is off
   by the ratio of the focal lengths. The depth the model gave at each marked piece implies the lens
   that would make the piece its listed height; across these twelve photos that lens came out at a
   median of 47.5°, against 46.8° for the training camera. The room page now multiplies the model's
   distances by f_photo / f_model (Metric3D's canonical-camera transformation, Yin et al. 2023),
   with f_model recorded in the model's manifest.

The effect of the second fix alone, measured now on the same depth maps:

| Distances | With an answer | Mean size error | Median | Within 10% |
|---|---|---|---|---|
| As the model gives them (no lens correction) | ${uncorrected.answered} of ${results.length} | ${pct(uncorrected.mape)} | ${pct(uncorrected.median)} | ${pct(uncorrected.within10, 0)} |
| Corrected for the lens (the shop) | ${app.answered} of ${results.length} | ${pct(app.mape)} | ${pct(app.median)} | ${pct(app.within10, 0)} |

## How much the lens guess still matters

With the correction, the lens assumed hardly matters for a photo taken level: a longer lens makes
the room shallower and the piece's pixels bigger by the same factor, and the two cancel. It matters
again only as the camera tilts, through the floor's slope.

| Lens assumed | With an answer | Mean size error | Median | Within 10% | Mean camera height |
|---|---|---|---|---|---|
${lensRange
  .map(
    (summary) =>
      `| ${summary.fov}°${summary.id === "shop" ? " (the shop)" : ""} | ${summary.answered} of ${results.length} | ${pct(summary.mape)} | ${pct(summary.median)} | ${pct(summary.within10, 0)} | ${Number.isNaN(summary.meanCameraHeight) ? "—" : `${summary.meanCameraHeight.toFixed(2)} m`} |`,
  )
  .join("\n")}

On a shopper's own phone photo the lens comes from EXIF and is not a guess at all.

## Limitations

- Twelve photos, chosen for clean marks: enough to find the two faults above, not enough to put a
  confidence interval on the mean. The plan's real-room E4 remains the measurement that counts.
- Mostly renders, mostly shot level and from low down; a shopper's phone photo is taken from
  standing height and tilted towards the floor, where the lens guess weighs more (above).
- The model's training lens (598 px) is derived from Hypersim's published camera and the
  fine-tuning resize, and agrees with what these photos imply; a different checkpoint needs its own.

## Reproduce

\`\`\`
pnpm depth-model check      # the model must be installed (research/export_depth_model.py)
pnpm evals:room-web         # downloads the twelve photos into .local/e4-web on first run
pnpm evals:room-web --overlay   # also draws marks (green) and the prediction (orange) in .local/e4-web/marked
\`\`\`

The photos are fetched from the dataset's public bucket on first run and are never committed; the
marks, sources and heights are in \`WEB_PHOTOS\` in the script. Floor fitting is seeded, so a rerun on
the same model gives the same numbers. Model time per photo on this machine, single thread:
${Math.round(mean(results.map((result) => result.modelMs)))} ms on average (letterbox, model and mapping back).
`;

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(path.join(OUT_DIR, "e4-web.json"), `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(path.join(OUT_DIR, "e4-web.md"), md);
  console.log(`\nMean size error at ${APP_FOV}°: ${pct(app.mape)} over ${app.answered} of ${results.length} photos (refused ${app.refused}).`);
  for (const summary of summaries.slice(1)) {
    console.log(`  ${summary.corrected ? `lens ${summary.fov}°` : `no lens correction (${summary.fov}°)`}: ${pct(summary.mape)} over ${summary.answered}`);
  }
  console.log(`Written ${OUT_DIR}/e4-web.md`);
}

// Run only when executed, so the photo list can be imported by other tools.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
