/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Reading a piece from its catalogue entry: the words that say what it looks like, and the colours it comes in.
 */

import { rgbToLab } from "@/lib/optimize/color";
import type { ColorId } from "@/lib/search/vocabulary";
import { deltaE2000 } from "@/lib/vision/delta-e";
import { colourSwatch, type Rgb } from "@/lib/vision/palette";

/**
 * docs/adr/058. A listing says more about a piece's shape than its kind:
 * "Tufted Armless English Roll Accent Chair" is a chair with no arms, a rolled
 * back and buttons; "Mid-Century Round Coffee Table with Tapered Legs" names
 * its top and its legs. The title and the attribute values are read as one
 * lower-case text and asked questions of — whole words or phrases, so "arm"
 * does not match "armless" and "bed" does not match "bedside".
 */

export type PieceFacts = {
  slug: string;
  kind: string;
  title: string;
  attributes: Readonly<Record<string, string>>;
  materials: readonly string[];
  colors: readonly string[];
  /** Centimetres, as listed. */
  dims: { w: number; d: number; h: number };
};

export class Words {
  readonly text: string;
  private readonly materialWords: Set<string>;

  constructor(readonly facts: PieceFacts) {
    const parts = [facts.title, ...Object.values(facts.attributes)];
    // Hyphens and slashes become spaces: "mid-century" and "mid century" are the same words.
    this.text = ` ${parts.join(" ").toLowerCase().replace(/[^a-z0-9"]+/g, " ").trim()} `;
    this.materialWords = new Set(facts.materials.map((material) => material.toLowerCase()));
  }

  /** Whether any of the phrases appears as whole words. */
  has(...phrases: string[]): boolean {
    return phrases.some((phrase) => this.text.includes(` ${phrase.toLowerCase()} `));
  }

  /** A material from the catalogue's own list, or named in the words. */
  material(...names: string[]): boolean {
    return names.some((name) => this.materialWords.has(name) || this.has(name));
  }

  /** The first number before a word: "3-drawer" → 3, "6 drawer" → 6. */
  countBefore(word: string): number | null {
    const match = new RegExp(` (\\d{1,2}) ${word}s? `).exec(this.text);
    return match === null ? null : Number(match[1]);
  }

  /** The attribute value, lower case, or "". */
  attribute(name: string): string {
    return (this.facts.attributes[name] ?? "").toLowerCase();
  }
}

/** A stable number in [0, 1) from the slug and a purpose: the same piece always makes the same choices. */
export function seeded(slug: string, purpose: string): number {
  let h = 2166136261;
  for (const char of `${slug}#${purpose}`) {
    h ^= char.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  h = Math.imul(h ^ (h >>> 15), 2246822507);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

// ─── Colours ────────────────────────────────────────────────────────────────

export const difference = (a: Rgb, b: Rgb) => deltaE2000(rgbToLab([a.r, a.g, a.b]), rgbToLab([b.r, b.g, b.b]));

/** The colour of a listed colour word, or null. */
export function wordColour(word: string | undefined): Rgb | null {
  if (word === undefined) return null;
  const swatch = colourSwatch(word as ColorId);
  return swatch.r === 150 && swatch.g === 150 && swatch.b === 150 && word !== "grey" ? null : swatch;
}

/** Wood by its species or stain, as the words name it; null when they name none. */
export function woodTone(words: Words): Rgb | null {
  if (words.has("espresso", "dark walnut", "black walnut", "ebony", "dark brown")) return { r: 62, g: 44, b: 34 };
  if (words.has("walnut")) return { r: 104, g: 70, b: 46 };
  if (words.has("mahogany", "cherry")) return { r: 112, g: 54, b: 38 };
  if (words.has("teak", "acacia")) return { r: 150, g: 102, b: 62 };
  if (words.has("white oak", "ash", "birch", "maple", "beech", "light wood", "natural wood", "blonde")) return { r: 205, g: 172, b: 128 };
  if (words.has("oak", "pine", "natural", "honey")) return { r: 184, g: 140, b: 92 };
  if (words.has("grey wash", "gray wash", "driftwood", "weathered")) return { r: 150, g: 140, b: 128 };
  if (words.has("rustic", "farmhouse", "reclaimed")) return { r: 132, g: 96, b: 66 };
  return null;
}

export type MetalTone = { colour: Rgb; finish: "polished" | "brushed" | "matte" | "powder" };

/** Metal by its finish: brass and gold polished, chrome bright, black powder-coated, bronze dark. */
export function metalTone(words: Words): MetalTone | null {
  const finish = words.attribute("finish");
  const said = (...names: string[]) => names.some((name) => finish.includes(name)) || words.has(...names);
  if (said("antique brass", "antique gold", "aged brass")) return { colour: { r: 176, g: 140, b: 82 }, finish: "brushed" };
  if (said("brass", "gold")) return { colour: { r: 222, g: 182, b: 104 }, finish: "polished" };
  if (said("copper", "rose gold")) return { colour: { r: 200, g: 128, b: 98 }, finish: "polished" };
  if (said("oil rubbed", "bronze")) return { colour: { r: 70, g: 54, b: 42 }, finish: "brushed" };
  if (said("chrome", "polished nickel", "stainless", "silver", "mirrored")) return { colour: { r: 228, g: 230, b: 232 }, finish: "polished" };
  if (said("nickel", "brushed steel", "pewter", "satin nickel")) return { colour: { r: 196, g: 194, b: 188 }, finish: "brushed" };
  if (said("black", "iron", "matte black", "wrought")) return { colour: { r: 38, g: 38, b: 40 }, finish: "powder" };
  if (said("white metal")) return { colour: { r: 236, g: 236, b: 232 }, finish: "powder" };
  return null;
}

export type FabricKind = "weave" | "linen" | "velvet" | "boucle" | "leather";

/** What the upholstery is: leather, velvet, bouclé, linen, or a plain weave. */
export function fabricOf(words: Words): FabricKind {
  if (words.has("leather", "faux leather", "leatherette", "pu", "bonded leather", "vegan leather", "top grain", "saddle")) return "leather";
  if (words.has("velvet", "velour", "chenille", "glam", "plush")) return "velvet";
  if (words.has("boucle", "sherpa", "teddy", "faux fur", "shearling")) return "boucle";
  if (words.has("linen", "burlap", "slub", "twill")) return "linen";
  return "weave";
}

/**
 * The colours to build in. With a photograph (look.ts) its bands decide; with
 * only words, the first colour word is the body and a second, if listed, the
 * frame.
 */
export type Palette = {
  /** Upholstery, a cabinet's body, a lamp's base, a rug's field. */
  main: Rgb;
  /** A second colour where the piece has one: a frame, legs, a top. Null when the piece is one colour. */
  second: Rgb | null;
  /** Where each colour came from, for the file's notes and the evaluation. */
  source: "photo" | "words" | "default";
};

export function paletteFromWords(colors: readonly string[]): Palette {
  const main = wordColour(colors[0]);
  const second = wordColour(colors[1]);
  if (main === null) return { main: { r: 176, g: 170, b: 160 }, second: null, source: "default" };
  return { main, second: second !== null && difference(main, second) > 12 ? second : null, source: "words" };
}
