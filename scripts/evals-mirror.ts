/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * E13: the AR Mirror's head pose on AFLW2000-3D's 2,000 labelled faces, and its smoothing on a synthetic moving head.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { inflateSync } from "node:zlib";

import { chromium } from "@playwright/test";

import type { Point2 } from "@/lib/vision/camera";
import { mulMat3, rotationDistanceDegrees, rotationFromEuler, transpose3, type Mat3, type Vec3 } from "@/lib/vision/linalg";
import { CANONICAL_FACE_MM, LANDMARK, RIGID_LANDMARKS } from "@/lib/vision/mirror/face-model";
import { IRIS_RIM_CALIBRATION, irisDepthRatio } from "@/lib/vision/mirror/iris";
import { FRONTAL, frameIntrinsics, headAngles, project, refinePose, solveHeadPose, weakPerspectivePose, type HeadPose } from "@/lib/vision/mirror/pose";
import { OneEuroFilter, PoseSmoother } from "@/lib/vision/mirror/smoothing";

/**
 * docs/adr/065, docs/report/evaluations/e13-mirror.md.
 *
 *   pnpm evals:mirror [--data .local/headpose/AFLW2000] [--limit N] [--reuse]
 *
 * AFLW2000-3D (Zhu et al., CVPR 2016) holds 2,000 photographs of faces in
 * the wild, each with its head pose as three angles. MediaPipe's landmarker
 * runs on each in headless Chromium, exactly as it runs in the shop (CPU,
 * the same model file), and the landmarks are kept in .local/headpose so the
 * analysis can be run again without the browser (--reuse). The protocol of
 * Ruiz et al. (Hopenet, 2018): faces whose labelled angles are all within
 * ±99°; mean absolute error per angle.
 *
 * Compared: the mirror's own solver (pose.ts) and its ablations, MediaPipe's
 * own facial transformation matrix, and a two-dimensional rule of thumb that
 * needs no 3D model (yaw from where the nose sits between the eyes, roll from
 * the eyes' line, pitch from the nose against the eyes and chin).
 */

const ROOT = resolve(".");
const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const option = (name: string, fallback: string) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] !== undefined ? args[index + 1]! : fallback;
};
const DATA = resolve(option("--data", ".local/headpose/AFLW2000"));
const LIMIT = Number(option("--limit", "100000"));
const CACHE = resolve(".local/headpose/landmarks.json");
const OUT = resolve("docs/report/evaluations/e13-mirror");
const MODEL = existsSync(resolve("public/models/face/face_landmarker.task")) ? resolve("public/models/face/face_landmarker.task") : resolve(".local/tmp/mp/face_landmarker.task");

/* -------------------------------------------------------------------------- */
/* AFLW2000's labels: MATLAB 5 files                                          */
/* -------------------------------------------------------------------------- */

/**
 * The few numeric arrays of a MATLAB 5 file, by name. Each top-level element
 * is a compressed (zlib) matrix: flags, dimensions, a name, then the real
 * part as doubles or singles. Small elements pack their size into the tag.
 */
