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
import { usageStore } from "@/lib/ai/server";
import type { Actor } from "@/lib/ai/usage";
import { enqueue } from "@/lib/jobs/queue";
import { checkUpload, MAX_UPLOAD_BYTES } from "@/lib/photos/photos";
import { acceptPhoto, photoStore, photoUrl } from "@/lib/photos/server";
import { pictureModel, picturesProvider, type PicturesProvider } from "@/lib/pictures/makers";
import { type PictureKind, type PictureStatus, type SceneStyle } from "@/lib/pictures/pictures";
import { pictureStore } from "@/lib/pictures/server";
import type { Picture } from "@/lib/pictures/store";

/**
 * docs/adr/053. One function for every way in (CLAUDE.md rule 4): the product
 * page and the planner post to /api/pictures, the Concierge calls
 * `picture_in_room`, and both arrive here. In order:
 *
 * 1. A showroom scene someone already made, or is making, is returned at once:
 *    no cost, no allowance.
 * 2. Whether pictures are made at all (PICTURES_PROVIDER, a key: docs/adr/060
 *    — there is no drawn stand-in any more), then the shop's guard before
 *    anything is spent: the kill switch and the day's budget.
 * 3. The shopper's own allowance (an account 3 a day, a guest 1).
 * 4. The photograph, for a picture of the shopper's own room: a new one
 *    through every photo rule (consent, re-encoded, a day to live), or one
 *    they already gave the shop in this conversation. The picture expires
 *    with it, never later.
 * 5. The row, counted against the allowance in the same statement, then the job.
 */

/**
 * What a browser is shown of a picture: the picture (up to 2560 px), its
 * 1024 px copy for strips, and where Save fetches the full-size JPEG.
 */
export type PictureView = {
  id: string;
  kind: PictureKind;
  style: SceneStyle | null;
  status: PictureStatus;
  url: string | null;
  previewUrl: string | null;
  downloadUrl: string | null;
  /** The shopper's room photograph it was made from, for their own pictures; null for a scene. */
  uploadId: string | null;
  reason: string | null;
};

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

/** Who makes pictures in this deployment: the image model, the tests' stand-in, or nobody. */
export const currentPicturesProvider = (): PicturesProvider => picturesProvider(serverEnv());

/**
 * Whether a new picture can be asked for right now: pictures are on, and the
 * shop's guard is open (no kill switch, budget left). Pages use it to offer
 * "Picture it" only when it can work; a ready scene is shown either way.
 */
export async function picturesOpen(): Promise<boolean> {
  const provider = currentPicturesProvider();
  if (provider === "off") return false;
  const gate = await (await usageStore()).open(new Date(), { paid: provider === "google" });
  return gate.ok;
}

/** A scene's files are public catalogue media; a shopper's own are given as short-lived links. */
async function fileUrl(picture: Picture, key: string | null): Promise<string | null> {
  if (key === null) return null;
  return picture.kind === "scene" ? `/media/${key}` : photoUrl(key);
}

export async function pictureView(picture: Picture): Promise<PictureView> {
  const done = picture.status === "done";
  const [url, previewUrl] = await Promise.all([fileUrl(picture, done ? picture.resultKey : null), fileUrl(picture, done ? (picture.previewKey ?? picture.resultKey) : null)]);
  // Saved through the shop's own address, which checks whose it is and names the file (/api/pictures?download=).
  const downloadUrl = done ? `/api/pictures?download=${picture.id}` : null;
  return {
    id: picture.id,
    kind: picture.kind,
    style: picture.style,
    status: picture.status,
    url,
    previewUrl,
    downloadUrl,
    // Only ever shown to the photograph's owner (store.ts view): so the same room can picture another piece.
    uploadId: picture.kind === "scene" ? null : picture.uploadId,
    reason: picture.failureReason,
  };
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

  const provider = currentPicturesProvider();
  if (provider === "off") return { ok: false, reason: "off" };
  const gate = await (await usageStore()).open(new Date(), { paid: provider === "google" });
  if (!gate.ok) return { ok: false, reason: gate.reason === "turns" || gate.reason === "credits" ? "allowance" : gate.reason };
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
    provider,
    model: pictureModel(serverEnv()).id,
    expiresAt,
  });
  if (!started.ok) return { ok: false, reason: "allowance" };
  if (started.made) await enqueue("picture-render", { pictureId: started.picture.id, requestedAt: new Date().toISOString() });
  return { ok: true, picture: started.picture, made: started.made, left: await store.left(actor) };
}
