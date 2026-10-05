/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Which try-on engine a piece needs, what FASHN charges for each call, and how an outfit is put on in order.
 */

/**
 * docs/adr/063. Everything here is pure: the routes, the jobs and the
 * Concierge's tools all ask it the same questions.
 *
 * FASHN's tables were read from its API reference on 2026-10-05
 * (docs.fashn.ai, the Try-On v1.6, Try-On Max, Product to Model and Image to
 * Video pages). A credit is $0.075 on demand.
 */

/** The clothes' kinds (docs/adr/022, 062): what Try-On v1.6 was made for. */
export const GARMENT_KINDS = ["TOP", "SHIRT", "KNIT", "TROUSERS", "SKIRT", "DRESS", "COAT", "JACKET"] as const;
/** The wearables' kinds (docs/adr/061): only Try-On Max puts these on a person. */
export const WEARABLE_KINDS = ["SHOES", "BOOT", "SANDAL", "HANDBAG", "TOTE_BAG", "WALLET", "BACKPACK", "HAT", "SCARF", "SUNGLASSES", "EARRING", "NECKLACE", "BRACELET", "WATCH"] as const;

export type TryOnEngine = "v1.6" | "max";

/** Whether a kind can be tried on at all. */
export const isWearable = (kind: string): boolean => (GARMENT_KINDS as readonly string[]).includes(kind) || (WEARABLE_KINDS as readonly string[]).includes(kind);

/**
 * The engine for a piece: clothes go to the shop's chosen engine (Try-On v1.6
 * by default, a credit a picture), everything else to Try-On Max, the only one
 * that knows shoes, bags, hats and jewellery.
 */
export function tryOnEngine(kind: string, forClothes: TryOnEngine = "v1.6"): TryOnEngine {
  return (GARMENT_KINDS as readonly string[]).includes(kind) ? forClothes : "max";
}

export type Resolution = "1k" | "2k" | "4k";
export type GenerationMode = "fast" | "balanced" | "quality";

/** Try-On Max and Product to Model, per image: rows are the mode, columns the resolution. */
const MAX_CREDITS: Readonly<Record<GenerationMode, Readonly<Record<Resolution, number>>>> = {
  fast: { "1k": 1, "2k": 2, "4k": 3 },
  balanced: { "1k": 2, "2k": 3, "4k": 4 },
  quality: { "1k": 3, "2k": 4, "4k": 5 },
};
/** Image to Video: rows are the length in seconds, columns the resolution. */
const VIDEO_CREDITS: Readonly<Record<5 | 10, Readonly<Record<VideoResolution, number>>>> = {
  5: { "480p": 1, "720p": 3, "1080p": 6 },
  10: { "480p": 2, "720p": 6, "1080p": 12 },
};
export type VideoResolution = "480p" | "720p" | "1080p";

export type FashnCall =
  | { model: "tryon-v1.6"; images?: number }
  | { model: "tryon-max" | "product-to-model"; mode: GenerationMode; resolution: Resolution; images?: number; faceReference?: boolean }
  | { model: "image-to-video"; seconds: 5 | 10; resolution: VideoResolution };

/** What one call costs in FASHN credits, as FASHN bills it. */
export function fashnCredits(call: FashnCall): number {
  switch (call.model) {
    case "tryon-v1.6":
      return 1 * (call.images ?? 1);
    case "tryon-max":
    case "product-to-model":
      // A face reference adds three credits an image (Product to Model only).
      return (MAX_CREDITS[call.mode][call.resolution] + (call.faceReference === true ? 3 : 0)) * (call.images ?? 1);
    case "image-to-video":
      return VIDEO_CREDITS[call.seconds][call.resolution];
  }
}

/** The settings the shop uses: good enough to judge a piece by, at the lowest price that is. */
export const SHOP_TRY_ON_MAX = { mode: "balanced", resolution: "1k" } as const satisfies { mode: GenerationMode; resolution: Resolution };
export const SHOP_MODEL_SHOT = { mode: "balanced", resolution: "1k" } as const satisfies { mode: GenerationMode; resolution: Resolution };
export const SHOP_VIDEO = { seconds: 5, resolution: "480p" } as const satisfies { seconds: 5 | 10; resolution: VideoResolution };

/** The FASHN call a try-on of this kind makes. */
export function tryOnCall(kind: string, forClothes: TryOnEngine = "v1.6"): FashnCall {
  return tryOnEngine(kind, forClothes) === "v1.6" ? { model: "tryon-v1.6" } : { model: "tryon-max", ...SHOP_TRY_ON_MAX };
}

/* --------------------------------- outfits -------------------------------- */

/** Where on the body a piece goes. A dress is both top and bottom. */
export type Slot = "one-piece" | "bottom" | "top" | "outer" | "feet" | "bag" | "head" | "accessory";

const SLOTS: Readonly<Record<string, Slot>> = {
  DRESS: "one-piece",
  TROUSERS: "bottom",
  SKIRT: "bottom",
  TOP: "top",
  SHIRT: "top",
  KNIT: "top",
  COAT: "outer",
  JACKET: "outer",
  SHOES: "feet",
  BOOT: "feet",
  SANDAL: "feet",
  HANDBAG: "bag",
  TOTE_BAG: "bag",
  BACKPACK: "bag",
  WALLET: "bag",
  HAT: "head",
  SCARF: "accessory",
  SUNGLASSES: "accessory",
  EARRING: "accessory",
  NECKLACE: "accessory",
  BRACELET: "accessory",
  WATCH: "accessory",
};

export const slotOf = (kind: string): Slot | null => SLOTS[kind] ?? null;

/**
 * The order an outfit is put on, as a person dresses: what covers the body
 * first, then what goes over it, then shoes, a bag, a hat and jewellery. Each
 * try-on is made on the picture the one before made, so a jacket goes on over
 * the shirt and not under it.
 */
const DRESSING_ORDER: readonly Slot[] = ["one-piece", "bottom", "top", "outer", "feet", "bag", "head", "accessory"];

/** At most four pieces: each is a paid call, and a fifth layer adds little that four do not show. */
export const MAX_OUTFIT = 4;

export type OutfitPiece = { id: string; kind: string };
export type OutfitPlan = { ok: true; pieces: OutfitPiece[] } | { ok: false; reason: "too_few" | "too_many" | "not_wearable" | "same_slot" | "dress_and_separates" };

/**
 * An outfit, checked and put in dressing order. Two to four pieces, one per
 * place on the body (two tops would be one try-on undoing the other), and a
 * dress never with a top or a bottom, which it already is.
 */
export function planOutfit(pieces: readonly OutfitPiece[]): OutfitPlan {
  if (pieces.length < 2) return { ok: false, reason: "too_few" };
  if (pieces.length > MAX_OUTFIT) return { ok: false, reason: "too_many" };
  const slots = pieces.map((piece) => slotOf(piece.kind));
  if (slots.some((slot) => slot === null)) return { ok: false, reason: "not_wearable" };
  if (new Set(slots).size !== slots.length) return { ok: false, reason: "same_slot" };
  if (slots.includes("one-piece") && (slots.includes("top") || slots.includes("bottom"))) return { ok: false, reason: "dress_and_separates" };
  const ordered = [...pieces].sort((a, b) => DRESSING_ORDER.indexOf(slotOf(a.kind)!) - DRESSING_ORDER.indexOf(slotOf(b.kind)!));
  return { ok: true, pieces: ordered };
}
