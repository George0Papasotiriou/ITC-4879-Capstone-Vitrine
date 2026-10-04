/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Which language model answers: Gemini when the shop has a key, the demo rules otherwise, nothing when AI is off.
 */

import { createGoogle } from "@ai-sdk/google";
import type { LanguageModel } from "ai";

import { MODELS, type ModelEntry } from "@/lib/ai/models";
import { createDemoModel } from "@/lib/ai/providers/demo";

/**
 * Providers are swappable behind the AI SDK (ADR-004); model IDs come only
 * from src/lib/ai/models.ts. The key is read from the server environment and
 * handed to the provider explicitly, so no code path can pick up a key from
 * somewhere unexpected.
 */

export type AiMode = "google" | "demo" | "off";

export function textModel(
  mode: AiMode,
  entry: ModelEntry = MODELS.concierge,
  { locale, apiKey }: { locale: "en" | "el"; apiKey?: string },
): { model: LanguageModel; entry: ModelEntry } | null {
  if (mode === "off") return null;
  if (mode === "demo") return { model: createDemoModel({ locale }), entry: { provider: "demo", id: "vitrine-demo-rules", pricing: { kind: "tokens", inputUsdPerMillion: 0, outputUsdPerMillion: 0 } } };
  if (apiKey === undefined) return null;
  return { model: createGoogle({ apiKey })(entry.id), entry };
}
