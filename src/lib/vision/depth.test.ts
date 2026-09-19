/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Tests the paper-free room geometry: floor, scale and pose recovered from a depth map.
 */

import { describe, expect, it } from "vitest";

import { seededRandom } from "@/lib/reco/simulate";
import { cameraCentre, floorPointAt, focalFromFov, intrinsics, projectedHeight, projectPoint, upSign } from "@/lib/vision/camera";
import { defaultSpot, floorFromDepth, judgeFloor, poseFromFloorPlane, sampleDepth } from "@/lib/vision/depth";
import { rotationDistanceDegrees, type Vec3 } from "@/lib/vision/linalg";
import { lookAtPose, renderDepth } from "@/lib/vision/synthetic";

const WIDTH = 320;
const HEIGHT = 240;
const K = intrinsics(focalFromFov(69, WIDTH), WIDTH, HEIGHT);

/** A phone 1.45 m up, looking down the room at the floor 2.2 m ahead. */
function scene(centre: Vec3 = [0.2, -1.6, 1.45], target: Vec3 = [0.1, 0.9, 0], roll = 0) {
  const pose = lookAtPose(centre, target, roll);
  return { pose, centre };
}

/**
 * The size error a shopper would see: a 45 cm box dropped at a pixel, drawn with
 * the recovered camera, compared with the same box drawn with the true camera.
 */
function sizeErrorAt(pixel: [number, number], truth: { K: typeof K; pose: ReturnType<typeof lookAtPose> }, found: { K: typeof K; pose: ReturnType<typeof lookAtPose> }, height = 0.45) {
  const trueSpot = floorPointAt(truth.K, truth.pose, pixel);
  const foundSpot = floorPointAt(found.K, found.pose, pixel);
  if (trueSpot === null || foundSpot === null) return null;
  const a = projectedHeight(truth.K, truth.pose, trueSpot[0], trueSpot[1], height);
  const b = projectedHeight(found.K, found.pose, foundSpot[0], foundSpot[1], height);
  if (a === null || b === null) return null;
  return Math.abs(b - a) / a;
}

describe("sampleDepth", () => {
  it("back-projects pixels to points at the distance the map gives", () => {
    const { pose } = scene();
    const depth = renderDepth(K, pose, WIDTH, HEIGHT, { wallY: 3 });
    const samples = sampleDepth(depth, K, 8);
    expect(samples.length).toBeGreaterThan(500);
    // A point's third coordinate is its depth, and its pixel projects back to where it came from.
    for (const sample of samples.slice(0, 20)) {
      expect(sample.point[2]).toBeCloseTo(depth.data[sample.v * WIDTH + sample.u]!, 6);
      const back = projectPoint(K, { R: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0] }, sample.point)!;
      expect(back[0]).toBeCloseTo(sample.u, 3);
      expect(back[1]).toBeCloseTo(sample.v, 3);
    }
  });

  it("skips pixels the model gave no reading for", () => {
    const depth = { data: new Float32Array([1, 0, 2, Number.NaN]), width: 2, height: 2 };
    expect(sampleDepth(depth, K, 1).length).toBe(2);
  });
});

describe("poseFromFloorPlane", () => {
  it("puts the origin under the camera, +Z up and +Y where the camera looks", () => {
    // A level camera 1.4 m above the floor: the floor's normal in camera coordinates is −y.
    const solved = poseFromFloorPlane({ normal: [0, -1, 0], d: 1.4 })!;
    expect(solved.height).toBeCloseTo(1.4, 9);
    // 10 m straight ahead on the floor is 10 m along the optical axis and 1.4 m below.
    const ahead = projectPoint(intrinsics(1, 0, 0), solved.pose, [0, 10, 0]);
    expect(ahead).not.toBeNull();
    expect(cameraCentre(solved.pose)[2]).toBeCloseTo(1.4, 9);
    expect(upSign(solved.pose)).toBe(1);
  });

  it("reads the plane's sign either way round", () => {
    const a = poseFromFloorPlane({ normal: [0, -1, 0], d: 1.4 })!;
    const b = poseFromFloorPlane({ normal: [0, 1, 0], d: -1.4 })!;
    expect(b.height).toBeCloseTo(a.height, 9);
    expect(rotationDistanceDegrees(a.pose.R, b.pose.R)).toBeLessThan(1e-6);
  });

  it("refuses a camera standing on the floor", () => {
    expect(poseFromFloorPlane({ normal: [0, -1, 0], d: 0 })).toBeNull();
  });
});

