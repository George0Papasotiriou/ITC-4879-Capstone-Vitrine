/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The Fitting Room's studio on the server: one place that starts try-ons, outfits, videos and model shots, for the pages and the Concierge alike.
 */

import { connection } from "next/server";
import { uuidv7 } from "uuidv7";

import { serverEnv } from "@/env";
import { aiMode, usageStore } from "@/lib/ai/server";
import type { Actor, GateRefusal } from "@/lib/ai/usage";
import { sql } from "@/lib/db/client";
import { canAnimate, studioMode, type StudioMode } from "@/lib/fitting/driver";
import { isWearable, planOutfit, tryOnEngine } from "@/lib/fitting/engines";
import type { ModelPreset } from "@/lib/fitting/presets";
import { createModelShotStore, type ModelShotRow, type ModelShotStore } from "@/lib/fitting/shots-store";
import { enqueue } from "@/lib/jobs/queue";
import { photoExpiry } from "@/lib/photos/photos";
import { photoStore } from "@/lib/photos/server";

/**
 * docs/adr/063. The routes and the Concierge's tools both come here, so the
 * rules are said once: a photograph the shopper gave, pieces that can be worn,
 * an outfit in dressing order, credits reserved before anything is made, and
 * the work done as a job the page can ask about.
 */

let shots: ModelShotStore | undefined;
export async function modelShotStore(): Promise<ModelShotStore> {
  await connection();
  return (shots ??= createModelShotStore(sql));
}

export function currentStudioMode(): StudioMode {
  return studioMode(serverEnv());
}

/** What a try-on is recorded as, by how it will be made. */
function makerFor(mode: StudioMode, kind: string): { provider: string; model: string } {
  if (mode === "drawn") return { provider: "drawn", model: "vitrine-drawn-composite" };
  const model = tryOnEngine(kind, serverEnv().FASHN_TRYON_MODEL) === "max" ? "tryon-max" : "tryon-v1.6";
  return { provider: mode === "fixture" ? "fixture" : "fashn", model };
}

type Wearable = { id: string; kind: string };

/** The active pieces asked for, in the order asked; null when any is missing. */
async function wearables(productIds: readonly string[]): Promise<Wearable[] | null> {
  if (productIds.length === 0) return null;
  const rows = await sql<{ id: string; kind: string }[]>`SELECT id, kind FROM products WHERE id = ANY(${[...productIds]}::uuid[]) AND status = 'active'`;
  const byId = new Map(rows.map((row) => [row.id, row]));
  const found = productIds.map((id) => byId.get(id));
  return found.some((row) => row === undefined) ? null : (found as Wearable[]);
}

export type StartTryOnsResult =
  | { ok: true; ids: string[]; outfitId: string | null }
  | { ok: false; reason: "not_found" | "not_wearable" | "too_few" | "too_many" | "same_slot" | "dress_and_separates" | GateRefusal };

/**
 * One piece, or an outfit of two to four. An outfit's pieces are try-ons
 * sharing an id, put on in dressing order, each made on the picture the one
 * before made; only the first is queued, and each queues the next when it is
 * done (src/worker/processors/try-on.ts). Credits are taken for every piece
 * at once, and given back for any piece that is never made.
 */
export async function startTryOns(input: { actor: Actor; photoId: string; productIds: readonly string[]; variantId?: string | null }): Promise<StartTryOnsResult> {
  const store = await photoStore();
  const photo = await store.byId(input.photoId, input.actor.key);
  if (photo === null || photo.kind !== "try_on") return { ok: false, reason: "not_found" };
  const pieces = await wearables(input.productIds);
  if (pieces === null) return { ok: false, reason: "not_found" };
  if (pieces.some((piece) => !isWearable(piece.kind))) return { ok: false, reason: "not_wearable" };

  let ordered: Wearable[] = pieces;
  if (pieces.length > 1) {
    const plan = planOutfit(pieces);
    if (!plan.ok) return { ok: false, reason: plan.reason };
    ordered = plan.pieces;
  }

  const mode = currentStudioMode();
  // The service is paid: it runs only when the shop's AI is on. The stand-in costs nothing.
  if (mode === "service" && aiMode() === "off") return { ok: false, reason: "off" };
  const usage = await usageStore();
  const reserved = await usage.reserveCredits(input.actor, "try_on", new Date(), ordered.length);
  if (!reserved.ok) return { ok: false, reason: reserved.reason };

  const outfitId = ordered.length > 1 ? uuidv7() : null;
  const ids: string[] = [];
  for (const [position, piece] of ordered.entries()) {
    ids.push(
      await store.startTryOn({
        uploadId: photo.id,
        productId: piece.id,
        variantId: ordered.length === 1 ? (input.variantId ?? null) : null,
        actorKey: input.actor.key,
        ...makerFor(mode, piece.kind),
        // The result goes when the photograph does, and never later.
        expiresAt: photo.expiresAt ?? photoExpiry(new Date()),
        outfitId,
        outfitPosition: outfitId === null ? null : position,
      }),
    );
  }
  await enqueue("try-on", { tryOnId: ids[0]!, requestedAt: new Date().toISOString() });
  return { ok: true, ids, outfitId };
}

