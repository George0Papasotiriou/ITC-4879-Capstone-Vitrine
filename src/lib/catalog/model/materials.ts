/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The physical materials a made model is dressed in: how velvet, oak, brass, marble and glass take the light.
 */

import type { TextureKind } from "@/lib/catalog/model/textures";
import type { Rgb } from "@/lib/vision/palette";

/**
 * docs/adr/058. glTF's materials are physically based: a base colour, how
 * rough the surface is, whether it is metal — and, through Khronos's
 * extensions, the things furniture needs beyond that:
 *
 *   KHR_materials_sheen          the soft rim light of velvet and wool;
 *   KHR_materials_clearcoat      the lacquer over wood, the finish on leather,
 *                                the polish on marble and glaze;
 *   KHR_materials_transmission   glass you see through (with ior and volume);
 *   KHR_materials_emissive_strength  a lamp shade lit from inside.
 *
 * Viewers that do not know an extension (Quick Look, after model-viewer's
 * conversion) still draw the base material, so nothing disappears: glass also
 * carries an alpha, so it stays see-through there.
 */

export type MaterialSpec = {
  /** Parts with the same key share one material and are merged into one mesh. */
  key: string;
  /** The colour as photographed, sRGB 0–255. */
  colour: Rgb;
  texture: TextureKind | null;
  roughness: number;
  metallic: number;
  normalScale?: number;
  sheen?: { colour: Rgb; roughness: number };
  clearcoat?: { factor: number; roughness: number };
  transmission?: { factor: number; ior: number; thickness: number };
  emissive?: { colour: Rgb; strength: number };
  /** Below 1, blended: see-through where transmission is not drawn. */
  opacity?: number;
  doubleSided?: boolean;
  /** A photograph of the piece itself (a rug), in place of a drawn texture's albedo. */
  photo?: string;
};

const keyOf = (name: string, { r, g, b }: Rgb) => `${name}:${r},${g},${b}`;

/** A colour mixed towards another by `t` (0 = itself). */
export function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return { r: Math.round(a.r + (b.r - a.r) * t), g: Math.round(a.g + (b.g - a.g) * t), b: Math.round(a.b + (b.b - a.b) * t) };
}

const WHITE: Rgb = { r: 255, g: 255, b: 255 };
const BLACK: Rgb = { r: 0, g: 0, b: 0 };

export type Fabric = "weave" | "linen" | "velvet" | "boucle";

/** Upholstery: a woven or piled cloth, with the sheen cloth has at grazing angles. */
export function upholstery(colour: Rgb, fabric: Fabric = "weave"): MaterialSpec {
  const sheen =
    fabric === "velvet"
      ? { colour: mix(colour, WHITE, 0.45), roughness: 0.32 }
      : fabric === "boucle"
        ? { colour: mix(colour, WHITE, 0.25), roughness: 0.55 }
        : { colour: mix(colour, WHITE, 0.15), roughness: 0.6 };
  return { key: keyOf(`fabric-${fabric}`, colour), colour, texture: fabric, roughness: 1, metallic: 0, normalScale: fabric === "velvet" ? 0.5 : 1, sheen };
}

export function leather(colour: Rgb): MaterialSpec {
  return { key: keyOf("leather", colour), colour, texture: "leather", roughness: 1, metallic: 0, clearcoat: { factor: 0.1, roughness: 0.5 } };
}

export type WoodFinish = "matte" | "satin" | "lacquer";

export function wood(colour: Rgb, finish: WoodFinish = "satin"): MaterialSpec {
  return {
    key: keyOf(`wood-${finish}`, colour),
    colour,
    texture: "wood",
    roughness: finish === "matte" ? 1.25 : 1,
    metallic: 0,
    clearcoat: finish === "lacquer" ? { factor: 0.7, roughness: 0.12 } : finish === "satin" ? { factor: 0.06, roughness: 0.45 } : undefined,
  };
}

export type MetalFinish = "polished" | "brushed" | "matte" | "powder";

export function metal(colour: Rgb, finish: MetalFinish = "brushed"): MaterialSpec {
  if (finish === "powder") {
    // Powder-coated steel is paint, not bare metal.
    return { key: keyOf("powder", colour), colour, texture: null, roughness: 0.48, metallic: 0, clearcoat: { factor: 0.12, roughness: 0.4 } };
  }
  return {
    key: keyOf(`metal-${finish}`, colour),
    colour,
    texture: finish === "polished" ? null : "brushed",
    roughness: finish === "polished" ? 0.12 : finish === "matte" ? 1.15 : 1,
    metallic: 1,
  };
}