describe("floorFromDepth on exact depth", () => {
  it("recovers the camera height, the tilt and the size of things", () => {
    const { pose, centre } = scene();
    const depth = renderDepth(K, pose, WIDTH, HEIGHT, { wallY: 3 });
    const floor = floorFromDepth(depth, K, { random: seededRandom(5) })!;

    expect(floor).not.toBeNull();
    expect(floor.cameraHeight).toBeCloseTo(centre[2], 2);
    expect(floor.scale).toBe(1);
    expect(floor.planeRms).toBeLessThan(0.005);
    expect(floor.coverage).toBeGreaterThan(0.9);
    expect(judgeFloor(floor)).toEqual({ ok: true, reason: null });

    // The world frame differs from the true one (its origin is under the camera),
    // but what a shopper sees — the size of a piece on the floor — must agree.
    for (const pixel of [[160, 200], [80, 180], [250, 220]] as [number, number][]) {
      const error = sizeErrorAt(pixel, { K, pose }, { K, pose: floor.pose });
      expect(error).not.toBeNull();
      expect(error!).toBeLessThan(0.02);
    }
  });

  it("is not fooled by a table top, which is horizontal too", () => {
    const { pose, centre } = scene();
    // A large low table between the camera and the wall, covering much of the view.
    const depth = renderDepth(K, pose, WIDTH, HEIGHT, {
      wallY: 3,
      boxes: [{ x: 0.1, y: 1.0, width: 2.4, depth: 1.4, height: 0.42 }],
    });
    const floor = floorFromDepth(depth, K, { random: seededRandom(11) })!;
    expect(floor).not.toBeNull();
    // The table top would read as a camera 1.03 m up; the floor is the plane below it.
    expect(floor.cameraHeight).toBeCloseTo(centre[2], 1);
  });

  it("refuses a photo of a wall, where no floor is in view", () => {
    // Camera level, facing a wall 2 m away: the floor is out of frame.
    const pose = lookAtPose([0, -1, 1.4], [0, 1, 1.4]);
    const depth = renderDepth(K, pose, WIDTH, HEIGHT, { wallY: 1 });
    const floor = floorFromDepth(depth, K, { random: seededRandom(3) });
    expect(judgeFloor(floor).ok).toBe(false);
  });

  it("survives noise and missing readings from a real model", () => {
    const random = seededRandom(23);
    const { pose, centre } = scene();
    // 3% relative depth noise and 10% of pixels without a reading.
    const depth = renderDepth(K, pose, WIDTH, HEIGHT, { wallY: 3, noise: 0.03, holes: 0.1, random });
    const floor = floorFromDepth(depth, K, { random: seededRandom(29) })!;
    expect(floor).not.toBeNull();
    expect(Math.abs(floor.cameraHeight - centre[2]) / centre[2]).toBeLessThan(0.1);
    const error = sizeErrorAt([160, 200], { K, pose }, { K, pose: floor.pose });
    expect(error!).toBeLessThan(0.15);
  });

  it("fixes the scale from the assumed camera height when the model is not metric", () => {
    const { pose } = scene();
    const metric = renderDepth(K, pose, WIDTH, HEIGHT, { wallY: 3 });
    // A relative model: every distance multiplied by the same unknown factor.
    const relative = { ...metric, data: metric.data.map((z) => z * 3.7) as Float32Array };
    const floor = floorFromDepth(relative, K, { metric: false, cameraHeight: 1.45, random: seededRandom(7) })!;
    expect(floor.cameraHeight).toBeCloseTo(1.45, 6);
    expect(floor.scale).toBeCloseTo(1 / 3.7, 2);
    // With the true height assumed, the geometry is as good as metric depth.
    const error = sizeErrorAt([160, 200], { K, pose }, { K, pose: floor.pose });
    expect(error!).toBeLessThan(0.03);
  });

  it("makes size error follow the error in the assumed height, and nothing else", () => {
    const { pose } = scene();
    const metric = renderDepth(K, pose, WIDTH, HEIGHT, { wallY: 3 });
    const relative = { ...metric, data: metric.data.map((z) => z * 2) as Float32Array };
    // Assuming 10% too tall must not cost more than about 10% in drawn size.
    const floor = floorFromDepth(relative, K, { metric: false, cameraHeight: 1.45 * 1.1, random: seededRandom(13) })!;
    const error = sizeErrorAt([160, 200], { K, pose }, { K, pose: floor.pose })!;
    expect(error).toBeGreaterThan(0.05);
    expect(error).toBeLessThan(0.13);
  });

  it("finds a thin strip of floor under a wall that fills most of the photo", () => {
    // Camera level, 1 m up, a wall 2.5 m ahead: the floor is the bottom tenth of the picture.
    // With RANSAC restricted to near-level planes, bands of this wall cut at the limit won instead.
    const pose = lookAtPose([0, -1.5, 1], [0, 1, 1]);
    const depth = renderDepth(K, pose, WIDTH, HEIGHT, { wallY: 1 });
    const floor = floorFromDepth(depth, K, { random: seededRandom(17) })!;
    expect(floor).not.toBeNull();
    expect(floor.tiltDegrees).toBeLessThan(2);
    // The foot of the wall sits inside the floor's inlier band; it is the wall's, and stays out.
    expect(floor.cameraHeight).toBeCloseTo(1, 2);
    expect(sizeErrorAt([160, 225], { K, pose }, { K, pose: floor.pose })!).toBeLessThan(0.01);
  });

  it("does not take a wall leaning away from the camera for the floor", () => {
    // A monocular model often draws the top of the back wall further away than its foot, which
    // makes the wall look like a floor tilted 65° — inside the tilt limit, and 3.2 m from the
    // camera, further than the real floor 1.2 m below. Only planes parallel to the most level one
    // may be the floor, so the wall is never a candidate. Drawn directly: level camera, floor
    // y = 1.2, wall meeting it 3 m ahead and leaning back by 25°.
    const h = 1.2;
    const D = 3;
    const lean = Math.tan((25 * Math.PI) / 180);
    const data = new Float32Array(WIDTH * HEIGHT);
    for (let v = 0; v < HEIGHT; v += 1) {
      for (let u = 0; u < WIDTH; u += 1) {
        const ry = (v + 0.5 - K[5]) / K[4];
        const toFloor = ry > 0 ? h / ry : Infinity;
        const toWall = (D + h * lean) / (1 + ry * lean);
        data[v * WIDTH + u] = Math.min(toFloor, toWall > 0 && toWall * ry <= h ? toWall : Infinity);
      }
    }
    const floor = floorFromDepth({ data, width: WIDTH, height: HEIGHT }, K, { random: seededRandom(19) })!;
    expect(floor).not.toBeNull();
    expect(floor.cameraHeight).toBeCloseTo(h, 2);
    expect(floor.tiltDegrees).toBeLessThan(2);
  });

  it("corrects a metric model's distances for the lens that took the photo", () => {
    // A model trained with a 47° lens, shown a photo from a 69° phone camera, answers as if its
    // own camera had taken it: every distance is too long by f_model / f_photo, about 1.59.
    const { pose, centre } = scene();
    const truth = renderDepth(K, pose, WIDTH, HEIGHT, { wallY: 3 });
    const modelFocal = focalFromFov(47, WIDTH);
    const stretch = modelFocal / K[0];
    const model = { ...truth, data: truth.data.map((z) => z * stretch) as Float32Array };

    // Told which lens its distances assume, the geometry puts the room back at its true depth.
    const corrected = floorFromDepth({ ...model, focal: modelFocal }, K, { random: seededRandom(31) })!;
    expect(corrected.lensFactor).toBeCloseTo(1 / stretch, 9);
    expect(corrected.cameraHeight).toBeCloseTo(centre[2], 2);
    expect(sizeErrorAt([160, 200], { K, pose }, { K, pose: corrected.pose })!).toBeLessThan(0.02);

    // Not told, the room is 1.6 times too deep and a piece is drawn about a third too small.
    const uncorrected = floorFromDepth(model, K, { random: seededRandom(31) })!;
    expect(uncorrected.lensFactor).toBe(1);
    expect(uncorrected.cameraHeight).toBeGreaterThan(centre[2] * 1.3);
    expect(sizeErrorAt([160, 200], { K, pose }, { K, pose: uncorrected.pose })!).toBeGreaterThan(0.25);
  });

  it("returns nothing for an empty or tiny depth map", () => {
    expect(floorFromDepth({ data: new Float32Array(16), width: 4, height: 4 }, K)).toBeNull();
    expect(judgeFloor(null)).toEqual({ ok: false, reason: "no_floor" });
  });
});

