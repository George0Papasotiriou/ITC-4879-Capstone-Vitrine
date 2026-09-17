/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Evaluation E4 (synthetic): measures room-placement geometry accuracy on synthetic cameras with known answers.
 */

/**
 * Evaluation E4, synthetic part: the room geometry (docs/PLAN.md 2.6 A4, Phase 10).
 *
 *   pnpm evals:room
 *
 * The plan's E4 uses at least 12 real room photos with a real object of known
 * size; those need George's photos. This script measures what can be measured
 * without them, on synthetic cameras with known answers, so that the real-photo
 * results can be read against what the geometry alone achieves:
 *
 *   1. Exactness: with exact taps the pose must match the true camera.
 *   2. Size error against tap noise, with and without the Levenberg–Marquardt
 *      refinement, and against the distance to the sheet.
 *   3. Sensitivity to a wrong focal length (photos without EXIF use 69°).
 *   4. Corner snapping on rendered images: tap error before and after, and the
 *      size error of the whole chain.
 *   5. RANSAC floor fitting against the share of outliers.
 *   6. Latency of the tap method and of corner snapping.
 *
 * Writes docs/report/evaluations/e4-geometry-synthetic.md and .json.
 * Deterministic: every scene comes from a seeded generator.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";

import { seededRandom } from "@/lib/reco/simulate";
import {
  A4_SHEET,
  cameraCentre,
  fitPlaneRansac,
  floorPointAt,
  orderTaps,
  projectedHeight,
  projectPoint,
  solveSheet,
  upSign,
  type Point2,
} from "@/lib/vision/camera";
import { refineCorners } from "@/lib/vision/corners";
import { dot3, type Vec3 } from "@/lib/vision/linalg";
import { gaussian, measureDepthSizeError, measureSizeError, randomScene, renderSheet, withTapNoise } from "@/lib/vision/synthetic";

const OUT_DIR = "docs/report/evaluations";
const round = (value: number, digits = 2) => Number(value.toFixed(digits));
const pct = (value: number, digits = 1) => `${(value * 100).toFixed(digits)}%`;
const percentile = (values: number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;
};

function exactness() {
  const random = seededRandom(1);
  let maxNormal = 0;
  let maxHeight = 0;
  // The solver puts the world origin at a corner of the sheet in its own
  // orientation, so its R differs from the scene's by a turn about the vertical
  // (or a mirror). What must match is frame-independent: the floor's normal as
  // the camera sees it (R · up) and the camera's height above the floor.
  const floorNormal = (pose: { R: readonly number[] }, up: number): Vec3 => [pose.R[2]! * up, pose.R[5]! * up, pose.R[8]! * up];
  for (let i = 0; i < 500; i += 1) {
    const scene = randomScene(random);
    const solution = solveSheet(scene.K, scene.image)!;
    const cosine = dot3(floorNormal(solution.pose, upSign(solution.pose)), floorNormal(scene.pose, upSign(scene.pose)));
    maxNormal = Math.max(maxNormal, (Math.acos(Math.min(1, cosine)) * 180) / Math.PI);
    maxHeight = Math.max(maxHeight, Math.abs(Math.abs(cameraCentre(solution.pose)[2]) - Math.abs(cameraCentre(scene.pose)[2])));
  }
  return { scenes: 500, maxFloorNormalErrorDegrees: maxNormal, maxCameraHeightErrorMetres: maxHeight };
}

function noiseTable() {
  return [0.5, 1, 2, 4].map((sigmaPx) => ({
    sigmaPx,
    dlt: measureSizeError({ sigmaPx, refine: false }),
    refined: measureSizeError({ sigmaPx }),
  }));
}

function distanceTable() {
  const bins: [number, number][] = [
    [0.6, 1],
    [1, 1.5],
    [1.5, 2],
    [2, 2.5],
    [2.5, 3],
  ];
  return bins.map((distance) => ({ distance, result: measureSizeError({ sigmaPx: 2, scene: { distance } }) }));
}

function focalTable() {
  return [-0.2, -0.1, 0, 0.1, 0.2].map((focalError) => ({ focalError, result: measureSizeError({ sigmaPx: 1, focalError }) }));
}

/** The full chain on rendered 1024 × 768 images: noisy taps → corner snapping → pose → size error. */
function cornerChain() {
  const random = seededRandom(5);
  const width = 1024;
  const height = 768;
  const tapErrors: number[] = [];
  const snappedErrors: number[] = [];
  const sizeRaw: number[] = [];
  const sizeSnapped: number[] = [];
  const timings: number[] = [];
  let cornersKept = 0;
  let ambiguous = 0;
  let scenes = 0;
  while (scenes < 60) {
    const scene = randomScene(random, { width, height, distance: [0.8, 2] });
    const truth = orderTaps(scene.image)!;
    const angle = random() * 2 * Math.PI;
    const centre: Point2 = [scene.world.reduce((s, p) => s + p[0], 0) / 4, scene.world.reduce((s, p) => s + p[1], 0) / 4];
    const spot: Point2 = [centre[0] + Math.cos(angle) * 0.7, centre[1] + Math.sin(angle) * 0.7];
    const pixel = projectPoint(scene.K, scene.pose, [spot[0], spot[1], 0]);
    const truthHeight = projectedHeight(scene.K, scene.pose, spot[0], spot[1], 0.45);
    if (pixel === null || truthHeight === null || pixel[0] < 0 || pixel[0] > width || pixel[1] < 0 || pixel[1] > height) continue;
    scenes += 1;

    const image = renderSheet(truth, width, height, random);
    // A finger with a loupe: 3 px at this resolution is about 8 px on a 4032 px photo.
    const taps = withTapNoise(truth, 3, random);
    const started = performance.now();
    const snapped = refineCorners(image, taps, { searchRadius: 10 });
    timings.push(performance.now() - started);
    snapped.corners.forEach((corner, i) => {
      tapErrors.push(Math.hypot(taps[i]![0] - truth[i]![0], taps[i]![1] - truth[i]![1]));
      snappedErrors.push(Math.hypot(corner[0] - truth[i]![0], corner[1] - truth[i]![1]));
      if (!snapped.refined[i]) cornersKept += 1;
    });

    const sizeError = (points: Point2[]) => {
      const solution = solveSheet(scene.K, points, A4_SHEET);
      if (points === snapped.corners && solution?.ambiguous) ambiguous += 1;
      const placed = solution === null ? null : floorPointAt(scene.K, solution.pose, pixel);
      const h = solution === null || placed === null ? null : projectedHeight(scene.K, solution.pose, placed[0], placed[1], 0.45);
      return h === null ? 1 : Math.abs(h - truthHeight) / truthHeight;
    };
    sizeRaw.push(sizeError(taps));
    sizeSnapped.push(sizeError(snapped.corners));
  }
  const rms = (values: number[]) => Math.sqrt(values.reduce((s, v) => s + v * v, 0) / values.length);
  const mean = (values: number[]) => values.reduce((s, v) => s + v, 0) / values.length;
  return {
    scenes,
    tapRmsPx: rms(tapErrors),
    snappedRmsPx: rms(snappedErrors),
    cornersKept,
    ambiguous,
    sizeErrorRawTaps: { mean: mean(sizeRaw), p90: percentile(sizeRaw, 0.9), max: Math.max(...sizeRaw) },
    sizeErrorSnapped: { mean: mean(sizeSnapped), p90: percentile(sizeSnapped, 0.9), max: Math.max(...sizeSnapped) },
    snapP50Ms: percentile(timings, 0.5),
    snapP95Ms: percentile(timings, 0.95),
  };
}

