/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Drawn sample room with known camera geometry for trying and testing room placement.
 */

import { cameraCentre, focalFromFov, intrinsics, projectPoint, A4_SHEET, type Point2, type Pose } from "@/lib/vision/camera";
import { add3, dot3, invert3, mulMat3Vec, scale3, sub3, transpose3, type Mat3, type Vec3 } from "@/lib/vision/linalg";
import { lookAtPose } from "@/lib/vision/synthetic";

/**
 * A drawn sample room, so the flow can be tried without a photo, and tested
 * end to end with corners whose true positions are known.
 *
 * It is rendered with the same pinhole camera the geometry recovers: a phone
 * 1.4 m above an oak floor, a sheet of A4 paper about 1.4 m ahead on the floor,
 * and a wall behind it. The page labels it as a drawing. Colours here are illustration paint,
 * not interface colours, so they do not come from the design tokens.
 */

export const SAMPLE_WIDTH = 1600;
export const SAMPLE_HEIGHT = 1200;
const FOV_DEGREES = 69;
const WALL_Y = 2.8;

export function sampleRoomGeometry(): { K: Mat3; pose: Pose; fovDegrees: number; sheetImage: Point2[]; sheetWorld: Point2[] } {
  const K = intrinsics(focalFromFov(FOV_DEGREES, SAMPLE_WIDTH), SAMPLE_WIDTH, SAMPLE_HEIGHT);
  const pose = lookAtPose([0.1, -1.2, 1.4], [0.1, 0.55, 0], -0.01);
  const angle = 0.35;
  const { width: w, length: l } = A4_SHEET;
  const sheetWorld: Point2[] = [
    [-l / 2, -w / 2],
    [l / 2, -w / 2],
    [l / 2, w / 2],
    [-l / 2, w / 2],
  ].map(([x, y]) => [0.1 + Math.cos(angle) * x! - Math.sin(angle) * y!, 0.2 + Math.sin(angle) * x! + Math.cos(angle) * y!]);
  const sheetImage = sheetWorld.map((p) => projectPoint(K, pose, [p[0], p[1], 0])!);
  return { K, pose, fovDegrees: FOV_DEGREES, sheetImage, sheetWorld };
}

export function drawSampleRoom(ctx: CanvasRenderingContext2D) {
  const { K, pose, sheetWorld } = sampleRoomGeometry();
  const project = (p: Vec3) => projectPoint(K, pose, p);

  const polygon = (points: Vec3[], fill: string | CanvasGradient) => {
    const projected = points.map(project);
    if (projected.some((p) => p === null)) return;
    ctx.beginPath();
    projected.forEach((p, i) => (i === 0 ? ctx.moveTo(p![0], p![1]) : ctx.lineTo(p![0], p![1])));
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  };

  // Wall, with light falling off towards the top.
  const wall = ctx.createLinearGradient(0, 0, 0, SAMPLE_HEIGHT * 0.6);
  wall.addColorStop(0, "#c9c4bb");
  wall.addColorStop(1, "#e2ddd4");
  ctx.fillStyle = wall;
  ctx.fillRect(0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);

  // Oak floor from just in front of the camera to the wall.
  const floorTop = project([0, WALL_Y, 0])![1];
  const floor = ctx.createLinearGradient(0, floorTop, 0, SAMPLE_HEIGHT);
  floor.addColorStop(0, "#9c7a55");
  floor.addColorStop(1, "#b88f63");
  polygon(
    [
      [-6, -0.6, 0],
      [6, -0.6, 0],
      [6, WALL_Y, 0],
      [-6, WALL_Y, 0],
    ],
    floor,
  );

  // Planks: seams every 18 cm, running away from the camera.
  ctx.strokeStyle = "rgba(60, 40, 22, 0.28)";
  ctx.lineWidth = 2;
  for (let x = -6; x <= 6; x += 0.18) {
    const a = project([x, -0.6, 0]);
    const b = project([x, WALL_Y, 0]);
    if (a === null || b === null) continue;
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.stroke();
  }

  // Skirting board along the wall.
  polygon(
    [
      [-6, WALL_Y, 0],
      [6, WALL_Y, 0],
      [6, WALL_Y, 0.09],
      [-6, WALL_Y, 0.09],
    ],
    "#f1eee8",
  );

  // The sheet of paper, with a faint contact shadow.
  const lifted = sheetWorld.map(([x, y]) => [x + 0.004, y - 0.004, 0] as Vec3);
  polygon(lifted, "rgba(40, 28, 16, 0.25)");
  polygon(
    sheetWorld.map(([x, y]) => [x, y, 0] as Vec3),
    "#f7f7f4",
  );
}

/**
 * The exact depth of the drawn room, pixel by pixel: the distance from the
 * camera to the floor or to the wall along each ray, in metres.
 *
 * This is what a depth model estimates from a photograph, here known exactly
 * because the room was drawn with a known camera. It lets the paper-free mode
 * be used, and tested end to end, without a model: the geometry that follows is
 * the same code either way, and its answer can be checked against the camera
 * the room was drawn with.
 */
export function sampleRoomDepth(): { data: Float32Array; width: number; height: number } {
  const { K, pose } = sampleRoomGeometry();
  const centre = cameraCentre(pose);
  const Kinv = invert3(K);
  const Rt = transpose3(pose.R);
  const forward: Vec3 = [pose.R[6], pose.R[7], pose.R[8]];
  const data = new Float32Array(SAMPLE_WIDTH * SAMPLE_HEIGHT);

  for (let v = 0; v < SAMPLE_HEIGHT; v += 1) {
    for (let u = 0; u < SAMPLE_WIDTH; u += 1) {
      const direction = mulMat3Vec(Rt, mulMat3Vec(Kinv, [u, v, 1]));
      let nearest = Infinity;
      // The floor, Z = 0.
      if (Math.abs(direction[2]) > 1e-12) {
        const s = -centre[2] / direction[2];
        if (s > 0) nearest = Math.min(nearest, s);
      }
      // The wall across the room, above the floor.
      if (Math.abs(direction[1]) > 1e-12) {
        const s = (WALL_Y - centre[1]) / direction[1];
        if (s > 0 && add3(centre, scale3(direction, s))[2] >= 0) nearest = Math.min(nearest, s);
      }
      if (!Number.isFinite(nearest)) continue;
      data[v * SAMPLE_WIDTH + u] = dot3(forward, sub3(add3(centre, scale3(direction, nearest)), centre));
    }
  }
  return { data, width: SAMPLE_WIDTH, height: SAMPLE_HEIGHT };
}