function readMat(path: string): Record<string, number[]> {
  const file = readFileSync(path);
  const out: Record<string, number[]> = {};
  let offset = 128;
  while (offset + 8 <= file.length) {
    const type = file.readUInt32LE(offset);
    const size = file.readUInt32LE(offset + 4);
    let data = file.subarray(offset + 8, offset + 8 + size);
    offset += 8 + size;
    if (type === 15) data = inflateSync(data);
    else offset = (offset + 7) & ~7;
    let p = 8;
    const element = () => {
      let tag = data.readUInt32LE(p);
      if (tag >>> 16 !== 0) {
        const length = tag >>> 16;
        tag &= 0xffff;
        const value = data.subarray(p + 4, p + 4 + length);
        p += 8;
        return { tag, value };
      }
      const length = data.readUInt32LE(p + 4);
      const value = data.subarray(p + 8, p + 8 + length);
      p = (p + 8 + length + 7) & ~7;
      return { tag, value };
    };
    try {
      const flags = element();
      element(); // dimensions
      const name = element().value.toString("latin1");
      const cls = flags.value.readUInt8(0);
      if (cls !== 6 && cls !== 7) continue;
      const real = element();
      const values: number[] = [];
      if (real.tag === 9) for (let i = 0; i + 8 <= real.value.length; i += 8) values.push(real.value.readDoubleLE(i));
      else if (real.tag === 7) for (let i = 0; i + 4 <= real.value.length; i += 4) values.push(real.value.readFloatLE(i));
      out[name] = values;
    } catch {
      // An element this reader does not need (a struct or a cell).
    }
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Landmarks from MediaPipe, in headless Chromium                             */
/* -------------------------------------------------------------------------- */

type Detection = { name: string; width: number; height: number; landmarks: [number, number, number][] | null; matrix: number[] | null };

const PAGE = `<!doctype html><meta charset="utf-8"><script type="module">
import { FaceLandmarker, FilesetResolver } from "/vision_bundle.mjs";
window.ready = (async () => {
  const fileset = await FilesetResolver.forVisionTasks("/wasm");
  window.landmarker = await FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: "/face_landmarker.task", delegate: "CPU" },
    runningMode: "IMAGE", numFaces: 1, outputFacialTransformationMatrixes: true,
  });
  return true;
})();
window.detect = async (url) => {
  const bitmap = await createImageBitmap(await (await fetch(url)).blob());
  const result = window.landmarker.detect(bitmap);
  const face = result.faceLandmarks[0];
  const out = { width: bitmap.width, height: bitmap.height, landmarks: face ? face.map((p) => [p.x, p.y, p.z]) : null, matrix: result.facialTransformationMatrixes?.[0]?.data ?? null };
  bitmap.close();
  return out;
};
</script>`;

async function detectAll(names: string[]): Promise<Detection[]> {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const tasks = join(ROOT, "node_modules/@mediapipe/tasks-vision");
  await page.route("http://e13.test/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const send = (file: string, contentType: string) => route.fulfill({ status: 200, contentType, body: readFileSync(file) });
    if (path === "/" || path === "/index.html") return route.fulfill({ status: 200, contentType: "text/html", body: PAGE });
    if (path === "/vision_bundle.mjs") return send(join(tasks, "vision_bundle.mjs"), "text/javascript");
    if (path.startsWith("/wasm/")) return send(join(tasks, path), path.endsWith(".wasm") ? "application/wasm" : "text/javascript");
    if (path === "/face_landmarker.task") return send(MODEL, "application/octet-stream");
    if (path.startsWith("/img/")) return send(join(DATA, path.slice(5)), "image/jpeg");
    return route.fulfill({ status: 404 });
  });
  await page.goto("http://e13.test/index.html");
  await page.waitForFunction(() => (window as unknown as { ready?: Promise<boolean> }).ready !== undefined);
  await page.evaluate(() => (window as unknown as { ready: Promise<boolean> }).ready);
  const out: Detection[] = [];
  const started = Date.now();
  for (const [index, name] of names.entries()) {
    const found = await page.evaluate((url) => (window as unknown as { detect: (u: string) => Promise<Omit<Detection, "name">> }).detect(url), `/img/${name}`);
    out.push({ name, ...found });
    if ((index + 1) % 200 === 0) console.log(`  ${index + 1}/${names.length} faces, ${Math.round((Date.now() - started) / 1000)} s`);
  }
  await browser.close();
  return out;
}

/* -------------------------------------------------------------------------- */
/* Angles in AFLW2000's own convention                                        */
/* -------------------------------------------------------------------------- */

/**
 * AFLW2000's RotationMatrix.m: R = R_x·R_y·R_z with R_x = [1 0 0; 0 c s; 0 −s c]
 * and so on, which is R_x(−φ)·R_y(−γ)·R_z(−θ) in the usual sign; its
 * transpose is R_z(θ)·R_y(γ)·R_x(φ). Its frame is not the camera's (its y
 * points up the image), so a fixed signed permutation T relates our
 * G = R·FRONTAL to it: R_aflw ≈ T·G·Tᵀ (or with Gᵀ). T is chosen among the 16
 * candidates on a calibration fifth of the faces (by our solver's median
 * error) and then used for every method alike; the remaining four fifths
 * are the test.
 */
function aflwMatrix(pitch: number, yaw: number, roll: number): Mat3 {
  return transpose3(mulMat3(rotationZ(roll), mulMat3(rotationY(yaw), rotationX(pitch))));
}
const rotationX = (a: number): Mat3 => [1, 0, 0, 0, Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a)];
const rotationY = (a: number): Mat3 => [Math.cos(a), 0, Math.sin(a), 0, 1, 0, -Math.sin(a), 0, Math.cos(a)];
const rotationZ = (a: number): Mat3 => [Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a), 0, 0, 0, 1];