function ransacTable() {
  return [0.2, 0.4, 0.6, 0.7, 0.8].flatMap((outlierShare) => [false, true].map((prior) => {
    const random = seededRandom(Math.round(outlierShare * 100));
    const angles: number[] = [];
    const distances: number[] = [];
    const iterations: number[] = [];
    for (let trial = 0; trial < 50; trial += 1) {
      const points: Vec3[] = [];
      const total = 1500;
      const floor = Math.round(total * (1 - outlierShare));
      for (let i = 0; i < floor; i += 1) points.push([(random() - 0.5) * 4, 1.4 + gaussian(random) * 0.01, 1 + random() * 4]);
      for (let i = floor; i < total; i += 1) {
        // Half on a wall, half scattered: the wall is the hard case, a large competing plane.
        points.push(i % 2 === 0 ? [(random() - 0.5) * 4, random() * 1.4 - 1, 5 + gaussian(random) * 0.01] : [(random() - 0.5) * 4, random() * 3 - 1.5, 1 + random() * 4]);
      }
      const result = fitPlaneRansac(points, { threshold: 0.03, random: seededRandom(trial + 1), ...(prior ? { expectedNormal: [0, 1, 0] as Vec3 } : {}) });
      if (result === null) continue;
      angles.push((Math.acos(Math.min(1, Math.abs(dot3(result.plane.normal, [0, 1, 0])))) * 180) / Math.PI);
      distances.push(Math.abs(Math.abs(result.plane.d) - 1.4));
      iterations.push(result.iterations);
    }
    const wrongPlane = angles.filter((angle) => angle > 10).length;
    const correct = angles.filter((angle) => angle <= 10);
    return {
      outlierShare,
      prior,
      trials: 50,
      wrongPlane,
      normalErrorP95Degrees: correct.length > 0 ? percentile(correct, 0.95) : Number.NaN,
      heightErrorP95Metres: percentile(distances.filter((_, i) => angles[i]! <= 10), 0.95),
      iterationsP50: percentile(iterations, 0.5),
    };
  }));
}

