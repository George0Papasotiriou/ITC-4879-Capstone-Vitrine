/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Tests for the colour reading: CIELAB, the season's rules, and a synthetic face read the same under a coloured lamp once the whites of its eyes correct the light.
 */

import { describe, expect, it } from "vitest";

import type { Point2 } from "@/lib/vision/camera";
import { hueOf, itaOf, labToSrgb, linearToLab, readColours, seasonOf, SEASON_PALETTES } from "@/lib/vision/colour-season";
import { FACE_OUTLINE, IRISES, LANDMARK, LEFT_EYE_OUTLINE, RIGHT_EYE_OUTLINE } from "@/lib/vision/mirror/face-model";
import { irisDiameterPx } from "@/lib/vision/mirror/iris";
import { insidePolygon } from "@/lib/vision/mirror/light";
import { scriptedLandmarks } from "@/lib/vision/mirror/scripted";

const WIDTH = 640;
const HEIGHT = 480;

/** A drawn face where the landmarks say it is: skin everywhere, white eyes with coloured irises, hair above the forehead, all under a lamp of the given colour. */
function face(skin: [number, number, number], hair: [number, number, number], lamp: [number, number, number] = [1, 1, 1]) {
  const landmarks = scriptedLandmarks({ yaw: 0, pitch: 0, roll: 0, distanceMm: 450, size: 1 }, WIDTH, HEIGHT);
  const rgba = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
  const width = landmarks[LANDMARK.leftFaceEdge]![0] - landmarks[LANDMARK.rightFaceEdge]![0];
  const hairCentres = FACE_OUTLINE.slice(0, 4).concat(FACE_OUTLINE.slice(-4)).map((k) => landmarks[k]!);
  const eyes = [RIGHT_EYE_OUTLINE, LEFT_EYE_OUTLINE].map((outline) => outline.map((k) => landmarks[k]!));
  const irises = IRISES.map((iris) => ({ centre: landmarks[iris.centre]!, radius: irisDiameterPx(landmarks, iris)! / 2 }));
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      let colour = skin;
      const point: Point2 = [x + 0.5, y + 0.5];
      if (hairCentres.some(([hx, hy]) => (x - hx) ** 2 + (y - (hy - width * 0.1)) ** 2 < (width * 0.07) ** 2)) colour = hair;
      if (eyes.some((outline) => insidePolygon(point, outline))) colour = [220, 220, 216];
      if (irises.some(({ centre, radius }) => (x - centre[0]) ** 2 + (y - centre[1]) ** 2 < radius * radius)) colour = [90, 60, 40];
      rgba.set([colour[0] * lamp[0], colour[1] * lamp[1], colour[2] * lamp[2], 255], (y * WIDTH + x) * 4);
    }
  }
  return { picture: { rgba, width: WIDTH, height: HEIGHT }, landmarks };
}

describe("colour in CIELAB", () => {
  it("puts white at the top of lightness with no colour, and goes back to the same sRGB", () => {
    const white = linearToLab([1, 1, 1]);
    expect(white.L).toBeCloseTo(100, 1);
    expect(Math.abs(white.a)).toBeLessThan(0.5);
    expect(Math.abs(white.b)).toBeLessThan(0.5);
    expect(labToSrgb(linearToLab([0.2, 0.3, 0.4]))).toEqual([124, 149, 170]);
    // Light skin has a high ITA; a yellowish skin a larger hue angle than a pinkish one.
    expect(itaOf({ L: 70, a: 10, b: 15 })).toBeGreaterThan(50);
    expect(hueOf({ L: 65, a: 10, b: 20 })).toBeGreaterThan(hueOf({ L: 65, a: 14, b: 12 }));
  });

  it("sorts warmth, depth and contrast into the four seasons", () => {
    expect(seasonOf(45, 60, 20).season).toBe("spring");
    expect(seasonOf(10, 60, 20).season).toBe("autumn");
    expect(seasonOf(45, 50, 20).season).toBe("summer");
    expect(seasonOf(45, 50, 50).season).toBe("winter");
    expect(seasonOf(10, 50, null).season).toBe("winter");
    for (const { palette, avoid } of Object.values(SEASON_PALETTES)) expect(palette.filter((colour) => avoid.includes(colour))).toEqual([]);
  });
});

describe("reading a face", () => {
  const golden: [number, number, number] = [226, 186, 150];
  const rosy: [number, number, number] = [228, 182, 178];

  it("reads a light golden face as spring, and a light rosy face with light hair as summer", () => {
    const warm = face(golden, [190, 150, 90]);
    expect(readColours(warm.picture, warm.landmarks)!.season).toBe("spring");
    const cool = face(rosy, [200, 190, 175]);
    const reading = readColours(cool.picture, cool.landmarks)!;
    expect(reading.season).toBe("summer");
    expect(reading.whiteBalanced).toBe(true);
    expect(reading.palette).toContain("pink");
  });

  it("reads the same face under a cold blue lamp only when the whites of the eyes correct the light", () => {
    // A cold lamp strong enough to turn the golden skin bluish (its hue angle from 68° to below zero).
    const lamp: [number, number, number] = [0.75, 0.9, 1.15];
    const underLamp = face(golden, [190, 150, 90], lamp);
    expect(readColours(underLamp.picture, underLamp.landmarks)!.season).toBe("spring");
    expect(readColours(underLamp.picture, underLamp.landmarks, { whiteBalance: false })!.warm).toBe(false);
  });

  it("refuses a face too small to measure", () => {
    const tiny = scriptedLandmarks({ yaw: 0, pitch: 0, roll: 0, distanceMm: 20000, size: 1 }, 64, 48);
    expect(readColours({ rgba: new Uint8ClampedArray(64 * 48 * 4), width: 64, height: 48 }, tiny)).toBeNull();
  });
});
