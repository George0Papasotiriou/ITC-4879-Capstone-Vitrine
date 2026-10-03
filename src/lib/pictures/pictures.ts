/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * AI pictures of a piece in a room: the kinds, the showroom styles, the daily allowance, and where the files go.
 */

/**
 * docs/adr/053 (George, 2026-10-03: "one click and a bit of wait"). Three ways
 * to see a piece in a room without measuring anything yourself:
 *
 * - room: the room planner's picture — the piece already placed at true size by
 *   the sheet of paper (docs/adr/052) — made photoreal. The geometry is the
 *   planner's; the model only relights and grounds it. Exact.
 * - quick: the shopper's own room photograph and the piece; the model places
 *   it. Its size is the model's judgement, and the page says so.
 * - scene: no photograph at all — the piece in a showroom of one of four
 *   styles. Nothing personal is in it, so it is made once, kept, and shown at
 *   once and free to everyone who asks for the same piece in the same style.
 *
 * Each picture costs real money (MODELS.image), so a shopper may make a few a
 * day (George's decision: an account 3, a guest 1), always inside the shop's
 * daily AI budget and kill switch. A scene someone else already made costs
 * nothing and uses none.
 */

export const PICTURE_KINDS = ["room", "quick", "scene"] as const;
export type PictureKind = (typeof PICTURE_KINDS)[number];

export type PictureStatus = "queued" | "running" | "done" | "failed";

/** Pictures a shopper may make in a UTC day. A cached scene is not "made", so it does not count. */
export const PICTURE_CAPS = { guest: 1, customer: 3 } as const;

/**
 * The showroom styles, in the shop's own light vocabulary (the window's moods,
 * src/lib/display/moods.ts): each is a room the piece is photographed in, its
 * light named by the hour, never a person or a brand.
 */
export const SCENE_STYLES = {
  "warm-minimal": {
    room: "a calm, warm-minimal living space: limewash walls in warm white, a pale oak floor, linen and travertine accents",
    light: "soft late-afternoon sun from a tall window to one side, long gentle shadows, about 3500 K",
  },
  scandinavian: {
    room: "a bright Scandinavian room: white walls, a light ash floor, a wool throw and one or two green plants",
    light: "soft overcast north light, even and cool, about 6000 K",
  },
  "dark-moody": {
    room: "a dark, moody room: deep charcoal-green walls, a dark oiled oak floor, brass and smoked-glass accents",
    light: "evening, warm pools of lamplight, about 2700 K, with deep but readable shadows",
  },
  mediterranean: {
    room: "a Mediterranean room: sand-toned lime-plaster walls, a terracotta tile floor, an olive branch in a stoneware vase",
    light: "bright morning sun with crisp shadows, about 5000 K",
  },
} as const;
export type SceneStyle = keyof typeof SCENE_STYLES;
export const SCENE_STYLE_IDS = Object.keys(SCENE_STYLES) as SceneStyle[];

export function isSceneStyle(value: unknown): value is SceneStyle {
  return typeof value === "string" && Object.hasOwn(SCENE_STYLES, value);
}

/** The aspect ratios the image model takes (ai.google.dev; @ai-sdk/google 4.0.75's types), as width / height. */
export const ASPECT_RATIOS = ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9"] as const;
export type AspectRatio = (typeof ASPECT_RATIOS)[number];

/** Showroom scenes are landscape, for a row of styles on a product page. */
export const SCENE_ASPECT: AspectRatio = "4:3";

/**
 * The supported ratio nearest a photograph's, compared on a log scale — so 4:3
 * and 3:4 are equally far from 1:1 — and the picture keeps the photograph's
 * framing rather than being cropped to a square.
 */
export function aspectFor(width: number, height: number): AspectRatio {
  const target = Math.log(width / height);
  let best: AspectRatio = "1:1";
  let distance = Infinity;
  for (const ratio of ASPECT_RATIOS) {
    const [w, h] = ratio.split(":").map(Number) as [number, number];
    const gap = Math.abs(Math.log(w / h) - target);
    if (gap < distance) {
      distance = gap;
      best = ratio;
    }
  }
  return best;
}

/** A shopper's picture: kept beside their photographs, and deleted with them. */
export const pictureKey = (id: string) => `photos/pictures/${id}.webp`;

/** A showroom scene: public catalogue media, served at /media/<key>. One file per picture, so it never changes. */
export const sceneKey = (id: string) => `catalog/scenes/${id}.webp`;

/** Where the shopper's browser fetches a scene from. */
export const sceneUrl = (id: string) => `/media/${sceneKey(id)}`;
