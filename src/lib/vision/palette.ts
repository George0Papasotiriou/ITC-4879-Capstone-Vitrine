/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Reading a photograph's colours: the palette of what is in it, named in the shop's own vocabulary.
 */

import type { ColorId } from "@/lib/search/vocabulary";

/**
 * Search by photo, without a key (docs/adr/024).
 *
 * With a paid multimodal model, a photograph becomes attributes — "a rust
 * linen armchair" — and an embedding to search with. Neither is available yet,
 * so the shop reads what it can read on its own: **the colours**. The
 * photograph is quantised, the background is set aside, and each remaining
 * cluster is named with the vocabulary the catalogue already uses
 * (src/lib/search/vocabulary.ts), so the result is a real query the hybrid
 * search can answer: "beige and brown, seating".
 *
 * Everything here is arithmetic on pixels: no model, no network, no cost. When
 * a key arrives it adds attributes on top; the colours stay, because a
 * photograph's palette is measured rather than guessed.
 */

export type Rgb = { r: number; g: number; b: number };

export type PaletteEntry = {
  color: ColorId;
  /** 0 to 1: how much of the photograph this colour covers. */
  share: number;
  rgb: Rgb;
};

/** How many clusters the photograph is reduced to before naming. */
export const CLUSTERS = 5;

/** Clusters covering less than this are noise, not a colour in the picture. */
const MIN_SHARE = 0.06;

/**
 * The shop's colour words as points in RGB. These are the middle of each
 * word's range rather than one product's colour: a photograph's rust sofa and
 * the catalogue's "orange" should meet in the middle.
 */
const ANCHORS: Readonly<Record<ColorId, Rgb[]>> = {
  black: [{ r: 24, g: 24, b: 26 }, { r: 58, g: 58, b: 62 }],
  white: [{ r: 245, g: 245, b: 243 }, { r: 226, g: 226, b: 224 }],
  grey: [{ r: 150, g: 152, b: 155 }, { r: 105, g: 108, b: 114 }],
  brown: [{ r: 122, g: 84, b: 58 }, { r: 86, g: 61, b: 44 }, { r: 160, g: 120, b: 86 }],
  beige: [{ r: 226, g: 214, b: 193 }, { r: 205, g: 190, b: 165 }, { r: 190, g: 175, b: 150 }],
  red: [{ r: 168, g: 48, b: 44 }, { r: 120, g: 34, b: 38 }],
  blue: [{ r: 62, g: 96, b: 150 }, { r: 36, g: 54, b: 92 }, { r: 110, g: 140, b: 170 }],
  green: [{ r: 86, g: 122, b: 78 }, { r: 52, g: 80, b: 56 }, { r: 150, g: 165, b: 140 }],
  yellow: [{ r: 214, g: 178, b: 70 }, { r: 182, g: 148, b: 52 }],
  orange: [{ r: 198, g: 112, b: 60 }, { r: 168, g: 86, b: 52 }],
  pink: [{ r: 224, g: 168, b: 172 }, { r: 198, g: 130, b: 140 }],
  purple: [{ r: 120, g: 92, b: 150 }, { r: 88, g: 68, b: 112 }],
};

const distance = (a: Rgb, b: Rgb) => (a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2;

/** The shop's word for one colour: the nearest anchor, in plain RGB distance. */
export function nameColour(rgb: Rgb): ColorId {
  let best: ColorId = "grey";
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const [color, anchors] of Object.entries(ANCHORS) as [ColorId, Rgb[]][]) {
    for (const anchor of anchors) {
      const value = distance(rgb, anchor);
      if (value < bestDistance) {
        bestDistance = value;
        best = color;
      }
    }
  }
  return best;
}

/**
 * k-means over the pixels, from a fixed start so the same photograph always
 * gives the same palette: a search that changed its mind between two runs
 * would be impossible to test or to trust.
 */
export function cluster(pixels: readonly Rgb[], k = CLUSTERS, rounds = 8): { centre: Rgb; share: number }[] {
  if (pixels.length === 0) return [];
  // Start on evenly spaced pixels rather than at random: deterministic, and
  // spread across the photograph rather than bunched in one corner.
  const step = Math.max(1, Math.floor(pixels.length / k));
  let centres: Rgb[] = Array.from({ length: k }, (_, index) => pixels[Math.min(pixels.length - 1, index * step)]!);

  let counts = new Array<number>(k).fill(0);
  for (let round = 0; round < rounds; round += 1) {
    const sums = Array.from({ length: k }, () => ({ r: 0, g: 0, b: 0 }));
    counts = new Array<number>(k).fill(0);
    for (const pixel of pixels) {
      let nearest = 0;
      let nearestDistance = Number.POSITIVE_INFINITY;
      for (let index = 0; index < centres.length; index += 1) {
        const value = distance(pixel, centres[index]!);
        if (value < nearestDistance) {
          nearestDistance = value;
          nearest = index;
        }
      }
      sums[nearest]!.r += pixel.r;
      sums[nearest]!.g += pixel.g;
      sums[nearest]!.b += pixel.b;
      counts[nearest] += 1;
    }
    centres = centres.map((centre, index) =>
      counts[index]! === 0
        ? centre
        : { r: Math.round(sums[index]!.r / counts[index]!), g: Math.round(sums[index]!.g / counts[index]!), b: Math.round(sums[index]!.b / counts[index]!) },
    );
  }

  return centres
    .map((centre, index) => ({ centre, share: counts[index]! / pixels.length }))
    .filter((entry) => entry.share > 0)
    .sort((a, b) => b.share - a.share);
}

/**
 * The palette of a photograph, named. Clusters too small to matter are
 * dropped, and a colour named twice keeps the larger share.
 */
export function palette(pixels: readonly Rgb[], { minShare = MIN_SHARE, k = CLUSTERS }: { minShare?: number; k?: number } = {}): PaletteEntry[] {
  const named = new Map<ColorId, PaletteEntry>();
  for (const entry of cluster(pixels, k)) {
    if (entry.share < minShare) continue;
    const color = nameColour(entry.centre);
    const existing = named.get(color);
    if (existing === undefined) named.set(color, { color, share: entry.share, rgb: entry.centre });
    else existing.share += entry.share;
  }
  return [...named.values()].sort((a, b) => b.share - a.share);
}

/**
 * Pixels from raw RGB(A) bytes, every `stride`-th one: a 1280 px photograph
 * has a million pixels and the palette does not need them all.
 */
export function pixelsFrom(data: Uint8Array | Buffer, channels: number, stride = 4): Rgb[] {
  const pixels: Rgb[] = [];
  for (let index = 0; index + channels - 1 < data.length; index += channels * stride) {
    // A transparent pixel is not a colour in the picture.
    if (channels === 4 && data[index + 3]! < 128) continue;
    pixels.push({ r: data[index]!, g: data[index + 1]!, b: data[index + 2]! });
  }
  return pixels;
}

/**
 * What the shop says it saw: the two or three colours worth searching for,
 * biggest first, with anything under a fifth of the picture left out once
 * there is something better.
 */
export function searchableColours(entries: readonly PaletteEntry[], limit = 3): ColorId[] {
  const strong = entries.filter((entry) => entry.share >= 0.15);
  return (strong.length > 0 ? strong : entries).slice(0, limit).map((entry) => entry.color);
}
