/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Tests the letterbox into a depth model and the depth map's return onto the photo.
 */

import { describe, expect, it } from "vitest";

import { depthStats, depthToPhoto, IMAGENET_MEAN, IMAGENET_STD, letterbox } from "@/lib/vision/depth-image";

/** A photo whose red channel counts along x and green along y, so any resampling error shows up as a shifted value. */
function ramp(width: number, height: number): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      rgba[index] = Math.round((255 * x) / Math.max(1, width - 1));
      rgba[index + 1] = Math.round((255 * y) / Math.max(1, height - 1));
      rgba[index + 2] = 128;
      rgba[index + 3] = 255;
    }
  }
  return rgba;
}

describe("letterbox", () => {
  it("fits a 4:3 photo into the square without stretching it", () => {
    const box = letterbox(ramp(640, 480), 640, 480, 518);
    expect(box.innerWidth).toBe(518);
    expect(box.innerHeight).toBe(389); // 480 · 518/640, rounded
    expect(box.dx).toBe(0);
    expect(box.dy).toBe(64);
    expect(box.scale).toBeCloseTo(640 / 518, 6);
    expect(box.tensor.length).toBe(3 * 518 * 518);
  });

  it("normalises with the statistics the model was trained on", () => {
    const white = new Uint8ClampedArray(4 * 4 * 4).fill(255);
    const box = letterbox(white, 4, 4, 4);
    // A white pixel becomes (1 − mean) / std in each channel.
    for (let channel = 0; channel < 3; channel += 1) {
      expect(box.tensor[channel * 16]).toBeCloseTo((1 - IMAGENET_MEAN[channel]!) / IMAGENET_STD[channel]!, 5);
    }
  });

  it("fills the strips with grey rather than leaving them black", () => {
    const box = letterbox(ramp(100, 50), 100, 50, 20);
    // Top-left corner is padding for a wide photo.
    expect(box.dy).toBeGreaterThan(0);
    expect(box.tensor[0]).toBeCloseTo((0.5 - IMAGENET_MEAN[0]!) / IMAGENET_STD[0]!, 5);
  });

  it("keeps the picture's own gradient, so nothing is mirrored or shifted", () => {
    const size = 64;
    const box = letterbox(ramp(128, 128), 128, 128, size);
    const red = (x: number, y: number) => box.tensor[y * size + x]! * IMAGENET_STD[0]! + IMAGENET_MEAN[0]!;
    expect(red(2, 32)).toBeLessThan(red(32, 32));
    expect(red(32, 32)).toBeLessThan(red(61, 32));
    const green = (x: number, y: number) => box.tensor[size * size + y * size + x]! * IMAGENET_STD[1]! + IMAGENET_MEAN[1]!;
    expect(green(32, 2)).toBeLessThan(green(32, 61));
  });

  it("refuses an empty image", () => {
    expect(() => letterbox(new Uint8ClampedArray(0), 0, 10, 518)).toThrow(RangeError);
  });
});

describe("depthToPhoto", () => {
  it("returns a depth map on the photo's own pixels, with the values it had", () => {
    const width = 160;
    const height = 120;
    const box = letterbox(ramp(width, height), width, height, 64);
    // A model answer that varies smoothly, so bilinear sampling is exact enough to check.
    const model = new Float32Array(64 * 64);
    for (let y = 0; y < 64; y += 1) for (let x = 0; x < 64; x += 1) model[y * 64 + x] = 1 + 0.01 * x + 0.02 * y;

    const depth = depthToPhoto(model, box, width, height);
    expect(depth.width).toBe(width);
    expect(depth.height).toBe(height);
    const centre = depth.data[Math.floor(height / 2) * width + Math.floor(width / 2)]!;
    expect(centre).toBeCloseTo(model[32 * 64 + 32]!, 1);
    // Every pixel of the photo has a reading: the photo is entirely inside the square.
    expect(depthStats(depth).valid).toBeGreaterThan(0.99);
  });

  it("never reads the grey strips", () => {
    const width = 200;
    const height = 50;
    const box = letterbox(ramp(width, height), width, height, 32);
    // Padding is the poisoned value; if it leaked in, some photo pixel would carry it.
    const model = new Float32Array(32 * 32).fill(99);
    for (let y = box.dy; y < box.dy + box.innerHeight; y += 1) for (let x = box.dx; x < box.dx + box.innerWidth; x += 1) model[y * 32 + x] = 2;
    const depth = depthToPhoto(model, box, width, height);
    expect(Math.max(...depth.data)).toBeLessThan(2.001);
    expect(depthStats(depth).median).toBeCloseTo(2, 3);
  });
});

describe("depthStats", () => {
  it("reports what carries a reading and how far it goes", () => {
    const stats = depthStats({ data: new Float32Array([0, 1, 2, 3]), width: 2, height: 2 });
    expect(stats.valid).toBe(0.75);
    expect(stats.median).toBe(2);
    expect(stats.min).toBe(1);
    expect(stats.max).toBe(3);
    expect(depthStats({ data: new Float32Array(4), width: 2, height: 2 })).toEqual({ valid: 0, median: 0, min: 0, max: 0 });
  });
});
