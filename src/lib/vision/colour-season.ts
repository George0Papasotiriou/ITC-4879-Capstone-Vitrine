/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * A colour reading from a face: skin, eyes and hair measured in CIELAB under the light the whites of the eyes reveal, and the "season" of colours that suit them.
 */

import type { Point2 } from "@/lib/vision/camera";
import { toLinear, toSrgb } from "@/lib/vision/harmonize";
import { FACE_OUTLINE, IRISES, LANDMARK, LEFT_EYE_OUTLINE, RIGHT_EYE_OUTLINE, SKIN_SAMPLES } from "@/lib/vision/mirror/face-model";
import { irisDiameterPx } from "@/lib/vision/mirror/iris";
import { faceLight, pieceGains, scleraPixels } from "@/lib/vision/mirror/light";

/**
 * docs/adr/066. Seasonal colour analysis is a styling convention, not a
 * science: it sorts people by the warmth and depth of their colouring and
 * suggests colours of the same character. The shop presents it as that and
 * measures what it can measure honestly:
 *
 * 1. THE LIGHT. A camera picture's colours are the face's times the room's
 *    light. The whites of the eyes are near-neutral and much the same white
 *    on everyone (light.ts), so dividing every pixel by their colour and
 *    level (von Kries' rule, in linear light) leaves the face's own
 *    colours, whatever the lamp and however bright the room.
 * 2. THE SKIN, EYES AND HAIR, in CIELAB (D65): skin from round patches on
 *    the cheeks and forehead (the middle 70% of their lightness, so shine
 *    and shadow drop out); the irises without their pupils; the hair from a
 *    band just above the top of the face's outline.
 * 3. THE MEASURES.
 *    - Depth: the skin's individual typology angle,
 *      ITA° = atan((L* − 50) / b*) (Chardon, Cretois and Hourseau, 1991):
 *      above 28° is light to intermediate skin, below it tanned to dark.
 *    - Undertone: the skin's hue angle h = atan2(b*, a*). Skin hues sit
 *      between about 40° (pink) and 70° (yellow); from 55° up the skin is
 *      read as warm.
 *    - Contrast: how far the hair's lightness is from the skin's.
 * 4. THE SEASON: warm and light is spring, warm and deep autumn, cool and
 *    light with low contrast summer, cool and deep or high contrast winter.
 *    Each season's palette is in the shop's own colour words, so it can
 *    search with them.
 */

export type Lab = { L: number; a: number; b: number };
export type Season = "spring" | "summer" | "autumn" | "winter";

export type ColourReading = {
  season: Season;
  warm: boolean;
  light: boolean;
  skin: Lab;
  eyes: Lab | null;
  hair: Lab | null;
  ita: number;
  hue: number;
  contrast: number | null;
  /** Whether the light was corrected from the whites of the eyes. */
  whiteBalanced: boolean;
  palette: readonly string[];
  avoid: readonly string[];
};

export const WARM_HUE = 55;
export const LIGHT_ITA = 28;
export const HIGH_CONTRAST = 35;

/** Each season's colours and those to avoid, in the shop's colour words (search/vocabulary.ts). */
export const SEASON_PALETTES: Readonly<Record<Season, { palette: readonly string[]; avoid: readonly string[] }>> = {
  spring: { palette: ["beige", "yellow", "orange", "green", "gold", "pink", "brown"], avoid: ["black", "grey", "silver", "purple"] },
  summer: { palette: ["pink", "blue", "purple", "grey", "silver", "white", "beige"], avoid: ["orange", "black", "gold", "yellow"] },
  autumn: { palette: ["brown", "orange", "green", "gold", "yellow", "red", "beige"], avoid: ["black", "pink", "silver", "purple"] },
  winter: { palette: ["black", "white", "red", "blue", "purple", "silver", "grey"], avoid: ["orange", "beige", "gold", "brown"] },
};

/** Linear sRGB to CIELAB (D65 white). */
export function linearToLab([r, g, b]: readonly [number, number, number]): Lab {
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fy = f(y);
  return { L: 116 * fy - 16, a: 500 * (f(x) - fy), b: 200 * (fy - f(z)) };
}

export const itaOf = (lab: Lab): number => (Math.atan2(lab.L - 50, lab.b) * 180) / Math.PI;
export const hueOf = (lab: Lab): number => (Math.atan2(lab.b, lab.a) * 180) / Math.PI;

/** The season from the three measures (step 4). */
export function seasonOf(ita: number, hue: number, contrast: number | null): { season: Season; warm: boolean; light: boolean } {
  const warm = hue >= WARM_HUE;
  const light = ita >= LIGHT_ITA;
  const high = contrast !== null && contrast >= HIGH_CONTRAST;
  const season: Season = warm ? (light ? "spring" : "autumn") : light && !high ? "summer" : "winter";
  return { season, warm, light };
}

type Pixels = { rgba: ArrayLike<number>; width: number; height: number };