function latency() {
  const random = seededRandom(9);
  const timings: number[] = [];
  for (let i = 0; i < 500; i += 1) {
    const scene = randomScene(random);
    const taps = withTapNoise(scene.image, 2, random);
    const started = performance.now();
    solveSheet(scene.K, taps);
    timings.push(performance.now() - started);
  }
  return { solves: 500, p50Ms: percentile(timings, 0.5), p95Ms: percentile(timings, 0.95) };
}


/**
 * The paper-free method (ADR-014) over the same kind of scenes: what the floor
 * from a depth map costs in drawn size, as the depth model's error grows, and
 * how often the shop refuses the photo rather than guess.
 */
function depthTable() {
  const rows: { label: string; noise: number; holes: number; metric: boolean; heightError: number; clutter: boolean }[] = [
    { label: "exact depth", noise: 0, holes: 0, metric: true, heightError: 0, clutter: false },
    { label: "exact depth, furniture in the room", noise: 0, holes: 0, metric: true, heightError: 0, clutter: true },
    { label: "2% depth error", noise: 0.02, holes: 0.05, metric: true, heightError: 0, clutter: true },
    { label: "5% depth error", noise: 0.05, holes: 0.05, metric: true, heightError: 0, clutter: true },
    { label: "10% depth error", noise: 0.1, holes: 0.05, metric: true, heightError: 0, clutter: true },
    { label: "relative depth, height guessed exactly", noise: 0.05, holes: 0.05, metric: false, heightError: 0, clutter: true },
    { label: "relative depth, height 10% out", noise: 0.05, holes: 0.05, metric: false, heightError: 0.1, clutter: true },
    { label: "relative depth, height 20% out", noise: 0.05, holes: 0.05, metric: false, heightError: 0.2, clutter: true },
  ];
  return rows.map((row) => ({ ...row, ...measureDepthSizeError({ scenes: 150, seed: 31, noise: row.noise, holes: row.holes, metric: row.metric, heightError: row.heightError, clutter: row.clutter }) }));
}


/**
 * How strict should the flatness test be? Too tight and photos from an ordinary
 * model are all refused; too loose and the shop draws pieces on planes that are
 * not the floor. Swept here, on a model with 5% depth error, so the constant in
 * depth.ts can point at a measurement.
 */
function thresholdSweep() {
  return [0.03, 0.05, 0.08, 0.12, 0.2, 0.4].map((maxRelativeRms) => ({
    maxRelativeRms,
    ...measureDepthSizeError({ scenes: 150, seed: 31, noise: 0.05, holes: 0.05, clutter: true, maxRelativeRms }),
  }));
}

function depthLatency() {
  const started = performance.now();
  measureDepthSizeError({ scenes: 40, seed: 5, noise: 0.03, holes: 0.05, clutter: true });
  return { scenes: 40, msPerScene: (performance.now() - started) / 40 };
}