/** (pitch, yaw, roll) in degrees from an AFLW2000-convention matrix: N = Rᵀ = R_z(θ)·R_y(γ)·R_x(φ). */
function aflwAngles(R: Mat3): [number, number, number] {
  const N = transpose3(R);
  const degrees = 180 / Math.PI;
  return [Math.atan2(N[7], N[8]) * degrees, Math.asin(Math.max(-1, Math.min(1, -N[6]))) * degrees, Math.atan2(N[3], N[0]) * degrees];
}

type Alignment = { signs: Vec3; transposed: boolean };
const ALIGNMENTS: Alignment[] = [];
for (const transposed of [false, true]) for (const a of [1, -1]) for (const b of [1, -1]) for (const c of [1, -1]) ALIGNMENTS.push({ signs: [a, b, c], transposed });
const align = (G: Mat3, { signs, transposed }: Alignment): Mat3 => {
  const T: Mat3 = [signs[0], 0, 0, 0, signs[1], 0, 0, 0, signs[2]];
  return mulMat3(T, mulMat3(transposed ? transpose3(G) : G, T));
};

/* -------------------------------------------------------------------------- */
/* The methods                                                                */
/* -------------------------------------------------------------------------- */

type Method = (detection: Detection) => Mat3 | null;
const pixelsOf = (detection: Detection): Point2[] => detection.landmarks!.map(([x, y]) => [x * detection.width, y * detection.height]);

function ours({ points = RIGID_LANDMARKS, robust = true, fov = 63, weakOnly = false } = {}): Method {
  return (detection) => {
    if (detection.landmarks === null) return null;
    const pixels = pixelsOf(detection);
    const K = frameIntrinsics(detection.width, detection.height, fov);
    const image = points.map((index) => pixels[index]!);
    const model = points.map((index) => CANONICAL_FACE_MM[index]!);
    const start = weakPerspectivePose(image, model, K);
    if (start === null) return null;
    const pose = weakOnly ? start : refinePose(image, model, K, start, { robust });
    return mulMat3(pose.R, FRONTAL);
  };
}

/** MediaPipe's own matrix: canonical face to its camera, which looks down −z with y up; G = diag(1, −1, −1)·R_mp·FRONTAL. */
const mediapipe: Method = (detection) => {
  const m = detection.matrix;
  if (m === null || m.length !== 16) return null;
  // Column-major when the translation (largest along z) sits in the last column's slots 12–14.
  const columnMajor = Math.abs(m[14]!) > Math.abs(m[11]!);
  const at = (row: number, col: number) => (columnMajor ? m[col * 4 + row]! : m[row * 4 + col]!);
  const R: Mat3 = [at(0, 0), at(0, 1), at(0, 2), at(1, 0), at(1, 1), at(1, 2), at(2, 0), at(2, 1), at(2, 2)];
  const toCv: Mat3 = [1, 0, 0, 0, -1, 0, 0, 0, -1];
  return mulMat3(mulMat3(toCv, R), FRONTAL);
};

/**
 * The rule of thumb, with no 3D model: roll from the line between the outer
 * eye corners; yaw from how far the nose tip sits from the eyes' midpoint,
 * as a share of the eyes' distance; pitch from where the nose tip sits
 * between the eyes' line and the chin. Its two gains (and pitch's offset)
 * are fitted on the calibration fifth, by least squares on our solver's angles.
 */
