/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Canvas drawing for the room stage: photo, taps, loupe, floor grid and the scaled product.
 */

import { boxCorners, projectPoint, upSign, type Placement, type Point2, type Pose } from "@/lib/vision/camera";
import type { Mat3, Vec3 } from "@/lib/vision/linalg";

/**
 * Draws the room stage: the photo, the taps and loupe while marking the sheet,
 * the recovered floor grid, and the product at true scale.
 *
 * All coordinates are canvas pixels of the working photo. `pixelRatio` is canvas
 * pixels per CSS pixel on screen, so strokes and the loupe keep the same visual
 * size on a phone and a desktop. Colours are paint on a photograph, where only
 * white and black with transparency stay legible on any room.
 */

export type Cutout = { image: CanvasImageSource; box: { x: number; y: number; width: number; height: number } };

export type SceneInput = {
  photo: CanvasImageSource;
  width: number;
  height: number;
  pixelRatio: number;
  taps: readonly Point2[];
  /** Where the loupe looks, while a finger or the keyboard marker is placing a corner. */
  loupe: Point2 | null;
  marker: Point2 | null;
  /**
   * `sheet` is the paper method's rectangle, drawn until the piece is placed;
   * the paper-free mode has no sheet, so the grid is centred on `gridCentre`
   * instead — the spot the piece will stand on.
   */
  camera: { K: Mat3; pose: Pose; sheet: readonly Point2[] | null; gridCentre: Point2 } | null;
  /** Pixels the paper-free mode found to be floor, drawn as a light wash so the shopper can see what it read. */
  floorPixels: readonly Point2[] | null;
  product: { placement: Placement; mode: "stand" | "lie"; cutout: Cutout | null; outline: boolean } | null;
};

const INK = "rgba(255, 255, 255, 0.92)";
const SHADOW_INK = "rgba(0, 0, 0, 0.45)";

export function drawScene(ctx: CanvasRenderingContext2D, scene: SceneInput) {
  const { width, height, pixelRatio: r } = scene;
  ctx.save();
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(scene.photo, 0, 0, width, height);

  if (scene.floorPixels !== null && scene.product === null) drawFloorWash(ctx, scene.floorPixels, scene.width, scene.height);
  if (scene.camera !== null) {
    drawFloorGrid(ctx, scene.camera.K, scene.camera.pose, scene.camera.gridCentre, r);
    if (scene.product === null && scene.camera.sheet !== null) drawSheet(ctx, scene.camera.K, scene.camera.pose, scene.camera.sheet, r);
  }
  if (scene.camera !== null && scene.product !== null) {
    drawProduct(ctx, scene.camera.K, scene.camera.pose, scene.product, r);
  }
  if (scene.camera === null) {
    scene.taps.forEach((tap, index) => drawTap(ctx, tap, index + 1, r));
    if (scene.taps.length > 1) {
      ctx.beginPath();
      scene.taps.forEach((tap, index) => (index === 0 ? ctx.moveTo(tap[0], tap[1]) : ctx.lineTo(tap[0], tap[1])));
      if (scene.taps.length === 4) ctx.closePath();
      strokeTwice(ctx, 1.5 * r);
    }
  }
  if (scene.marker !== null) drawMarker(ctx, scene.marker, r);
  if (scene.loupe !== null) drawLoupe(ctx, scene.photo, scene.loupe, width, height, r);
  ctx.restore();
}

/** A white line over a slightly wider dark one: readable on a white sheet and a dark floor alike. */
function strokeTwice(ctx: CanvasRenderingContext2D, lineWidth: number) {
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = SHADOW_INK;
  ctx.lineWidth = lineWidth + 2;
  ctx.stroke();
  ctx.strokeStyle = INK;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
}