export type StartVideoResult = { ok: true } | { ok: false; reason: "sign_in" | "needs_service" | "not_ready" | GateRefusal };

/**
 * "See it move": five seconds of video from a finished try-on. Accounts only
 * (a guest's day of credits would not cover one), never with the stand-in,
 * and once per try-on.
 */
export async function startTryOnVideo(input: { actor: Actor; tryOnId: string }): Promise<StartVideoResult> {
  if (input.actor.kind !== "customer") return { ok: false, reason: "sign_in" };
  const mode = currentStudioMode();
  if (!canAnimate(mode)) return { ok: false, reason: "needs_service" };
  if (mode === "service" && aiMode() === "off") return { ok: false, reason: "off" };
  const store = await photoStore();
  const tryOn = await store.tryOnById(input.tryOnId, input.actor.key);
  if (tryOn === null || tryOn.status !== "done" || (tryOn.videoStatus !== null && tryOn.videoStatus !== "failed")) return { ok: false, reason: "not_ready" };

  const usage = await usageStore();
  const reserved = await usage.reserveCredits(input.actor, "animate");
  if (!reserved.ok) return { ok: false, reason: reserved.reason };
  if (!(await store.requestVideo(input.tryOnId, input.actor.key))) {
    await usage.releaseCredits(input.actor, "animate", new Date().toISOString().slice(0, 10));
    return { ok: false, reason: "not_ready" };
  }
  await enqueue("try-on-video", { tryOnId: input.tryOnId, requestedAt: new Date().toISOString() });
  return { ok: true };
}

export type ModelShotView = { preset: ModelPreset; status: ModelShotRow["status"]; url: string | null };
export type RequestShotResult = { ok: true; shot: ModelShotView; charged: boolean } | { ok: false; reason: "not_found" | "not_wearable" | "needs_service" | GateRefusal };

const view = (shot: ModelShotRow): ModelShotView => ({ preset: shot.preset, status: shot.status, url: shot.status === "done" && shot.storageKey !== null ? `/media/${shot.storageKey}` : null });

/** The model shots a piece has, ready or being made. */
export async function modelShotsFor(productId: string): Promise<ModelShotView[]> {
  return (await (await modelShotStore()).forProduct(productId)).map(view);
}

/**
 * "On a model like you". A shot already made, or being made, is the answer
 * for free; otherwise the shopper who asks pays for it once, and everyone
 * after them sees it without paying.
 */
export async function requestModelShot(input: { actor: Actor; productId: string; preset: ModelPreset }): Promise<RequestShotResult> {
  const mode = currentStudioMode();
  if (!canAnimate(mode)) return { ok: false, reason: "needs_service" };
  if (mode === "service" && aiMode() === "off") return { ok: false, reason: "off" };
  const [piece] = (await wearables([input.productId])) ?? [];
  if (piece === undefined) return { ok: false, reason: "not_found" };
  if (!isWearable(piece.kind)) return { ok: false, reason: "not_wearable" };

  const store = await modelShotStore();
  const existing = (await store.forProduct(input.productId)).find((shot) => shot.preset === input.preset);
  if (existing !== undefined && existing.status !== "failed") return { ok: true, shot: view(existing), charged: false };

  const usage = await usageStore();
  const reserved = await usage.reserveCredits(input.actor, "model_shot");
  if (!reserved.ok) return { ok: false, reason: reserved.reason };
  const { shot, created } = await store.request({
    productId: input.productId,
    preset: input.preset,
    provider: mode === "fixture" ? "fixture" : "fashn",
    model: "product-to-model",
    requestedBy: input.actor.key,
  });
  if (!created) {
    // Someone else asked a moment before: theirs is the one being made, and this shopper pays nothing.
    await usage.releaseCredits(input.actor, "model_shot", new Date().toISOString().slice(0, 10));
    return { ok: true, shot: view(shot), charged: false };
  }
  await enqueue("model-shot", { shotId: shot.id, requestedAt: new Date().toISOString() });
  return { ok: true, shot: view(shot), charged: true };
}