async function main() {
  const report = {
    generatedAt: new Date().toISOString(),
    exactness: exactness(),
    noise: noiseTable(),
    distance: distanceTable(),
    focal: focalTable(),
    corners: cornerChain(),
    ransac: ransacTable(),
    depth: depthTable(),
    thresholds: thresholdSweep(),
    depthLatency: depthLatency(),
    latency: latency(),
  };

  const { exactness: ex, noise, distance, focal, corners, ransac, depth, thresholds, depthLatency: depthMs, latency: lat } = report;
  const md = `# E4 (synthetic part): room geometry

Generated ${report.generatedAt} by \`scripts/evaluate-room-geometry.ts\`. Every scene
comes from a seeded generator, so a rerun measures the same cameras. The real-photo
part of E4 (at least 12 rooms with a measured object) is still to come; these numbers
are what the geometry achieves when the only error is in the taps.

**Size error** is the measure the shopper sees: a 45 cm product is dropped at a floor
pixel 0.5–1 m from the sheet, and its on-screen height with the recovered camera is
compared with its on-screen height with the true camera. Scenes: 1600 × 1200 photos,
60–75° lenses, camera 0.9–1.7 m high, sheet 1–2.5 m away at any angle, up to 8° roll.
Plan target on real photos: mean ≤ 10%.

## 1. Exactness

With exact taps, over ${ex.scenes} scenes: largest error in the floor's orientation seen from the camera ${ex.maxFloorNormalErrorDegrees.toExponential(1)}°,
largest camera-height error ${ex.maxCameraHeightErrorMetres.toExponential(1)} m. The derivation is exact.

## 2. Tap noise, and what the refinement buys

| Tap noise (σ per coordinate) | DLT pose: mean | p90 | + Levenberg–Marquardt: mean | p90 | Flagged ambiguous | Mean when not flagged |
|---|---|---|---|---|---|---|
${noise.map((row) => `| ${row.sigmaPx} px | ${pct(row.dlt.mean)} | ${pct(row.dlt.p90)} | ${pct(row.refined.mean)} | ${pct(row.refined.p90)} | ${pct(row.refined.ambiguousShare, 0)} | ${pct(row.refined.meanWhenClear)} |`).join("\n")}

The DLT fits a homography with eight degrees of freedom to eight tap coordinates, so
it reproduces the noise exactly and never uses the known camera matrix K. A camera
with known K has six degrees of freedom; minimising the reprojection error over those
six averages the noise out. On a phone photo 4032 px wide, 1600 px of this table
correspond to 2.5 px there, so a 4 px row here is about a 10 px tap on the phone photo.

## 3. Distance from the camera to the sheet (2 px noise, refined)

| Sheet distance | Mean | p90 | Flagged ambiguous | Mean when not flagged |
|---|---|---|---|---|
${distance.map((row) => `| ${row.distance[0]}–${row.distance[1]} m | ${pct(row.result.mean)} | ${pct(row.result.p90)} | ${pct(row.result.ambiguousShare, 0)} | ${pct(row.result.meanWhenClear)} |`).join("\n")}

A sheet further away covers fewer pixels and is seen more obliquely, so the same tap
error means a larger angle error. The page asks shoppers to put the sheet where the
product would stand and to photograph it from a normal standing position.

## 4. Wrong focal length (1 px noise, refined)

| Assumed focal length | Mean | p90 |
|---|---|---|
${focal.map((row) => `| ${row.focalError >= 0 ? "+" : ""}${Math.round(row.focalError * 100)}% | ${pct(row.result.mean)} | ${pct(row.result.p90)} |`).join("\n")}

Photos without EXIF assume 69° across the longer side (a 26 mm-equivalent phone lens).
A phone's main camera is within about ±10% of that; ultra-wide lenses are not.

## 5. Corner snapping on rendered images (1024 × 768, ${corners.scenes} scenes, 3 px taps)

| Measure | Taps as tapped | After snapping to the edges |
|---|---|---|
| Corner error, RMS | ${round(corners.tapRmsPx)} px | ${round(corners.snappedRmsPx)} px |
| Size error, mean | ${pct(corners.sizeErrorRawTaps.mean)} | ${pct(corners.sizeErrorSnapped.mean)} |
| Size error, p90 | ${pct(corners.sizeErrorRawTaps.p90)} | ${pct(corners.sizeErrorSnapped.p90)} |
| Size error, worst scene | ${pct(corners.sizeErrorRawTaps.max)} | ${pct(corners.sizeErrorSnapped.max)} |

Corners not at an edge intersection (an edge was unreliable): ${corners.cornersKept} of ${corners.scenes * 4}.
Scenes flagged ambiguous after snapping: ${corners.ambiguous} of ${corners.scenes}; the worst scene is one of them
(a sheet about 50 px across, where the page asks the shopper to confirm the sheet's orientation).
Snapping time p50 ${round(corners.snapP50Ms)} ms, p95 ${round(corners.snapP95Ms)} ms. The rendered
images are cleaner than photos (no blur, lens distortion or uneven light), so the real
photos will show how much of this survives.

## 6. RANSAC floor plane (automatic mode)

1,500 points per trial: floor points with 1 cm noise, the rest split between a wall and
scattered points. A fit more than 10° from the floor counts as the wrong plane.

| Outliers | Gravity prior | Wrong plane | Normal error p95 | Height error p95 | Iterations p50 |
|---|---|---|---|---|---|
${ransac.map((row) => `| ${pct(row.outlierShare, 0)} | ${row.prior ? "yes" : "no"} | ${row.wrongPlane} of ${row.trials} | ${Number.isNaN(row.normalErrorP95Degrees) ? "—" : `${round(row.normalErrorP95Degrees, 2)}°`} | ${Number.isNaN(row.heightErrorP95Metres) ? "—" : `${round(row.heightErrorP95Metres * 100, 2)} cm`} | ${row.iterationsP50} |`).join("\n")}

When the wall has more points than the floor, the largest plane is the wall: RANSAC
answers "the biggest plane", not "the floor". With the gravity prior, candidate planes
tilted more than 25° from the expected floor normal are never considered, which removes
that failure. The automatic (depth) mode will take the expected normal from the phone's
motion sensors when available and from the image's down axis otherwise.

## 7. Placing without the sheet of paper (ADR-014)

The same question, measured the same way, with the floor coming from a depth map
instead of four taps: 320 × 240 depth, the model's error proportional to distance,
5% of pixels without a reading, and — where marked — a table and a box standing on
the floor for the floor finder to reject. A photo the method refuses is not a size
error: the shop draws nothing and offers the sheet instead.

| Depth | Mean size error | p50 | p90 | Over 25% wrong | Refused | Scenes measured |
|---|---|---|---|---|---|---|
${depth.map((row) => `| ${row.label} | ${Number.isNaN(row.mean) ? "—" : pct(row.mean)} | ${Number.isNaN(row.p50) ? "—" : pct(row.p50)} | ${Number.isNaN(row.p90) ? "—" : pct(row.p90)} | ${Number.isNaN(row.badlyWrongShare) ? "—" : pct(row.badlyWrongShare, 0)} | ${pct(row.refusedShare, 0)} | ${row.count} |`).join("\n")}

Reading it: with a metric model the size error is the model's own error, roughly one
for one — a model 5% out in depth draws a sofa about 5% wrong — because the camera
height and the floor's orientation both come from the same distances. With a relative
model the scale comes from how high the camera was held, and the error follows that
guess just as directly, which is why the page asks and lets it be corrected.

Choosing the flatness threshold, on a model with 5% depth error: it decides how
many photos are refused and how wrong the accepted ones are. The shop uses 0.12.

| Flatness allowed | Refused | Mean size error | p90 | Scenes measured |
|---|---|---|---|---|
${thresholds.map((row) => `| ${pct(row.maxRelativeRms, 0)} of the room distance | ${pct(row.refusedShare, 0)} | ${Number.isNaN(row.mean) ? "—" : pct(row.mean)} | ${Number.isNaN(row.p90) ? "—" : pct(row.p90)} | ${row.count} |`).join("\n")}

Geometry only: ${round(depthMs.msPerScene)} ms per photo for the floor (${depthMs.scenes} photos, 320 × 240), on top of
whatever the model itself takes.

## 8. Latency

Tap method (both labellings, DLT, pose, refinement): p50 ${round(lat.p50Ms, 3)} ms, p95 ${round(lat.p95Ms, 3)} ms over ${lat.solves} solves.

## 9. Limits

- Synthetic taps have Gaussian noise; real taps have biases (a finger lands consistently
  on one side of a corner). Snapping removes most of that where edges are visible.
- The pinhole model ignores lens distortion. Phone photos are distortion-corrected by the
  camera app for the main lens; ultra-wide photos are not reliable.
- The principal point is assumed at the image centre; phones crop close to centred.
`;

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(`${OUT_DIR}/e4-geometry-synthetic.json`, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(`${OUT_DIR}/e4-geometry-synthetic.md`, md);
  console.log(md);
}

await main();
