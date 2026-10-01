/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The light in the shop window: each theme is a time of day, and colour temperatures become colours.
 */

import type { TemplateId } from "@/lib/optimize/templates";

/**
 * docs/adr/048. A window display is lit like a room at a certain hour. A mood
 * says where the sun is (its height above the horizon and its bearing through
 * the window on the left), how warm its light is, how much the sky fills the
 * room, whether lamps are lit, and how strongly the beam through the window
 * shows. The scene eases from one mood to the next when the theme changes.
 *
 * COLOUR TEMPERATURE. A light's colour is given, as photographers and lighting
 * designers give it, in kelvin: the temperature of an ideal black body that
 * glows that colour. Its chromaticity lies on the Planckian locus; Kim et al.'s
 * cubic-spline fit gives the CIE 1931 (x, y) of that locus for 1667–25000 K to
 * within the precision anyone can see:
 *
 *   x = a/T³ + b/T² + c/T + d                        (two ranges, split at 4000 K)
 *   y = e·x³ + f·x² + g·x + h                        (three ranges)
 *
 * With luminance Y = 1, X = x/y and Z = (1 − x − y)/y, and the standard XYZ →
 * linear sRGB matrix (IEC 61966-2-1, D65 white) gives the light's colour in the
 * renderer's working space. It is normalised so its largest channel is 1: the
 * mood's intensity, not the colour, says how bright the light is.
 *
 * Reference: Kim, Kim, Kim & Moon (2002), "Design of advanced color temperature
 * control system for HDTV applications", J. Korean Physical Society 41(6).
 */

export type Rgb = { r: number; g: number; b: number };

export type Mood = {
  id: MoodId;
  sun: {
    /** Height above the horizon, degrees: low sun makes long shadows. */
    elevationDeg: number;
    /** Bearing through the window: 0 straight across the room from the left, positive towards the street. */
    bearingDeg: number;
    kelvin: number;
    /** Relative to a clear midday sun of 1. */
    intensity: number;
    /** How soft the shadows are, 0 hard to 1 very soft (an overcast day). */
    softness: number;
  };
  /** The light the sky and the room bounce back. */
  ambient: { kelvin: number; intensity: number };
  /** Lamps in the set, lit: warm light from the lamps' own positions. */
  lamps: { kelvin: number; intensity: number } | null;
  /** The visible shaft of light through the window, and the dust in it: 0 none, 1 strong. */
  beam: number;
  /** Exposure of the camera, as a photographer would set it for this light. */
  exposure: number;
  /** The walls' lightness against the shop's plinth colour: below 1 darker (evening), above lighter. */
  wall: number;
};

export type MoodId = "afternoon" | "overcast" | "dawn" | "dusk" | "golden-hour" | "noon";

export const MOODS: Record<MoodId, Mood> = {
  afternoon: {
    id: "afternoon",
    sun: { elevationDeg: 24, bearingDeg: 18, kelvin: 4300, intensity: 3.1, softness: 0.25 },
    ambient: { kelvin: 6800, intensity: 0.55 },
    lamps: null,
    beam: 0.75,
    exposure: 1,
    wall: 1,
  },
  overcast: {
    id: "overcast",
    sun: { elevationDeg: 48, bearingDeg: 8, kelvin: 6500, intensity: 1.2, softness: 0.9 },
    ambient: { kelvin: 7200, intensity: 0.95 },
    lamps: { kelvin: 2900, intensity: 0.35 },
    beam: 0.15,
    exposure: 1.08,
    wall: 1.02,
  },
  dawn: {
    id: "dawn",
    sun: { elevationDeg: 9, bearingDeg: 28, kelvin: 3500, intensity: 2.2, softness: 0.45 },
    ambient: { kelvin: 8000, intensity: 0.5 },
    lamps: { kelvin: 2700, intensity: 0.25 },
    beam: 0.6,
    exposure: 1.12,
    wall: 0.98,
  },
  dusk: {
    id: "dusk",
    sun: { elevationDeg: 4, bearingDeg: 34, kelvin: 2400, intensity: 1.1, softness: 0.55 },
    ambient: { kelvin: 9000, intensity: 0.28 },
    lamps: { kelvin: 2700, intensity: 1.4 },
    beam: 0.35,
    exposure: 1.25,
    wall: 0.72,
  },
  "golden-hour": {
    id: "golden-hour",
    sun: { elevationDeg: 13, bearingDeg: 22, kelvin: 3300, intensity: 2.8, softness: 0.3 },
    ambient: { kelvin: 7000, intensity: 0.42 },
    lamps: { kelvin: 2700, intensity: 0.6 },
    beam: 0.9,
    exposure: 1.02,
    wall: 0.94,
  },
  noon: {
    id: "noon",
    sun: { elevationDeg: 58, bearingDeg: 4, kelvin: 5600, intensity: 2.6, softness: 0.35 },
    ambient: { kelvin: 6500, intensity: 0.8 },
    lamps: null,
    beam: 0.3,
    exposure: 0.98,
    wall: 1.04,
  },
};

