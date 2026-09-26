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

export const PRICES_CHECKED = "2026-09-26";
export const USD_TO_EUR = 1;

export type Pricing =
  | { kind: "tokens"; inputUsdPerMillion: number; outputUsdPerMillion: number }
  | { kind: "per_unit"; unit: "image" | "second" | "minute" | "call"; usdPerUnit: number }
  | { kind: "unverified" };

export type ModelEntry = {
  /**
   * "drawn" is the keyless stand-in that composes rather than generates
   * (docs/adr/023); "browser" is work the browser itself does — the speech of
   * docs/adr/026 — which costs nothing and still deserves a line in the usage
   * table, so /admin/ai shows the feature being used.
   */
  provider: "google" | "openai" | "fashn" | "demo" | "drawn" | "browser";
  id: string;
  pricing: Pricing;
};

/** What the shop uses AI for; every recorded cost names one. */
export const AI_FEATURES = ["concierge", "support_chat", "support_draft", "voice", "embedding", "snap", "try_on", "animate", "capsule_image", "translation"] as const;
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
  /** Nano Banana 2: capsule photography. */
  image: { provider: "google", id: "gemini-3.1-flash-image-preview", pricing: { kind: "per_unit", unit: "image", usdPerUnit: 0.067 } },
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
        ? (usage.units ?? 0) * pricing.usdPerUnit
        : null;
  if (usd === null) return null;
  // Rounded to 1e-9 first, so 0.1 + 0.2 style noise cannot push an exact amount up by a whole micro.
  return Math.ceil(Number((usd * USD_TO_EUR * 1_000_000).toFixed(3)));
}

/** Euros → millionths of a euro, for comparing against the daily budget. */
export const eurToMicros = (eur: number) => Math.round(eur * 1_000_000);