/** The linear pixels in a ring (a disc when `inner` is 0), corrected by the light's gains. */
function ring({ rgba, width, height }: Pixels, [cx, cy]: Point2, inner: number, radius: number, gains: readonly [number, number, number]): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let y = Math.max(0, Math.floor(cy - radius)); y <= Math.min(height - 1, Math.ceil(cy + radius)); y += 1) {
    for (let x = Math.max(0, Math.floor(cx - radius)); x <= Math.min(width - 1, Math.ceil(cx + radius)); x += 1) {
      const distance = (x - cx) ** 2 + (y - cy) ** 2;
      if (distance > radius * radius || distance < inner * inner) continue;
      const i = (y * width + x) * 4;
      out.push([toLinear(rgba[i]!) / gains[0], toLinear(rgba[i + 1]!) / gains[1], toLinear(rgba[i + 2]!) / gains[2]]);
    }
  }
  return out;
}

/** The median colour of pixels after dropping the darkest 15% and brightest 15% (shadow and shine), in Lab; null when too few. */
function robustLab(pixels: [number, number, number][], minimum = 12): Lab | null {
  if (pixels.length < minimum) return null;
  const luminance = (p: [number, number, number]) => 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];
  const sorted = [...pixels].sort((a, b) => luminance(a) - luminance(b));
  const kept = sorted.slice(Math.floor(sorted.length * 0.15), Math.ceil(sorted.length * 0.85));
  const median = (channel: 0 | 1 | 2) => [...kept.map((p) => p[channel])].sort((a, b) => a - b)[Math.floor(kept.length / 2)]!;
  return linearToLab([median(0), median(1), median(2)]);
}

/**
 * The reading from one picture and its landmarks (pixels of the same
 * picture); null when the skin cannot be measured. `whiteBalance: false`
 * skips step 1 (E15 measures what it is worth).
 */
export function readColours(picture: Pixels, landmarks: readonly Point2[], { whiteBalance = true } = {}): ColourReading | null {
  const faceWidth = Math.hypot(landmarks[LANDMARK.leftFaceEdge]![0] - landmarks[LANDMARK.rightFaceEdge]![0], landmarks[LANDMARK.leftFaceEdge]![1] - landmarks[LANDMARK.rightFaceEdge]![1]);
  if (!(faceWidth > 20)) return null;

  // 1. The light, from the whites of both eyes.
  let gains: [number, number, number] = [1, 1, 1];
  let whiteBalanced = false;
  if (whiteBalance) {
    const sclera = [RIGHT_EYE_OUTLINE, LEFT_EYE_OUTLINE].flatMap((outline, index) => {
      const iris = IRISES[index]!;
      const diameter = irisDiameterPx(landmarks, iris);
      if (diameter === null) return [];
      return scleraPixels(picture.rgba, picture.width, picture.height, outline.map((k) => landmarks[k]!), { centre: landmarks[iris.centre]!, radius: diameter / 2 });
    });
    const light = faceLight(sclera);
    if (light !== null) {
      // Colour and brightness both: the sclera is the same white on every face, so its level is the light's level.
      gains = pieceGains(light);
      whiteBalanced = true;
    }
  }

  // 2. Skin, eyes and hair.
  const patch = faceWidth * 0.045;
  const skin = robustLab(SKIN_SAMPLES.flatMap((k) => ring(picture, landmarks[k]!, 0, patch, gains)));
  if (skin === null) return null;
  const irisPixels = IRISES.flatMap((iris) => {
    const diameter = irisDiameterPx(landmarks, iris);
    if (diameter === null) return [];
    // The iris's coloured ring: outside the pupil (the inner 40% of its width) and inside its rim.
    return ring(picture, landmarks[iris.centre]!, diameter * 0.2, diameter * 0.45, gains);
  });
  const eyes = robustLab(irisPixels, 6);
  // Hair: a band above the top of the outline, a tenth of the face's width higher.
  const top = FACE_OUTLINE.slice(0, 4).concat(FACE_OUTLINE.slice(-4)).map((k) => landmarks[k]!);
  const hairPixels = top.flatMap(([x, y]) => ring(picture, [x, y - faceWidth * 0.1], 0, patch, gains));
  const hair = robustLab(hairPixels);

  // 3–4. The measures and the season.
  const ita = itaOf(skin);
  const hue = hueOf(skin);
  const contrast = hair === null ? null : Math.abs(skin.L - hair.L);
  const { season, warm, light } = seasonOf(ita, hue, contrast);
  return { season, warm, light, skin, eyes, hair, ita, hue, contrast, whiteBalanced, palette: SEASON_PALETTES[season].palette, avoid: SEASON_PALETTES[season].avoid };
}

/** For a swatch on screen: a Lab colour back in sRGB, 0–255. */
export function labToSrgb({ L, a, b }: Lab): [number, number, number] {
  const fy = (L + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const inverse = (t: number) => (t ** 3 > 0.008856 ? t ** 3 : (t - 16 / 116) / 7.787);
  const x = inverse(fx) * 0.95047;
  const y = inverse(fy);
  const z = inverse(fz) * 1.08883;
  const r = 3.2406 * x - 1.5372 * y - 0.4986 * z;
  const g = -0.9689 * x + 1.8758 * y + 0.0415 * z;
  const bl = 0.0557 * x - 0.204 * y + 1.057 * z;
  return [toSrgb(r), toSrgb(g), toSrgb(bl)];
}