/** The mood a window made on the spot gets from its room. */
export const TEMPLATE_MOODS: Record<TemplateId, MoodId> = {
  "reading-corner": "afternoon",
  "living-room": "overcast",
  dining: "dusk",
  bedroom: "dawn",
  "gift-set": "noon",
};

/** CIE 1931 chromaticity (x, y) of a black body at `kelvin`, by Kim et al.'s fit (valid 1667–25000 K; clamped there). */
export function planckianXy(kelvin: number): { x: number; y: number } {
  const t = Math.min(25_000, Math.max(1_667, kelvin));
  const x =
    t <= 4_000
      ? -0.2661239e9 / t ** 3 - 0.2343589e6 / t ** 2 + 0.8776956e3 / t + 0.17991
      : -3.0258469e9 / t ** 3 + 2.1070379e6 / t ** 2 + 0.2226347e3 / t + 0.24039;
  const y =
    t <= 2_222
      ? -1.1063814 * x ** 3 - 1.3481102 * x ** 2 + 2.18555832 * x - 0.20219683
      : t <= 4_000
        ? -0.9549476 * x ** 3 - 1.37418593 * x ** 2 + 2.09137015 * x - 0.16748867
        : 3.081758 * x ** 3 - 5.8733867 * x ** 2 + 3.75112997 * x - 0.37001483;
  return { x, y };
}

/** A colour temperature as a linear-sRGB colour with its largest channel 1. */
export function kelvinToLinearRgb(kelvin: number): Rgb {
  const { x, y } = planckianXy(kelvin);
  const X = x / y;
  const Y = 1;
  const Z = (1 - x - y) / y;
  const r = 3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z;
  const g = -0.969266 * X + 1.8760108 * Y + 0.041556 * Z;
  const b = 0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z;
  // Very warm light falls a little outside sRGB's blue; that channel is then simply 0.
  const clamped = { r: Math.max(0, r), g: Math.max(0, g), b: Math.max(0, b) };
  const peak = Math.max(clamped.r, clamped.g, clamped.b);
  return { r: clamped.r / peak, g: clamped.g / peak, b: clamped.b / peak };
}

/** Where the sun shines from, as a unit vector into the room (the window is on the left, x < 0; +z is the street). */
export function sunDirection(mood: Pick<Mood, "sun">): { x: number; y: number; z: number } {
  const elevation = (mood.sun.elevationDeg * Math.PI) / 180;
  const bearing = (mood.sun.bearingDeg * Math.PI) / 180;
  // From the light towards the room: rightwards (+x), downwards, and along the bearing.
  return { x: Math.cos(elevation) * Math.cos(bearing), y: -Math.sin(elevation), z: -Math.cos(elevation) * Math.sin(bearing) };
}

/** Halfway between two moods, for the ease from one theme to the next: numbers blend, lamps fade in or out. */
export function blendMoods(from: Mood, to: Mood, t: number): Mood {
  const k = Math.min(1, Math.max(0, t));
  const mix = (a: number, b: number) => a + (b - a) * k;
  const lampsFrom = from.lamps ?? { kelvin: to.lamps?.kelvin ?? 2700, intensity: 0 };
  const lampsTo = to.lamps ?? { kelvin: from.lamps?.kelvin ?? 2700, intensity: 0 };
  const lampIntensity = mix(lampsFrom.intensity, lampsTo.intensity);
  return {
    id: k < 0.5 ? from.id : to.id,
    sun: {
      elevationDeg: mix(from.sun.elevationDeg, to.sun.elevationDeg),
      bearingDeg: mix(from.sun.bearingDeg, to.sun.bearingDeg),
      // Temperatures blend in mireds (1/K), which is how a warm-to-cool shift looks even.
      kelvin: 1 / mix(1 / from.sun.kelvin, 1 / to.sun.kelvin),
      intensity: mix(from.sun.intensity, to.sun.intensity),
      softness: mix(from.sun.softness, to.sun.softness),
    },
    ambient: { kelvin: 1 / mix(1 / from.ambient.kelvin, 1 / to.ambient.kelvin), intensity: mix(from.ambient.intensity, to.ambient.intensity) },
    lamps: lampIntensity <= 0 ? null : { kelvin: 1 / mix(1 / lampsFrom.kelvin, 1 / lampsTo.kelvin), intensity: lampIntensity },
    beam: mix(from.beam, to.beam),
    exposure: mix(from.exposure, to.exposure),
    wall: mix(from.wall, to.wall),
  };
}
