/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Starting an AI picture, the same way from the page and from the Concierge: the guard, the allowance, the photograph, the job.
 */

import { uuidv7 } from "uuidv7";

import { serverEnv } from "@/env";
import { MODELS } from "@/lib/ai/models";
import { aiMode, usageStore } from "@/lib/ai/server";
import type { Actor } from "@/lib/ai/usage";
import { enqueue } from "@/lib/jobs/queue";
import { checkUpload, MAX_UPLOAD_BYTES } from "@/lib/photos/photos";
import { acceptPhoto, photoStore, photoUrl } from "@/lib/photos/server";
import { sceneUrl, type PictureKind, type PictureStatus, type SceneStyle } from "@/lib/pictures/pictures";
import { pictureStore } from "@/lib/pictures/server";
import type { Picture } from "@/lib/pictures/store";

/**
 * docs/adr/053. One function for every way in (CLAUDE.md rule 4): the product
 * page and the planner post to /api/pictures, the Concierge calls
 * `picture_in_room`, and both arrive here. In order:
 *
 * 1. A showroom scene someone already made, or is making, is returned at once:
 *    no cost, no allowance.
 * 2. The shop's guard, before anything is spent: off, the kill switch, the
 *    day's budget (skipped when the shop draws the picture itself, for nothing).
 * 3. The shopper's own allowance (an account 3 a day, a guest 1).
 * 4. The photograph, for a picture of the shopper's own room: a new one
 *    through every photo rule (consent, re-encoded, a day to live), or one
 *    they already gave the shop in this conversation. The picture expires
 *    with it, never later.
 * 5. The row, counted against the allowance in the same statement, then the job.
 */

export type PictureView = { id: string; kind: PictureKind; style: SceneStyle | null; status: PictureStatus; url: string | null; drawn: boolean; reason: string | null };

export type StartRefusal =
  | "not_found"
  | "off"
  | "kill_switch"
  | "budget"
  | "allowance"
  | "invalid_request"
  | "no_consent"
  | "type"
  | "too_large"
  | "too_small"
  | "too_many"
  | "unreadable"
  | "photo_gone";

/** Where the room comes from: a new photograph with its consent, one the shopper already gave, or none (a showroom scene). */
export type RoomSource = { file: File; consent: boolean } | { uploadId: string } | null;

export type StartResult = { ok: true; picture: Picture; made: boolean; left: number } | { ok: false; reason: StartRefusal };

/**
 * The model makes the picture only when George has turned it on (PICTURES_PROVIDER=google) and the shop has a
 * key; otherwise the shop draws it, for nothing. A deploy never starts spending by itself.
 */
export const picturesDrawn = () =>
  serverEnv().PICTURES_PROVIDER !== "google" || aiMode() !== "google" || serverEnv().GOOGLE_GENERATIVE_AI_API_KEY === undefined;

/** What a browser is shown of a picture: a scene's public address, or a short-lived link to the shopper's own. */
export async function pictureView(picture: Picture): Promise<PictureView> {
  const url =
    picture.status !== "done" || picture.resultKey === null ? null : picture.kind === "scene" ? sceneUrl(picture.id) : await photoUrl(picture.resultKey);
  return { id: picture.id, kind: picture.kind, style: picture.style, status: picture.status, url, drawn: picture.provider === "drawn", reason: picture.failureReason };
}

export async function startPicture(input: {
  actor: Actor;
  userId: string | null;
  productId: string;
  kind: PictureKind;
  style: SceneStyle | null;
  room: RoomSource;
}): Promise<StartResult> {
  const { actor, kind, style, room } = input;
  const store = await pictureStore();
  if ((kind === "scene") !== (style !== null) || (kind === "scene") !== (room === null)) return { ok: false, reason: "invalid_request" };

  if (kind === "scene" && style !== null) {
    const existing = await store.sceneFor(input.productId, style);
    if (existing !== null) return { ok: true, picture: existing, made: false, left: await store.left(actor) };
  }

  const drawn = picturesDrawn();
  if (!drawn) {
    const gate = await (await usageStore()).open();
    if (!gate.ok) return { ok: false, reason: gate.reason === "turns" || gate.reason === "credits" ? "allowance" : gate.reason };
  }
  if ((await store.left(actor)) === 0) return { ok: false, reason: "allowance" };

  let uploadId: string | null = null;
  let expiresAt: Date | null = null;
  if (room !== null && "file" in room) {
    const photos = await photoStore();
    const allowed = checkUpload({ kind: "room", contentType: room.file.type, bytes: room.file.size, consent: room.consent, held: await photos.countForActor(actor.key) });
    if (!allowed.ok) return { ok: false, reason: allowed.reason === "kind" ? "invalid_request" : allowed.reason };
    if (room.file.size > MAX_UPLOAD_BYTES) return { ok: false, reason: "too_large" };
    const accepted = await acceptPhoto({ id: uuidv7(), kind: "room", actorKey: actor.key, userId: input.userId, bytes: new Uint8Array(await room.file.arrayBuffer()) });
    if (!accepted.ok) return { ok: false, reason: accepted.reason };
    uploadId = accepted.photo.id;
    expiresAt = accepted.photo.expiresAt;
  } else if (room !== null) {
    // A photograph the shopper already gave the shop: only their own, and only while it lasts.
    const photo = await (await photoStore()).byId(room.uploadId, actor.key);
    if (photo === null || photo.expiresAt.getTime() <= Date.now()) return { ok: false, reason: "photo_gone" };
    uploadId = photo.id;
    expiresAt = photo.expiresAt;
  }

  const started = await store.start({
    kind,
    productId: input.productId,
    style,
    uploadId,
    actor,
    provider: drawn ? "drawn" : "google",
    model: drawn ? "vitrine-drawn-picture" : MODELS.image.id,
    expiresAt,
  });
  if (!started.ok) return { ok: false, reason: "allowance" };
  if (started.made) await enqueue("picture-render", { pictureId: started.picture.id, requestedAt: new Date().toISOString() });
  return { ok: true, picture: started.picture, made: started.made, left: await store.left(actor) };
}
