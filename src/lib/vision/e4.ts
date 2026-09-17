/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Evaluation E4 on real photographs: turns marks on a photo into the size error of each method, and summarises a set.
 */

import { floorPointAt, projectedHeight, type Point2, type Pose } from "@/lib/vision/camera";
import type { Mat3 } from "@/lib/vision/linalg";

/**
 * Evaluation E4, the real-photo half (docs/PLAN.md Phase 10; the synthetic half
 * is `pnpm evals:room`). The plan's acceptance test is a mean size error of at
 * most 10% on at least twelve real rooms, each containing an object whose height
 * was measured with a tape.
 *
 * THE MEASUREMENT. In a photograph, a vertical object of known height standing
 * on the floor has a height in pixels that can simply be read off the picture —
 * mark its foot and its top. The geometry, given only the camera it recovered,
 * predicts what that height in pixels should be. The relative difference between
 * the two is the size error: exactly what a shopper sees when a sofa is drawn
 * too big. Nothing here depends on how the camera was recovered, so the sheet of
 * paper and the paper-free mode are measured by the same yardstick.
 *
 *   predicted = projectedHeight(K, pose, spot under the marked foot, true height)
 *   measured  = distance in pixels between the marked foot and the marked top
 *   error     = |predicted − measured| / measured
 *
 * PRIVACY. Only these numbers leave the browser, and only when George exports
 * them: no photograph, and no pixel of one, is written to the repository or sent
 * anywhere (CLAUDE.md rule 9).
 */

export type E4Marks = {
  /** The four corners of the sheet of paper, in tap order. */
  sheet: Point2[];
  /** Where the measured object meets the floor. */
  base: Point2;
  /** The top of the measured object, directly above its foot. */
  top: Point2;
  /** Its height, measured with a tape, in centimetres. */
  objectHeightCm: number;
};

export type E4MethodResult = {
  /** Height in pixels the geometry predicts for the object. */
  predictedPx: number;
  /** Height in pixels marked on the photograph. */
  measuredPx: number;
  /** |predicted − measured| / measured: the size error a shopper would see. */
  sizeError: number;
  /** Camera height the method recovered, metres. */
  cameraHeight: number;
  /** Where the object's foot lands on the floor, metres from the camera. */
  distance: number;
};

/** Pixel distance between the two marks: the object's height as photographed. */
export function markedHeightPx(marks: Pick<E4Marks, "base" | "top">): number {
  return Math.hypot(marks.top[0] - marks.base[0], marks.top[1] - marks.base[1]);
}

/**
 * The size error of one method on one photo. Null when the recovered camera
 * cannot explain the marks at all — the object's foot above the horizon, or
 * behind the camera — which is itself a failure worth recording.
 */
export function measureWithPose(
  K: Mat3,
  pose: Pose,
  marks: E4Marks,
  cameraHeight: number,
  { maxDistance = 30 } = {},
): E4MethodResult | null {
  const spot = floorPointAt(K, pose, marks.base);
  if (spot === null) return null;
  // Just under the horizon a pixel means "impossibly far": a mark that lands
  // there says the recovered camera is wrong, not that the object is 80 m away.
  if (Math.hypot(spot[0], spot[1]) > maxDistance) return null;
  const predicted = projectedHeight(K, pose, spot[0], spot[1], marks.objectHeightCm / 100);
  if (predicted === null || !(predicted > 0)) return null;
  const measured = markedHeightPx(marks);
  if (!(measured > 0)) return null;
  return {
    predictedPx: predicted,
    measuredPx: measured,
    sizeError: Math.abs(predicted - measured) / measured,
    cameraHeight,
    distance: Math.hypot(spot[0], spot[1]),
  };
}

/** One photograph's results, as exported from the harness and read by the aggregation script. */
export type E4Record = {
  /** The photo's file name, so a result can be traced back. No image data is ever stored. */
  file: string;
  /** Pixel size of the photo as measured, for the record. */
  width: number;
  height: number;
  /** Where the focal length came from: EXIF, or the 69° assumption. */
  focalFrom: "exif" | "assumed";
  objectHeightCm: number;
  paper: E4MethodResult | null;
  depth: (E4MethodResult & { floorShare: number; planeRmsRelative: number; metric: boolean }) | null;
  /** Anything George noticed: "carpet", "sheet half in shadow", "tiled floor". */
  note?: string;
  measuredAt: string;
};

export type E4Summary = {
  /** Photos where the method produced an answer. */
  count: number;
  /** Photos where it could not, which the plan's target counts as failures. */
  failed: number;
  /** Mean absolute percentage error: the plan's acceptance number. */
  mape: number;
  p50: number;
  p90: number;
  /** Share of photos within 10%, the plan's per-photo expectation. */
  within10: number;
  /** Mean camera height recovered, metres: a sanity check against how the photos were taken. */
  meanCameraHeight: number;
};

function quantile(sorted: number[], p: number): number {
  if (sorted.length === 0) return Number.NaN;
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;
}

/** Summarises one method over a set of photographs. */
export function summariseE4(records: readonly E4Record[], method: "paper" | "depth"): E4Summary {
  const results = records.map((record) => record[method]);
  const measured = results.filter((result): result is NonNullable<typeof result> => result !== null);
  const errors = measured.map((result) => result.sizeError).sort((a, b) => a - b);
  const mean = (values: number[]) => (values.length === 0 ? Number.NaN : values.reduce((sum, value) => sum + value, 0) / values.length);
  return {
    count: measured.length,
    failed: results.length - measured.length,
    mape: mean(errors),
    p50: quantile(errors, 0.5),
    p90: quantile(errors, 0.9),
    within10: errors.length === 0 ? Number.NaN : errors.filter((error) => error <= 0.1).length / errors.length,
    meanCameraHeight: mean(measured.map((result) => result.cameraHeight)),
  };
}

/** Both methods on the same photographs, plus the rooms where only one of them worked. */
export function compareMethods(records: readonly E4Record[]): {
  paper: E4Summary;
  depth: E4Summary;
  /** Photos where both methods answered: the fair comparison. */
  both: { count: number; paperMape: number; depthMape: number; depthWorseBy: number };
} {
  const shared = records.filter((record) => record.paper !== null && record.depth !== null);
  const paperErrors = shared.map((record) => record.paper!.sizeError);
  const depthErrors = shared.map((record) => record.depth!.sizeError);
  const mean = (values: number[]) => (values.length === 0 ? Number.NaN : values.reduce((sum, value) => sum + value, 0) / values.length);
  return {
    paper: summariseE4(records, "paper"),
    depth: summariseE4(records, "depth"),
    both: {
      count: shared.length,
      paperMape: mean(paperErrors),
      depthMape: mean(depthErrors),
      depthWorseBy: mean(depthErrors) - mean(paperErrors),
    },
  };
}
