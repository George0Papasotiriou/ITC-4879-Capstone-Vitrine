/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * What every builder is handed: the piece's words, its size in metres, and the colours and materials to build in.
 */

import { roundedBox, type Axis } from "@/lib/catalog/model/geometry";
import { glass, leather, marble, metal, paint, upholstery, wood, type MaterialSpec } from "@/lib/catalog/model/materials";
import type { Mesh, Vec3 } from "@/lib/catalog/model/mesh";
import type { Build, LegStyle } from "@/lib/catalog/model/parts";
import { fabricOf, metalTone, seeded, woodTone, type Palette, type PieceFacts, Words } from "@/lib/catalog/model/words";
import type { Rgb } from "@/lib/vision/palette";

export type Size = { w: number; d: number; h: number };

export type Context = {
  facts: PieceFacts;
  words: Words;
  /** Metres. */
  size: Size;
  palette: Palette;
  /** A stable number in [0, 1) for a choice the words leave open. */
  pick: (purpose: string) => number;
  /** The key of the piece's own flattened photograph, when it has one to wear (a rug). */
  photo: string | null;
};

export function context(facts: PieceFacts, palette: Palette, photo: string | null = null): Context {
  return {
    facts,
    words: new Words(facts),
    size: { w: facts.dims.w / 100, d: facts.dims.d / 100, h: facts.dims.h / 100 },
    palette,
    pick: (purpose) => seeded(facts.slug, purpose),
    photo,
  };
}

export const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

/** A rounded box centred at `at`, added to the build. */
export function block(build: Build, material: MaterialSpec, at: Vec3, size: Vec3, radius = 0.004, grain?: Axis, step?: number): Mesh {
  return build.add(roundedBox({ size, radius, segments: radius > 0.01 ? 4 : 2, grain, step }).translate(at), material);
}

// ─── Materials by role ──────────────────────────────────────────────────────

const WALNUT: Rgb = { r: 92, g: 62, b: 42 };
const BLACK_METAL: Rgb = { r: 38, g: 38, b: 40 };

/** The piece's upholstery: its own colour, in leather, velvet, bouclé, linen or a weave as the words say. */
export function upholsteryOf(context: Context, colour: Rgb = context.palette.main): MaterialSpec {
  const fabric = fabricOf(context.words);
  return fabric === "leather" ? leather(colour) : upholstery(colour, fabric);
}

/** Whether the frame or legs are metal rather than wood, by what the listing says. */
export function metalFrame(context: Context): boolean {
  const { words } = context;
  if (words.has("metal legs", "metal frame", "metal base", "iron", "steel", "chrome", "hairpin", "gold legs", "brass legs", "sled base", "industrial")) return true;
  if (words.has("wood legs", "wooden legs", "solid wood", "hardwood", "wood frame")) return false;
  return words.material("metal") && !words.material("wood", "oak", "walnut");
}

/**
 * The material of a frame and legs. Wood takes its tone from the words (walnut,
 * oak…) or, failing that, from the photograph's second colour when it looks
 * like wood; metal takes its finish from the words.
 */
export function frameOf(context: Context, { preferMetal }: { preferMetal?: boolean } = {}): MaterialSpec {
  const useMetal = preferMetal ?? metalFrame(context);
  if (useMetal) {
    const tone = metalTone(context.words);
    return metal(tone?.colour ?? BLACK_METAL, tone?.finish ?? "powder");
  }
  // The photograph's own second colour first (legs measured where legs are): an ebonised or white-painted leg
  // is still wood. Then the species the words name; then a mid walnut.
  const second = context.palette.source === "photo" ? context.palette.second : null;
  const tone = second ?? woodTone(context.words) ?? (context.palette.second !== null && looksLikeWood(context.palette.second) ? context.palette.second : WALNUT);
  return wood(tone, context.words.has("lacquer", "lacquered", "high gloss") ? "lacquer" : "satin");
}

/** Brownish, not too saturated, not too pale: a colour a stained or natural wood could be. */
export function looksLikeWood({ r, g, b }: Rgb): boolean {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return r >= g && g >= b && max - min > 18 && max < 235 && max > 40;
}

/** The body of a case piece or a table top: painted, wood, stone, glass or metal, as the words say. */
export function surfaceOf(context: Context, colour: Rgb = context.palette.main): MaterialSpec {
  const { words } = context;
  if (words.has("glass top", "tempered glass", "glass")) return glass();
  if (words.has("marble", "travertine", "faux marble", "stone top", "terrazzo") || words.material("marble")) return marble(colour);
  if (words.has("high gloss", "lacquer", "lacquered")) return paint(colour, true);
  // A colour no wood has (white, grey, black, blue) is paint — painted wood is still painted — unless the
  // words name a species or stain, which the photograph's light may have bleached.
  const named = woodTone(words);
  if (words.has("painted", "white finish", "mdf") || (!looksLikeWood(colour) && named === null)) {
    return words.material("metal") && !words.material("wood") ? metal(colour, "powder") : paint(colour);
  }
  return wood(looksLikeWood(colour) ? colour : (named ?? colour), words.has("lacquer") ? "lacquer" : "satin");
}

/** The leg style the words ask for, or a sensible one for the piece's style. */
export function legStyleOf(context: Context, fallback: LegStyle): LegStyle {
  const { words } = context;
  if (words.has("hairpin")) return "hairpin";
  if (words.has("cabriole", "queen anne", "french", "louis")) return "cabriole";
  if (words.has("turned", "spindle leg", "english", "traditional", "farmhouse", "victorian")) return "turned";
  if (words.has("bun feet", "bun foot", "chesterfield")) return "bun";
  if (words.has("tapered", "mid century", "midcentury", "retro", "scandinavian", "danish")) return "tapered";
  if (metalFrame(context)) return "metal-round";
  if (words.has("block", "modern", "contemporary")) return fallback === "tapered" ? "block" : fallback;
  return fallback;
}