function rule(gains: { yaw: number; pitch: number; pitchOffset: number }): Method {
  return (detection) => {
    if (detection.landmarks === null) return null;
    const ratios = ruleRatios(pixelsOf(detection));
    const degrees = Math.PI / 180;
    return rotationFromEuler(gains.yaw * ratios.yaw * degrees, (gains.pitch * ratios.pitch + gains.pitchOffset) * degrees, ratios.roll * degrees);
  };
}
function ruleRatios(p: Point2[]): { yaw: number; pitch: number; roll: number } {
  const right = p[LANDMARK.rightEyeOuter]!;
  const left = p[LANDMARK.leftEyeOuter]!;
  const nose = p[LANDMARK.noseTip]!;
  const chin = p[LANDMARK.chin]!;
  const mid: Point2 = [(right[0] + left[0]) / 2, (right[1] + left[1]) / 2];
  const eyes = Math.hypot(left[0] - right[0], left[1] - right[1]);
  const roll = (Math.atan2(left[1] - right[1], left[0] - right[0]) * 180) / Math.PI;
  // In the eyes' own frame (rotated by −roll).
  const c = Math.cos((-roll * Math.PI) / 180);
  const s = Math.sin((-roll * Math.PI) / 180);
  const local = ([x, y]: Point2): Point2 => [c * (x - mid[0]) - s * (y - mid[1]), s * (x - mid[0]) + c * (y - mid[1])];
  const n = local(nose);
  const ch = local(chin);
  return { yaw: n[0] / eyes, pitch: ch[1] === 0 ? 0 : n[1] / ch[1], roll };
}

/* -------------------------------------------------------------------------- */
/* Measures                                                                   */
/* -------------------------------------------------------------------------- */

const wrap = (angle: number) => ((((angle + 180) % 360) + 360) % 360) - 180;
type Errors = { pitch: number; yaw: number; roll: number; geodesic: number };
const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
const quantile = (values: number[], q: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))))]!;
};

function bootstrapDifference(a: number[], b: number[], resamples = 1000, seed = 13): { difference: number; low: number; high: number } {
  let state = seed;
  const random = () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
  const n = a.length;
  const diffs: number[] = [];
  for (let r = 0; r < resamples; r += 1) {
    let sa = 0;
    let sb = 0;
    for (let i = 0; i < n; i += 1) {
      const k = Math.floor(random() * n);
      sa += a[k]!;
      sb += b[k]!;
    }
    diffs.push((sa - sb) / n);
  }
  return { difference: mean(a) - mean(b), low: quantile(diffs, 0.025), high: quantile(diffs, 0.975) };
}

/* -------------------------------------------------------------------------- */
/* Smoothing on a synthetic moving head                                       */
/* -------------------------------------------------------------------------- */

/**
 * A head at 60 cm that holds still for 4 s, then turns ±30° in yaw at
 * 0.5 Hz for 6 s, filmed at 30 frames a second; every landmark shaken by
 * 1.5 px of normal noise, about what a landmarker's frame-to-frame jitter
 * is. Measured: the yaw's standard deviation while still (jitter), its RMS
 * error while turning (lag and jitter together), and the lag, as the time
 * shift that best aligns the output with the truth.
 */
