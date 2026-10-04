/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Every AI model the shop uses, its identifier and its price: the only place model IDs are written.
 */

/**
 * Models and prices (docs/PLAN.md 3.1–3.2, docs/adr/019). Identifiers were
 * checked against the model list of the installed provider package
 * (@ai-sdk/google 4.0.75); prices are the plan's, checked on the date below and
 * to be checked again before any spend. A price not yet confirmed is null:
 * such a model can run, but its cost is recorded as unknown rather than guessed,
 * and the budget treats it as zero, so it must be confirmed before real use.
 *
 * Costs are kept in millionths of a euro. Prices are published in US dollars
 * and converted at one dollar to one euro, which overstates the spend a little:
 * a budget guard should err on the high side.
 */

export const PRICES_CHECKED = "2026-10-04";
export const USD_TO_EUR = 1;

export type Pricing =
  | { kind: "tokens"; inputUsdPerMillion: number; outputUsdPerMillion: number }
  | {
      kind: "per_unit";
      unit: "image" | "second" | "minute" | "call" | "model";
      usdPerUnit: number;
      /** Tokens billed beside the unit: an image model's input (the photographs it is shown) and its thinking. */
      inputUsdPerMillion?: number;
      outputUsdPerMillion?: number;
    }
  | { kind: "unverified" };

export type ModelEntry = {
  /**
   * "drawn" is the keyless stand-in that composes rather than generates
   * (docs/adr/023); "browser" is work the browser itself does — the speech of
   * docs/adr/026 — which costs nothing and still deserves a line in the usage
   * table, so /admin/ai shows the feature being used. "fixture" is the test
   * double for AI pictures (docs/adr/060), refused in production.
   */
  provider: "google" | "openai" | "fashn" | "fal" | "demo" | "drawn" | "browser" | "fixture";
  id: string;
  pricing: Pricing;
};

/** What the shop uses AI for; every recorded cost names one. */
export const AI_FEATURES = ["concierge", "support_chat", "support_draft", "voice", "embedding", "snap", "try_on", "animate", "capsule_image", "translation", "copy_draft", "room_picture", "shop_the_look", "model_3d"] as const;
export type AiFeature = (typeof AI_FEATURES)[number];

/**
 * Gemini 3.8 Flash, Google's current Flash model (ai.google.dev, checked
 * 2026-09-26; 3.7 Flash is no longer listed). The price is the one in force
 * until 31 December 2026; from 1 January 2027 Google lists $1.50 in and $7.50
 * out, and this line must change with it or the budget guard undercounts.
 */
const GEMINI_FLASH: ModelEntry = { provider: "google", id: "gemini-3.8-flash", pricing: { kind: "tokens", inputUsdPerMillion: 0.75, outputUsdPerMillion: 3.75 } };

