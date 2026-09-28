/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Tests for reading ABO's spin and 3D model indexes and keeping an even set of frames.
 */

import { describe, expect, it } from "vitest";

import { extentMatches, parseModelIndex, parseSpinIndex, pickFrames } from "@/lib/catalog/turntable";

describe("parseSpinIndex", () => {
  it("groups frames by spin, in turning order", () => {
    const csv = [
      "spin_id,azimuth,image_id,height,width,path",
      "61c91265,1,41++eZZHP9L,248,1075,61/61c91265/61c91265_01.jpg",
      "61c91265,0,41wqHws7a6L,248,1075,61/61c91265/61c91265_00.jpg",
      "7a000001,0,51abc,800,800,7a/7a000001/7a000001_00.jpg",
      "",
    ].join("\n");
    const spins = parseSpinIndex(csv);
    expect(spins.get("61c91265")?.map((frame) => frame.azimuth)).toEqual([0, 1]);
    expect(spins.get("61c91265")?.[0]).toEqual({ spinId: "61c91265", azimuth: 0, path: "61/61c91265/61c91265_00.jpg", width: 1075, height: 248 });
    expect(spins.size).toBe(2);
  });
});

describe("pickFrames", () => {
  it("keeps every third of 72 frames, 15 degrees apart, from the front", () => {
    const frames = Array.from({ length: 72 }, (_, index) => index);
    const kept = pickFrames(frames, 24);
    expect(kept).toHaveLength(24);
    expect(kept.slice(0, 4)).toEqual([0, 3, 6, 9]);
    expect(kept.at(-1)).toBe(69);
  });

  it("keeps a short spin as it is", () => {
    expect(pickFrames([0, 1, 2], 24)).toEqual([0, 1, 2]);
  });
});

describe("parseModelIndex", () => {
  it("reads each model's path and extent by column name", () => {
    const csv = [
      "3dmodel_id,path,meshes,materials,textures,images,image_height_max,image_height_min,image_width_max,image_width_min,vertices,faces,extent_x,extent_y,extent_z",
      "B075QFCHM9,9/B075QFCHM9.glb,1,1,3,3,2048,2048,2048,2048,11973,19568,1.840071976184845,1.0669103860855103,2.3675915002822876",
    ].join("\n");
    expect(parseModelIndex(csv).get("B075QFCHM9")).toEqual({ modelId: "B075QFCHM9", path: "9/B075QFCHM9.glb", extentM: { x: 1.840071976184845, y: 1.0669103860855103, z: 2.3675915002822876 }, textures: 3, faces: 19568 });
  });
});

describe("extentMatches", () => {
  it("agrees within a quarter on each side, either way round", () => {
    expect(extentMatches({ x: 1.84, y: 0.8, z: 0.92 }, { w: 184, d: 92, h: 80 })).toBe(true);
    expect(extentMatches({ x: 0.92, y: 0.8, z: 1.84 }, { w: 184, d: 92, h: 80 })).toBe(true);
    expect(extentMatches({ x: 1.84, y: 0.4, z: 0.92 }, { w: 184, d: 92, h: 80 })).toBe(false);
    expect(extentMatches({ x: 1, y: 1, z: 1 }, null)).toBeNull();
  });
});
