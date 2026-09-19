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

export const PRICES_CHECKED = "2026-09-11";
export const USD_TO_EUR = 1;

export type Pricing =
  | { kind: "tokens"; inputUsdPerMillion: number; outputUsdPerMillion: number }
  | { kind: "per_unit"; unit: "image" | "second" | "minute" | "call"; usdPerUnit: number }
  | { kind: "unverified" };

export type ModelEntry = {
  provider: "google" | "openai" | "fashn" | "demo";
  id: string;
  pricing: Pricing;
};

/** What the shop uses AI for; every recorded cost names one. */
export const AI_FEATURES = ["concierge", "support_chat", "support_draft", "voice", "embedding", "snap", "try_on", "animate", "capsule_image", "translation"] as const;
export type AiFeature = (typeof AI_FEATURES)[number];

const GEMINI_FLASH: ModelEntry = { provider: "google", id: "gemini-3.7-flash", pricing: { kind: "tokens", inputUsdPerMillion: 0.75, outputUsdPerMillion: 3.75 } };

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