export const MODELS = {
  /** The Concierge's text model: the plan's leading candidate until the Phase 6 bake-off (ADR-007) decides. */
  concierge: GEMINI_FLASH,
  /** The support assistant and the drafts offered to agents. */
  support: GEMINI_FLASH,
  /** Catalogue copy, batch. */
  translation: GEMINI_FLASH,
  /** Text and image embeddings in one space (Snap to shop, semantic search). */
  embedding: { provider: "google", id: "gemini-embedding-2", pricing: { kind: "unverified" } },
  /** Attributes read from a shopper's photo for Snap to shop. */
  snap: GEMINI_FLASH,
  /**
   * AI pictures of a piece in a room (docs/adr/053, docs/adr/060), at 2K. Nano
   * Banana 2 (Gemini 3.1 Flash Image), the cheaper choice (PICTURES_MODEL=flash):
   * $0.101 a 2K image, $0.50 a million tokens in (the photographs it is shown),
   * $3 a million out for its thinking (ai.google.dev/pricing, 2026-10-04; no free
   * tier, so a shopper's photograph never reaches one).
   */
  image: { provider: "google", id: "gemini-3.1-flash-image", pricing: { kind: "per_unit", unit: "image", usdPerUnit: 0.101, inputUsdPerMillion: 0.5, outputUsdPerMillion: 3 } },
  /** Nano Banana Pro (Gemini 3 Pro Image), the default: $0.134 a 1K or 2K image, $2 a million in, $12 out (same page and date). */
  imagePro: { provider: "google", id: "gemini-3-pro-image", pricing: { kind: "per_unit", unit: "image", usdPerUnit: 0.134, inputUsdPerMillion: 2, outputUsdPerMillion: 12 } },
  /** The same model at 4K ($0.24 an image): the sixteen showroom rooms only, made once (docs/adr/060). */
  imagePro4k: { provider: "google", id: "gemini-3-pro-image", pricing: { kind: "per_unit", unit: "image", usdPerUnit: 0.24, inputUsdPerMillion: 2, outputUsdPerMillion: 12 } },
  /** Nano Banana 2 at 4K ($0.151 an image): a showroom room's fallback when Pro cannot make it. */
  image4k: { provider: "google", id: "gemini-3.1-flash-image", pricing: { kind: "per_unit", unit: "image", usdPerUnit: 0.151, inputUsdPerMillion: 0.5, outputUsdPerMillion: 3 } },
  /** The quality check on every AI picture before anyone sees it (docs/adr/060): a fraction of a cent a look. */
  pictureJudge: GEMINI_FLASH,
  /** Veo 3.1 Lite: "Animate me", five seconds at 720p. */
  video: { provider: "google", id: "veo-3.1-lite-generate-preview", pricing: { kind: "per_unit", unit: "second", usdPerUnit: 0.05 } },
  /** Virtual try-on (FASHN). The model name is confirmed against FASHN's API reference in Phase 9 (src/lib/ai/providers/fashn.ts). */
  tryOn: { provider: "fashn", id: "tryon", pricing: { kind: "per_unit", unit: "call", usdPerUnit: 0.075 } },
  /**
   * Realtime voice, OpenAI (docs/adr/030). gpt-realtime-2.1 rather than the
   * newer gpt-live-1: Live cannot be given a short-lived browser token or the
   * shop's tools (@ai-sdk/openai 4.0.70 refuses both), so it would need a
   * server relay for the audio. Billed per audio token ($32 in, $64 out per
   * million; one token per 100 ms heard and per 50 ms spoken), which is at
   * most about $0.10 for a minute of both, plus the instructions and tools
   * sent with each answer. The browser holds the socket, so the shop cannot
   * count those tokens; it charges by the minute at a rate that errs high.
   */
  voiceOpenai: { provider: "openai", id: "gpt-realtime-2.1", pricing: { kind: "per_unit", unit: "minute", usdPerUnit: 0.15 } },
  /**
   * Realtime voice, Google: Gemini 3.8 Live, $0.005 a minute heard and $0.018
   * a minute spoken (ai.google.dev, 2026-09-26), plus the context each turn
   * re-reads. Charged by the minute at a rate that errs high, like the above.
   */
  voiceGoogle: { provider: "google", id: "gemini-3.8-live", pricing: { kind: "per_unit", unit: "minute", usdPerUnit: 0.03 } },
  /**
   * A 3D model from a piece's studio photograph (docs/adr/059): Microsoft's
   * TRELLIS on fal, $0.02 a model (fal.ai/models/fal-ai/trellis, checked
   * 2026-10-03). Run only by hand (scripts/models.ts ai), after George's yes,
   * and the price is checked again before any batch.
   */
  model3d: { provider: "fal", id: "fal-ai/trellis", pricing: { kind: "per_unit", unit: "model", usdPerUnit: 0.02 } },
  /** TRELLIS.2: sharper shapes and real PBR materials, $0.30 a model at 1024 (fal's page, checked 2026-10-03). */
  model3dPro: { provider: "fal", id: "fal-ai/trellis-2", pricing: { kind: "per_unit", unit: "model", usdPerUnit: 0.3 } },
} as const satisfies Record<string, ModelEntry>;

export type ModelKey = keyof typeof MODELS;

/** What one call used: tokens for text models, units for the rest. */
export type Usage = { inputTokens?: number; outputTokens?: number; units?: number };

/**
 * The cost of one call in millionths of a euro, rounded up so many small calls
 * never add up to less than they cost; null when the price is not confirmed.
 */
export function costMicros(pricing: Pricing, usage: Usage): number | null {
  const usd =
    pricing.kind === "tokens"
      ? ((usage.inputTokens ?? 0) * pricing.inputUsdPerMillion + (usage.outputTokens ?? 0) * pricing.outputUsdPerMillion) / 1_000_000
      : pricing.kind === "per_unit"
        ? (usage.units ?? 0) * pricing.usdPerUnit +
          ((usage.inputTokens ?? 0) * (pricing.inputUsdPerMillion ?? 0) + (usage.outputTokens ?? 0) * (pricing.outputUsdPerMillion ?? 0)) / 1_000_000
        : null;
  if (usd === null) return null;
  // Rounded to 1e-9 first, so 0.1 + 0.2 style noise cannot push an exact amount up by a whole micro.
  return Math.ceil(Number((usd * USD_TO_EUR * 1_000_000).toFixed(3)));
}

/** Euros → millionths of a euro, for comparing against the daily budget. */
export const eurToMicros = (eur: number) => Math.round(eur * 1_000_000);
