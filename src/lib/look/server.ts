/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Shop the look: the pieces in a shopper's photograph found by the model, measured and searched for by the shop.
 */

import { generateText, Output } from "ai";

import { serverEnv } from "@/env";
import { LOOK_PROMPT } from "@/lib/ai/prompts/look-v1";
import { MODELS } from "@/lib/ai/models";
import { textModel } from "@/lib/ai/providers";
import { aiMode, usageStore } from "@/lib/ai/server";
import { runSearch } from "@/lib/catalog/server";
import { lookQuery, lookSchema, piecesOf, type FoundPiece, type Region } from "@/lib/look/look";
import { searchableColours } from "@/lib/vision/palette";
import { paletteOfImage, snapSearch } from "@/lib/vision/snap-server";

/**
 * docs/adr/054. One model call per photograph (Gemini Flash, MODELS.snap,
 * about a fifth of a cent), through the shop's guard — the kill switch and the
 * day's budget — and recorded as `shop_the_look`. The model returns boxes
 * and plain names only (look-v1); for each box the shop crops the photograph,
 * measures its colours with its own palette (k-means, ADR-024) and searches
 * with that colour and the name. The photograph is the shopper's, given with
 * consent for this (ADR-023 rules) and never logged.
 *
 * Without a model (no key, or demo mode) nothing pretends to find pieces:
 * the whole photograph is one pin and the shop searches with its colours, as
 * Snap to shop does — and the page says so.
 */

export type LookPin = { region: Region; kind: string | null; words: string[]; colours: string[]; productIds: string[] };
export type LookResult = { ok: true; pins: LookPin[]; drawn: boolean } | { ok: false; reason: "off" | "kill_switch" | "budget" | "turns" | "credits" | "unreadable" | "nothing" };

const MATCHES = 3;

async function crop(bytes: Buffer, region: Region): Promise<Buffer | null> {
  const { default: sharp } = await import("sharp");
  const image = sharp(bytes).rotate();
  const { width, height } = await image.metadata();
  if (width === undefined || height === undefined) return null;
  const left = Math.floor(region.x * width);
  const top = Math.floor(region.y * height);
  const extract = { left, top, width: Math.max(8, Math.min(width - left, Math.round(region.width * width))), height: Math.max(8, Math.min(height - top, Math.round(region.height * height))) };
  return sharp(bytes).rotate().extract(extract).toBuffer().catch(() => null);
}

/** Pieces from the model, or null when there is no model to ask (the shop then reads the whole photograph). */
async function findPieces(bytes: Buffer, mediaType: string, actorKey: string): Promise<{ ok: true; pieces: FoundPiece[] | null } | { ok: false; reason: "off" | "kill_switch" | "budget" | "turns" | "credits" }> {
  const env = serverEnv();
  if (aiMode() !== "google" || env.GOOGLE_GENERATIVE_AI_API_KEY === undefined) return { ok: true, pieces: null };
  const usage = await usageStore();
  const gate = await usage.open();
  if (!gate.ok) return gate;
  const chosen = textModel("google", MODELS.snap, { locale: "en", apiKey: env.GOOGLE_GENERATIVE_AI_API_KEY });
  if (chosen === null) return { ok: true, pieces: null };
  const result = await generateText({
    model: chosen.model,
    output: Output.object({ schema: lookSchema }),
    messages: [{ role: "user", content: [{ type: "text", text: LOOK_PROMPT }, { type: "file", data: new Uint8Array(bytes), mediaType }] }],
  });
  await usage.record({
    feature: "shop_the_look",
    model: MODELS.snap,
    surface: "snap",
    actorKey,
    usage: { inputTokens: result.usage.inputTokens ?? 0, outputTokens: result.usage.outputTokens ?? 0 },
  });
  const answer = lookSchema.safeParse(result.output);
  return { ok: true, pieces: answer.success ? piecesOf(answer.data) : [] };
}

export async function shopTheLook(photo: { bytes: Buffer; mediaType: string }, { actorKey, locale }: { actorKey: string; locale: "en" | "el" }): Promise<LookResult> {
  const found = await findPieces(photo.bytes, photo.mediaType, actorKey);
  if (!found.ok) return found;

  if (found.pieces === null) {
    // No model: the whole photograph, by its colours, as Snap to shop reads it.
    const seen = await paletteOfImage(photo.bytes);
    if (seen === null) return { ok: false, reason: "unreadable" };
    const ids = await snapSearch(seen, { locale, limit: MATCHES * 2 });
    return { ok: true, drawn: true, pins: [{ region: { x: 0, y: 0, width: 1, height: 1 }, kind: null, words: [], colours: searchableColours(seen), productIds: ids }] };
  }
  if (found.pieces.length === 0) return { ok: false, reason: "nothing" };

  const pins = await Promise.all(
    found.pieces.map(async (piece) => {
      const cut = await crop(photo.bytes, piece.region);
      const seen = cut === null ? null : await paletteOfImage(cut);
      const colours = seen === null ? [] : searchableColours(seen, 2);
      const result = await runSearch(lookQuery(piece, colours[0] ?? null), { limit: MATCHES });
      return { region: piece.region, kind: piece.kind, words: piece.words, colours, productIds: result.ids.slice(0, MATCHES) };
    }),
  );
  return { ok: true, drawn: false, pins };
}