function drawTap(ctx: CanvasRenderingContext2D, [x, y]: Point2, label: number, r: number) {
  ctx.beginPath();
  ctx.arc(x, y, 7 * r, 0, 2 * Math.PI);
  ctx.fillStyle = "rgba(29, 35, 48, 0.85)";
  ctx.fill();
  ctx.lineWidth = 2 * r;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.fillStyle = INK;
  ctx.font = `600 ${11 * r}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(label), x, y + 0.5 * r);
}

function drawMarker(ctx: CanvasRenderingContext2D, [x, y]: Point2, r: number) {
  ctx.beginPath();
  ctx.moveTo(x - 14 * r, y);
  ctx.lineTo(x - 4 * r, y);
  ctx.moveTo(x + 4 * r, y);
  ctx.lineTo(x + 14 * r, y);
  ctx.moveTo(x, y - 14 * r);
  ctx.lineTo(x, y - 4 * r);
  ctx.moveTo(x, y + 4 * r);
  ctx.lineTo(x, y + 14 * r);
  strokeTwice(ctx, 1.5 * r);
}

/**
 * A magnifier above the finger, so the corner being placed is not hidden under
 * it: a 3× view of the photo around the point, with a crosshair on the point.
 */
function drawLoupe(ctx: CanvasRenderingContext2D, photo: CanvasImageSource, [x, y]: Point2, width: number, height: number, r: number) {
  const radius = 64 * r;
  const zoom = 3;
  // Above the point, or below it when there is no room above.
  const cx = Math.min(Math.max(x, radius + 4 * r), width - radius - 4 * r);
  const cy = y - radius - 36 * r > radius ? y - radius - 36 * r : y + radius + 36 * r;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
  ctx.clip();
  const source = radius / zoom;
  ctx.drawImage(photo, x - source, y - source, source * 2, source * 2, cx - radius, cy - radius, radius * 2, radius * 2);
  ctx.restore();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
  strokeTwice(ctx, 2 * r);
  drawMarker(ctx, [cx, cy], r);
}

/**
 * Floor grid, 25 cm squares within 2 m of the sheet. Each line is drawn in
 * short pieces so the parts behind the camera can be skipped, and fades with
 * distance from the sheet so it reads as lying on the floor.
 */
function drawFloorGrid(ctx: CanvasRenderingContext2D, K: Mat3, pose: Pose, centre: Point2, r: number) {
  const [cx, cy] = centre;
  const extent = 2;
  const step = 0.25;
  const pieces = 16;
  ctx.lineCap = "round";
  for (const along of ["x", "y"] as const) {
    for (let offset = -extent; offset <= extent + 1e-9; offset += step) {
      for (let k = 0; k < pieces; k += 1) {
        const s0 = -extent + (2 * extent * k) / pieces;
        const s1 = -extent + (2 * extent * (k + 1)) / pieces;
        const a: Vec3 = along === "x" ? [cx + s0, cy + offset, 0] : [cx + offset, cy + s0, 0];
        const b: Vec3 = along === "x" ? [cx + s1, cy + offset, 0] : [cx + offset, cy + s1, 0];
        const pa = projectPoint(K, pose, a);
        const pb = projectPoint(K, pose, b);
        if (pa === null || pb === null) continue;
        const mid = Math.hypot((a[0] + b[0]) / 2 - cx, (a[1] + b[1]) / 2 - cy);
        const alpha = Math.max(0, 0.75 * (1 - mid / (extent * 1.1)));
        if (alpha <= 0.02) continue;
        ctx.beginPath();
        ctx.moveTo(pa[0], pa[1]);
        ctx.lineTo(pb[0], pb[1]);
        ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
        ctx.lineWidth = 1.25 * r;
        ctx.stroke();
      }
    }
  }
}

/**
 * The floor the paper-free mode read, as a wash of light dots on the pixels it
 * accepted. A shopper cannot check a plane equation, but they can see at a
 * glance whether the shop thinks the sofa is floor.
 */
function drawFloorWash(ctx: CanvasRenderingContext2D, pixels: readonly Point2[], width: number, height: number) {
  // The dots are sized to the sampling grid, so they read as a continuous wash
  // however densely the depth map was sampled.
  const step = Math.max(2, Math.round(Math.max(width, height) / 256));
  ctx.save();
  ctx.fillStyle = "rgba(245, 181, 68, 0.22)";
  for (const [x, y] of pixels) ctx.fillRect(x - step / 2, y - step / 2, step, step);
  ctx.restore();
}

function drawSheet(ctx: CanvasRenderingContext2D, K: Mat3, pose: Pose, sheet: readonly Point2[], r: number) {
  const projected = sheet.map((p) => projectPoint(K, pose, [p[0], p[1], 0]));
  if (projected.some((p) => p === null)) return;
  ctx.beginPath();
  projected.forEach((p, i) => (i === 0 ? ctx.moveTo(p![0], p![1]) : ctx.lineTo(p![0], p![1])));
  ctx.closePath();
  strokeTwice(ctx, 2 * r);
}

function drawProduct(
  ctx: CanvasRenderingContext2D,
  K: Mat3,
  pose: Pose,
  product: NonNullable<SceneInput["product"]>,
  r: number,
) {
  const corners = boxCorners(product.placement, upSign(pose)).map((p) => projectPoint(K, pose, p));
  if (corners.some((p) => p === null)) return;
  const points = corners as Point2[];
  const footprint = points.slice(0, 4);

  const path = (list: Point2[]) => {
    ctx.beginPath();
    list.forEach((p, i) => (i === 0 ? ctx.moveTo(p[0], p[1]) : ctx.lineTo(p[0], p[1])));
    ctx.closePath();
  };

  if (product.mode === "lie") {
    path(footprint);
    ctx.fillStyle = "rgba(29, 35, 48, 0.4)";
    ctx.fill();
    strokeTwice(ctx, 2 * r);
    return;
  }

  // Contact shadow: the footprint, darkened and blurred.
  ctx.save();
  if ("filter" in ctx) ctx.filter = `blur(${Math.max(4, 10 * r)}px)`;
  path(footprint);
  ctx.fillStyle = "rgba(0, 0, 0, 0.32)";
  ctx.fill();
  ctx.restore();

  if (product.cutout !== null) {
    // A billboard standing at the centre of the footprint: the photograph is
    // scaled so the product's real height, at that distance, is its height on
    // screen, and keeps its own proportions. (Filling the whole projected box
    // instead would count the top face seen from above as height and inflate a
    // deep sofa by half.) The outline, when shown, is the exact geometry.
    const { x, y, height } = product.placement;
    const base = projectPoint(K, pose, [x, y, 0]);
    const top = projectPoint(K, pose, [x, y, upSign(pose) * height]);
    if (base !== null && top !== null) {
      const heightPx = Math.hypot(top[0] - base[0], top[1] - base[1]);
      const { box } = product.cutout;
      const widthPx = heightPx * (box.width / box.height);
      // Draw upright along the projected vertical, which leans when the camera is rolled.
      const angle = Math.atan2(top[0] - base[0], base[1] - top[1]);
      ctx.save();
      ctx.translate(base[0], base[1]);
      ctx.rotate(angle);
      ctx.drawImage(product.cutout.image, box.x, box.y, box.width, box.height, -widthPx / 2, -heightPx, widthPx, heightPx);
      ctx.restore();
    }
  }

  if (product.outline || product.cutout === null) {
    const edges: [number, number][] = [
      [0, 1], [1, 2], [2, 3], [3, 0],
      [4, 5], [5, 6], [6, 7], [7, 4],
      [0, 4], [1, 5], [2, 6], [3, 7],
    ];
    ctx.beginPath();
    for (const [a, b] of edges) {
      ctx.moveTo(points[a]![0], points[a]![1]);
      ctx.lineTo(points[b]![0], points[b]![1]);
    }
    strokeTwice(ctx, 1.25 * r);
  }

}