describe("defaultSpot", () => {
  it("stands a wide piece far enough back to be seen whole", () => {
    const { pose } = scene();
    const depth = renderDepth(K, pose, WIDTH, HEIGHT, { wallY: 3 });
    const floor = floorFromDepth(depth, K, { random: seededRandom(4) })!;
    const camera = { focal: K[0], imageWidth: WIDTH };

    const table = defaultSpot(floor, { width: 0.5, ...camera });
    const sofa = defaultSpot(floor, { width: 2.33, ...camera });
    expect(sofa.y).toBeGreaterThan(table.y);

    // Both ends of the sofa land inside the photo, which is the point.
    for (const side of [-1, 1]) {
      const end = projectPoint(K, floor.pose, [sofa.x + (side * 2.33) / 2, sofa.y, 0]);
      expect(end).not.toBeNull();
      expect(end![0]).toBeGreaterThan(0);
      expect(end![0]).toBeLessThan(WIDTH);
    }
  });

  it("stands the piece ahead of the camera, closer when the photo looks steeply down", () => {
    const { pose } = scene();
    const depth = renderDepth(K, pose, WIDTH, HEIGHT, { wallY: 3 });
    const floor = floorFromDepth(depth, K, { random: seededRandom(2) })!;
    const spot = defaultSpot(floor);
    expect(spot.x).toBe(0);
    expect(spot.y).toBeGreaterThan(0.6);
    // It lands inside the photo, which is the point of choosing it at all.
    const pixel = projectPoint(K, floor.pose, [spot.x, spot.y, 0]);
    expect(pixel).not.toBeNull();
    expect(pixel![0]).toBeGreaterThan(0);
    expect(pixel![0]).toBeLessThan(WIDTH);
    expect(pixel![1]).toBeGreaterThan(0);
    expect(pixel![1]).toBeLessThan(HEIGHT);
  });
});