export function glass(tint: Rgb = { r: 236, g: 242, b: 240 }): MaterialSpec {
  return {
    key: keyOf("glass", tint),
    colour: tint,
    texture: null,
    roughness: 0.04,
    metallic: 0,
    transmission: { factor: 1, ior: 1.5, thickness: 0.008 },
    opacity: 0.3,
    doubleSided: false,
  };
}

export function marble(colour: Rgb): MaterialSpec {
  return { key: keyOf("marble", colour), colour, texture: "marble", roughness: 1, metallic: 0, clearcoat: { factor: 0.55, roughness: 0.08 } };
}

export function ceramic(colour: Rgb, glazed = true): MaterialSpec {
  return {
    key: keyOf(glazed ? "ceramic" : "stoneware", colour),
    colour,
    texture: "ceramic",
    roughness: glazed ? 1 : 3,
    metallic: 0,
    clearcoat: glazed ? { factor: 0.6, roughness: 0.1 } : undefined,
  };
}

export function rattan(colour: Rgb): MaterialSpec {
  return { key: keyOf("rattan", colour), colour, texture: "rattan", roughness: 1, metallic: 0 };
}

export function jute(colour: Rgb): MaterialSpec {
  return { key: keyOf("jute", colour), colour, texture: "jute", roughness: 1, metallic: 0, sheen: { colour: mix(colour, WHITE, 0.2), roughness: 0.7 } };
}

export function pile(colour: Rgb): MaterialSpec {
  return { key: keyOf("pile", colour), colour, texture: "pile", roughness: 1, metallic: 0, sheen: { colour: mix(colour, WHITE, 0.3), roughness: 0.5 } };
}

/** Moulded plastic: smooth, slightly glossy, no grain. */
export function plastic(colour: Rgb): MaterialSpec {
  return { key: keyOf("plastic", colour), colour, texture: null, roughness: 0.42, metallic: 0, clearcoat: { factor: 0.1, roughness: 0.3 } };
}

/** Painted or lacquered board: a smooth finish over an even colour. */
export function paint(colour: Rgb, gloss = false): MaterialSpec {
  return { key: keyOf(gloss ? "gloss" : "paint", colour), colour, texture: null, roughness: gloss ? 0.2 : 0.55, metallic: 0, clearcoat: gloss ? { factor: 0.8, roughness: 0.08 } : undefined };
}

/** A lamp shade's cloth, lit from inside: a little of a warm bulb's light comes through. */
export function shade(colour: Rgb, lit: boolean): MaterialSpec {
  return {
    key: keyOf(lit ? "shade-lit" : "shade", colour),
    colour,
    texture: "linen",
    roughness: 1,
    metallic: 0,
    sheen: { colour: mix(colour, WHITE, 0.2), roughness: 0.6 },
    emissive: lit ? { colour: mix({ r: 255, g: 214, b: 160 }, colour, 0.35), strength: 0.3 } : undefined,
    doubleSided: true,
  };
}

/** A glowing bulb. */
export function bulb(): MaterialSpec {
  return { key: "bulb", colour: { r: 255, g: 240, b: 214 }, texture: null, roughness: 0.3, metallic: 0, emissive: { colour: { r: 255, g: 222, b: 176 }, strength: 3 } };
}

/** Rubber feet, castors, glides: a dark, soft-looking plastic. */
export function rubber(colour: Rgb = { r: 34, g: 34, b: 36 }): MaterialSpec {
  return { key: keyOf("rubber", colour), colour, texture: null, roughness: 0.7, metallic: 0 };
}

/** The bedding a bed is dressed in to read as a bed: plain white linen, the same for every bed. */
export function bedding(colour: Rgb = { r: 238, g: 235, b: 228 }): MaterialSpec {
  return { ...upholstery(colour, "linen"), key: keyOf("bedding", colour) };
}

/** A rug wearing its own photograph, with the pile's relief from the drawn texture. */
export function rugPhoto(photoKey: string): MaterialSpec {
  return { key: `rug-photo:${photoKey}`, colour: WHITE, texture: "pile", roughness: 1, metallic: 0, sheen: { colour: { r: 90, g: 90, b: 90 }, roughness: 0.55 }, photo: photoKey };
}

/** A darker or lighter shade of a colour, for the parts of a piece that read as shadow or as highlight. */
export function shadeOf(colour: Rgb, amount: number): Rgb {
  return amount < 1 ? mix(colour, BLACK, 1 - amount) : mix(colour, WHITE, amount - 1);
}