function smoothingStudy() {
  const K = frameIntrinsics(1280, 720);
  const model = RIGID_LANDMARKS.map((index) => CANONICAL_FACE_MM[index]!);
  let state = 4949;
  const normal = () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    const u = (state + 0.5) / 4294967296;
    state = (state * 1664525 + 1013904223) % 4294967296;
    const v = (state + 0.5) / 4294967296;
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const fps = 30;
  const frames = 300;
  const truthYaw = (k: number) => (k < 120 ? 0 : 30 * Math.sin(2 * Math.PI * 0.5 * ((k - 120) / fps)));
  const truths: number[] = [];
  const solvedPoses: HeadPose[] = [];
  let previous: HeadPose | null = null;
  for (let k = 0; k < frames; k += 1) {
    const pose: HeadPose = { R: mulMat3(rotationFromEuler((truthYaw(k) * Math.PI) / 180, 0, 0), FRONTAL), t: [0, 0, 600] };
    const image = model.map((X) => {
      const [u, v] = project(K, pose, X)!;
      return [u + 1.5 * normal(), v + 1.5 * normal()] as Point2;
    });
    const solved: HeadPose = solveHeadPose(image, model, K, previous)!;
    previous = solved;
    solvedPoses.push(solved);
    truths.push(truthYaw(k));
  }
  const raw = solvedPoses.map((pose) => headAngles(pose.R).yaw);
  const oneEuroWith = (minCutoff: number, beta: number) => {
    const smoother = new PoseSmoother({ minCutoff, beta });
    return solvedPoses.map((pose, k) => headAngles(smoother.smooth(pose, k / fps).R).yaw);
  };
  const emaWith = (alpha: number) => {
    let value: number | null = null;
    return raw.map((yaw) => (value = value === null ? yaw : value + alpha * (yaw - value)));
  };
  const EMA_ALPHA = 0.25;
  const ema = emaWith(EMA_ALPHA);
  const measure = (series: number[]) => {
    const still = series.slice(30, 120);
    const stillMean = mean(still);
    const jitter = Math.sqrt(mean(still.map((value) => (value - stillMean) ** 2)));
    const moving = series.slice(150).map((value, i) => value - truths[150 + i]!);
    const rms = Math.sqrt(mean(moving.map((value) => value * value)));
    let bestShift = 0;
    let bestError = Number.POSITIVE_INFINITY;
    for (let shift = 0; shift <= 10; shift += 1) {
      const error = mean(series.slice(150 + shift).map((value, i) => (value - truths[150 + i]!) ** 2));
      if (error < bestError) {
        bestError = error;
        bestShift = shift;
      }
    }
    return { jitterDegrees: jitter, movingRmsDegrees: rms, lagMs: (bestShift * 1000) / fps };
  };
  void OneEuroFilter;
  // The shop's setting: the One-Euro parameters with the least error while turning among those that cut the still jitter to a third or less.
  const rawMeasure = measure(raw);
  const sweep: { minCutoff: number; beta: number; jitterDegrees: number; movingRmsDegrees: number; lagMs: number }[] = [];
  for (const minCutoff of [0.5, 1, 1.5, 2, 3]) for (const beta of [0.4, 1, 2, 4, 8, 16, 32, 64]) sweep.push({ minCutoff, beta, ...measure(oneEuroWith(minCutoff, beta)) });
  const eligible = sweep.filter((entry) => entry.jitterDegrees <= rawMeasure.jitterDegrees / 3);
  const chosen = (eligible.length > 0 ? eligible : sweep).reduce((best, entry) => (entry.movingRmsDegrees < best.movingRmsDegrees ? entry : best));
  // An exponential average as steady as the chosen filter, for comparison: the largest α whose jitter is no higher.
  let matchedAlpha = 0.05;
  for (let alpha = 0.05; alpha <= 1; alpha += 0.01) if (measure(emaWith(alpha)).jitterDegrees <= chosen.jitterDegrees) matchedAlpha = alpha;
  return {
    raw: rawMeasure,
    ema: { alpha: EMA_ALPHA, ...measure(ema) },
    emaMatched: { alpha: Math.round(matchedAlpha * 100) / 100, ...measure(emaWith(matchedAlpha)) },
    oneEuroDefault: measure(oneEuroWith(1.5, 0.4)),
    oneEuroChosen: chosen,
    sweep,
  };
}

/* -------------------------------------------------------------------------- */

