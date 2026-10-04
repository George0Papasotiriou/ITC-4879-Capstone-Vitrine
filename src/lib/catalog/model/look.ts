/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * A piece's colours read from its own studio photograph: the top, the middle and the bottom of it, measured apart.
 */

import { familyOf } from "@/lib/catalog/model/family";
import { difference, type Palette } from "@/lib/catalog/model/words";
import { cutoutFromWhite } from "@/lib/vision/cutout";
import { cluster, type Rgb } from "@/lib/vision/palette";

/**
 * docs/adr/058. A colour word is a poor description of a colour: "blue" is
 * navy on one listing and aqua on the next. Every piece has a photograph on a
 * white studio ground, so its colours are measured there instead.
 *
 * Where a colour sits matters as much as what it is: a chair is its fabric in
 * the middle of the picture and its legs at the bottom; a lamp its shade at
 * the top and its base below; a table its top above and its legs below. So
 * the piece is cut out of the white (vision/cutout.ts, the room planner's own
 * cut-out), and its height split into three bands — top 30%, middle 40%,
 * bottom 30% — each reduced to a few colours by the shop's k-means
 * (vision/palette.ts).
 *
 * A studio photo is shaded: the average of a blue velvet's pixels includes
 * its shadowed folds and is darker than the velvet; and it has highlights,
 * where a lacquered top reflects the studio's lamps and reads near white. The
 * model is lit by the viewer's own light, so the colour wanted is the
 * material's, neither its shadow's nor its shine's: each colour is the mean of
 * its cluster's pixels between the 35th and 85th percentile of brightness.
 */

export type Swatch = { colour: Rgb; share: number };
export type Look = { top: Swatch[]; middle: Swatch[]; bottom: Swatch[]; whole: Swatch[] };

const luminance = ({ r, g, b }: Rgb) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** The clusters of some pixels, each as the mean of its brighter half. */
export function swatches(pixels: readonly Rgb[], k: number): Swatch[] {
  if (pixels.length < 20) return [];
  const clusters = cluster(pixels, k, 8);
  const members: Rgb[][] = clusters.map(() => []);
  for (const pixel of pixels) {
    let best = 0;
    let bestDistance = Infinity;
    for (let i = 0; i < clusters.length; i += 1) {
      const c = clusters[i]!.centre;
      const dist = (pixel.r - c.r) ** 2 + (pixel.g - c.g) ** 2 + (pixel.b - c.b) ** 2;
      if (dist < bestDistance) {
        bestDistance = dist;
        best = i;
      }
    }
    members[best]!.push(pixel);
  }
  return clusters
    .map((entry, i) => {
      const group = members[i]!;
      if (group.length === 0) return { colour: entry.centre, share: entry.share };
      const sorted = [...group].sort((a, b) => luminance(a) - luminance(b));
      const bright = sorted.slice(Math.floor(sorted.length * 0.35), Math.max(Math.floor(sorted.length * 0.35) + 1, Math.ceil(sorted.length * 0.85)));
      const mean = bright.reduce((sum, p) => ({ r: sum.r + p.r, g: sum.g + p.g, b: sum.b + p.b }), { r: 0, g: 0, b: 0 });
      return { colour: { r: Math.round(mean.r / bright.length), g: Math.round(mean.g / bright.length), b: Math.round(mean.b / bright.length) }, share: group.length / pixels.length };
    })
    .filter((swatch) => swatch.share > 0.03)
    .sort((a, b) => b.share - a.share);
}

/**
 * The look of a studio photograph (RGBA), or null when it is not a piece on a
 * white ground (a room shot cannot be read this way).
 */
export function lookOfPhoto(rgba: ArrayLike<number>, width: number, height: number): Look | null {
  const cut = cutoutFromWhite(rgba, width, height, { standing: true });
  if (!cut.removed || cut.box.width < 16 || cut.box.height < 16) return null;
  const bands: Rgb[][] = [[], [], []];
  const all: Rgb[] = [];
  // At most about 20,000 pixels per band: plenty for a few colours, quick to cluster.
  const stride = Math.max(1, Math.round(Math.sqrt((cut.box.width * cut.box.height) / 60_000)));
  for (let y = cut.box.y; y < cut.box.y + cut.box.height; y += stride) {
    const t = (y - cut.box.y) / cut.box.height;
    const band = t < 0.3 ? 0 : t < 0.7 ? 1 : 2;
    for (let x = cut.box.x; x < cut.box.x + cut.box.width; x += stride) {
      const i = (y * width + x) * 4;
      // Only the piece itself: not the background, not the soft studio shadow kept as half-transparent black.
      if (cut.rgba[i + 3]! < 250) continue;
      const pixel = { r: cut.rgba[i]!, g: cut.rgba[i + 1]!, b: cut.rgba[i + 2]! };
      bands[band]!.push(pixel);
      all.push(pixel);
    }
  }
  return { top: swatches(bands[0]!, 4), middle: swatches(bands[1]!, 4), bottom: swatches(bands[2]!, 4), whole: swatches(all, 5) };
}

/** The first swatch at least `minShare` of its band that differs from `from` by more than `minDelta` (CIEDE2000). */
export function distinct(band: readonly Swatch[], from: Rgb, { minDelta = 15, minShare = 0.12 } = {}): Rgb | null {
  return band.find((swatch) => swatch.share >= minShare && difference(swatch.colour, from) > minDelta)?.colour ?? null;
}

/**
 * Which band holds which part, by family: the body and a second colour (legs,
 * frame, base, a lamp's base under its shade).
 */
export function paletteFromLook(look: Look, kind: string): Palette | null {
  const first = (band: readonly Swatch[]) => band[0]?.colour ?? null;
  const family = familyOf(kind);
  const top = first(look.top);
  const middle = first(look.middle);
  if (family === "lighting") {
    // The shade is the top; the base is what differs from it lower down.
    const shade = top ?? middle;
    if (shade === null) return null;
    return { main: shade, second: distinct(look.bottom, shade, { minShare: 0.2 }) ?? distinct(look.middle, shade, { minShare: 0.25 }), source: "photo" };
  }
  if (family === "tables" || family === "beds") {
    // A table is its top; a bed its headboard (the top of the picture) — the frame or legs below.
    const surface = top ?? middle;
    if (surface === null) return null;
    return { main: surface, second: distinct(look.bottom, surface), source: "photo" };
  }
  if (family === "rugs" || family === "planters" || family === "baskets" || family === "storage") {
    const body = first(look.whole) ?? middle;
    if (body === null) return null;
    return { main: body, second: distinct(look.whole, body, { minShare: 0.12 }), source: "photo" };
  }
  // Seating: the upholstery fills the middle; legs and frame are what differs at the bottom.
  const body = middle ?? first(look.whole);
  if (body === null) return null;
  return { main: body, second: distinct(look.bottom, body), source: "photo" };
}

/** A studio photograph's bytes decoded to RGBA at most `edge` pixels on its long side (server only: sharp). */
export async function decodePhoto(bytes: Uint8Array, edge = 640): Promise<{ data: Uint8ClampedArray; width: number; height: number }> {
  const { default: sharp } = await import("sharp");
  const { data, info } = await sharp(Buffer.from(bytes)).rotate().resize(edge, edge, { fit: "inside", withoutEnlargement: true }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength), width: info.width, height: info.height };
}