async function main() {
  const names = readdirSync(DATA)
    .filter((name) => name.endsWith(".jpg"))
    .sort()
    .slice(0, LIMIT);
  let detections: Detection[];
  if (flag("--reuse") && existsSync(CACHE)) {
    detections = (JSON.parse(readFileSync(CACHE, "utf8")) as Detection[]).filter((detection) => names.includes(detection.name));
    console.log(`Reusing ${detections.length} landmark sets from ${CACHE}`);
  } else {
    console.log(`MediaPipe on ${names.length} faces in headless Chromium (CPU)…`);
    detections = await detectAll(names);
    mkdirSync(resolve(".local/headpose"), { recursive: true });
    writeFileSync(CACHE, JSON.stringify(detections));
  }

  // Labels, and Hopenet's ±99° protocol.
  const labelled = detections.map((detection) => {
    const pose = readMat(join(DATA, detection.name.replace(/\.jpg$/, ".mat"))).Pose_Para!;
    const degrees = 180 / Math.PI;
    return { detection, pitch: pose[0]! * degrees, yaw: pose[1]! * degrees, roll: pose[2]! * degrees };
  });
  const inRange = labelled.filter((item) => Math.abs(item.pitch) <= 99 && Math.abs(item.yaw) <= 99 && Math.abs(item.roll) <= 99);
  const found = inRange.filter((item) => item.detection.landmarks !== null);
  const calibration = found.filter((_, index) => index % 5 === 0);
  const test = found.filter((_, index) => index % 5 !== 0);
  console.log(`${labelled.length} faces, ${inRange.length} within ±99°, ${found.length} found by the landmarker; calibration ${calibration.length}, test ${test.length}`);

  // The frame alignment, chosen on the calibration fifth with our solver.
  const ourMethod = ours();
  let alignment = ALIGNMENTS[0]!;
  let bestMedian = Number.POSITIVE_INFINITY;
  for (const candidate of ALIGNMENTS) {
    const errors = calibration.map((item) => {
      const G = ourMethod(item.detection);
      return G === null ? 180 : rotationDistanceDegrees(align(G, candidate), aflwMatrix((item.pitch * Math.PI) / 180, (item.yaw * Math.PI) / 180, (item.roll * Math.PI) / 180));
    });
    const median = quantile(errors, 0.5);
    if (median < bestMedian) {
      bestMedian = median;
      alignment = candidate;
    }
  }
  console.log(`Alignment: signs ${alignment.signs.join(",")}${alignment.transposed ? ", transposed" : ""} (median ${bestMedian.toFixed(2)}° on calibration)`);

  // The rule of thumb's gains, by least squares against our solver's angles on the calibration fifth.
  const fitGain = (xs: number[], ys: number[]) => xs.reduce((sum, x, i) => sum + x * ys[i]!, 0) / Math.max(1e-9, xs.reduce((sum, x) => sum + x * x, 0));
  const calRatios = calibration.map((item) => ruleRatios(pixelsOf(item.detection)));
  const calAngles = calibration.map((item) => headAngles(mulMat3(ourMethod(item.detection)!, FRONTAL)));
  const pitchRatios = calRatios.map((r) => r.pitch);
  const pitchMean = mean(pitchRatios);
  const pitchTargetMean = mean(calAngles.map((a) => a.pitch));
  const gains = {
    yaw: fitGain(
      calRatios.map((r) => r.yaw),
      calAngles.map((a) => a.yaw),
    ),
    pitch: fitGain(
      pitchRatios.map((value) => value - pitchMean),
      calAngles.map((a) => a.pitch - pitchTargetMean),
    ),
    pitchOffset: 0,
  };
  gains.pitchOffset = pitchTargetMean - gains.pitch * pitchMean;

  // AFLW2000's pictures are crops around a face, so their field of view is narrow and unknown: chosen on the calibration fifth.
  // Which landmarks to solve from (the rigid set or all 468) is chosen the same way, never on the test faces.
  const ALL_POINTS = CANONICAL_FACE_MM.map((_, index) => index);
  let fov = 63;
  let points: readonly number[] = RIGID_LANDMARKS;
  let fovError = Number.POSITIVE_INFINITY;
  for (const [candidate, set] of [15, 25, 35, 45, 63, 90].flatMap((value) => [[value, RIGID_LANDMARKS], [value, ALL_POINTS]] as const)) {
    const method = ours({ fov: candidate, points: set });
    const errors = calibration.map((item) => {
      const G = method(item.detection);
      return G === null ? 180 : rotationDistanceDegrees(align(G, alignment), aflwMatrix((item.pitch * Math.PI) / 180, (item.yaw * Math.PI) / 180, (item.roll * Math.PI) / 180));
    });
    const median = quantile(errors, 0.5);
    if (median < fovError) {
      fovError = median;
      fov = candidate;
      points = set;
    }
  }
  const pointSet = points === RIGID_LANDMARKS ? "rigid" : "all_468";
  console.log(`Field of view for the crops: ${fov}°, landmarks: ${pointSet} (median ${fovError.toFixed(2)}° on calibration)`);

  const methods: Record<string, Method> = {
    ours: ours({ fov, points }),
    mediapipe,
    rule_of_thumb: rule(gains),
    ours_other_landmark_set: ours({ points: points === RIGID_LANDMARKS ? ALL_POINTS : RIGID_LANDMARKS, fov }),
    ours_not_robust: ours({ robust: false, fov, points }),
    ours_weak_perspective_only: ours({ weakOnly: true, fov, points }),
    ours_at_webcam_fov_63: ours({ fov: 63, points }),
    ours_fov_90: ours({ fov: 90, points }),
  };

  const errorsOf = (method: Method): (Errors | null)[] =>
    test.map((item) => {
      const G = method(item.detection);
      if (G === null) return null;
      const aligned = align(G, alignment);
      const [pitch, yaw, roll] = aflwAngles(aligned);
      return {
        pitch: Math.abs(wrap(pitch - item.pitch)),
        yaw: Math.abs(wrap(yaw - item.yaw)),
        roll: Math.abs(wrap(roll - item.roll)),
        geodesic: rotationDistanceDegrees(aligned, aflwMatrix((item.pitch * Math.PI) / 180, (item.yaw * Math.PI) / 180, (item.roll * Math.PI) / 180)),
      };
    });

  const all = Object.fromEntries(Object.entries(methods).map(([name, method]) => [name, errorsOf(method)]));
  // Paired: only faces every method answered.
  const paired = test.map((_, index) => Object.values(all).every((errors) => errors[index] !== null));
  const results: Record<string, { pitch: number; yaw: number; roll: number; mean: number; geodesicMedian: number; answered: number }> = {};
  for (const [name, errors] of Object.entries(all)) {
    const kept = errors.filter((_, index) => paired[index]) as Errors[];
    const pitch = mean(kept.map((e) => e.pitch));
    const yaw = mean(kept.map((e) => e.yaw));
    const roll = mean(kept.map((e) => e.roll));
    results[name] = { pitch, yaw, roll, mean: (pitch + yaw + roll) / 3, geodesicMedian: quantile(kept.map((e) => e.geodesic), 0.5), answered: errors.filter((e) => e !== null).length };
    console.log(`  ${name.padEnd(28)} MAE pitch ${pitch.toFixed(2)}  yaw ${yaw.toFixed(2)}  roll ${roll.toFixed(2)}  mean ${results[name]!.mean.toFixed(2)}  (median geodesic ${results[name]!.geodesicMedian.toFixed(2)}°)`);
  }
  const perFace = (name: string) => (all[name]!.filter((_, index) => paired[index]) as Errors[]).map((e) => (e.pitch + e.yaw + e.roll) / 3);
  const comparisons = {
    ours_vs_mediapipe: bootstrapDifference(perFace("ours"), perFace("mediapipe")),
    ours_vs_rule_of_thumb: bootstrapDifference(perFace("ours"), perFace("rule_of_thumb")),
    robust_vs_not: bootstrapDifference(perFace("ours"), perFace("ours_not_robust")),
    chosen_vs_other_landmark_set: bootstrapDifference(perFace("ours"), perFace("ours_other_landmark_set")),
  };
  for (const [name, value] of Object.entries(comparisons)) console.log(`  ${name}: ${value.difference.toFixed(3)}° [${value.low.toFixed(3)}, ${value.high.toFixed(3)}]`);

  // The irises' raw depth ratio over the test faces: its median is MediaPipe's rim calibration (iris.ts).
  const scales = test
    .map((item) => {
      const pixels = pixelsOf(item.detection);
      const K = frameIntrinsics(item.detection.width, item.detection.height, fov);
      const image = RIGID_LANDMARKS.map((index) => pixels[index]!);
      const pose = solveHeadPose(image, RIGID_LANDMARKS.map((index) => CANONICAL_FACE_MM[index]!), K);
      return pose === null ? null : irisDepthRatio(pixels, K, pose);
    })
    .filter((value): value is number => value !== null);
  const scale = { faces: scales.length, median: quantile(scales, 0.5), q25: quantile(scales, 0.25), q75: quantile(scales, 0.75), calibration: IRIS_RIM_CALIBRATION };
  console.log(`  face scale by the irises: median ${scale.median.toFixed(3)} (IQR ${scale.q25.toFixed(3)}–${scale.q75.toFixed(3)}) over ${scale.faces} faces`);

  const smoothing = smoothingStudy();
  console.log("  smoothing:", JSON.stringify(smoothing));

  const report = {
    ranAt: new Date().toISOString(),
    data: "AFLW2000-3D (Zhu, Lei, Liu, Shi and Li, CVPR 2016), 2,000 images",
    faces: { total: labelled.length, withinRange: inRange.length, found: found.length, calibration: calibration.length, test: test.length, paired: paired.filter(Boolean).length },
    alignment,
    fieldOfView: fov,
    landmarks: pointSet,
    ruleGains: gains,
    results,
    comparisons,
    faceScale: scale,
    smoothing,
  };
  writeFileSync(`${OUT}.json`, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Written ${OUT}.json`);
}

void main();
