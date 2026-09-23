/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Giving the shop a photograph, and listing the ones it still holds.
 */

import { uuidv7 } from "uuidv7";

import { aiActor, knownActor } from "@/lib/ai/server";
import { currentUser } from "@/lib/auth/session";
import { checkUpload, MAX_UPLOAD_BYTES, minutesLeft, type PhotoKind } from "@/lib/photos/photos";
import { acceptPhoto, photoStore, photoUrl } from "@/lib/photos/server";

/**
 * One route, one photograph (docs/adr/023). The file is sent here rather than
 * straight to storage, because the shop re-encodes it on arrival: that is what
 * removes the camera's metadata before anything is kept.
 *
 * Consent is a field, not a checkbox the server trusts blindly: without it
 * nothing is read, nothing is stored, and the answer says why.
 */

export const runtime = "nodejs";

export type PhotoView = { id: string; kind: PhotoKind; url: string; width: number | null; height: number | null; minutesLeft: number };
export type PhotoResponse =
  | { ok: true; photo: PhotoView }
  | { ok: true; photos: PhotoView[] }
  | { ok: false; reason: "kind" | "type" | "too_large" | "too_small" | "no_consent" | "too_many" | "unreadable" | "invalid_request" };

const refuse = (reason: Extract<PhotoResponse, { ok: false }>["reason"], status: number) => Response.json({ ok: false, reason } satisfies PhotoResponse, { status });

async function view(photo: { id: string; kind: PhotoKind; storageKey: string; width: number | null; height: number | null; expiresAt: Date }): Promise<PhotoView> {
  return { id: photo.id, kind: photo.kind, url: await photoUrl(photo.storageKey), width: photo.width, height: photo.height, minutesLeft: minutesLeft(photo.expiresAt) };
}

export async function GET(): Promise<Response> {
  const user = await currentUser();
  // A list is a read: it never mints a guest id, so it cannot race with the
  // upload that does and leave the photograph belonging to nobody.
  const actor = await knownActor(user);
  if (actor === null) return Response.json({ ok: true, photos: [] } satisfies PhotoResponse);
  const photos = await (await photoStore()).forActor(actor.key);
  return Response.json({ ok: true, photos: await Promise.all(photos.map((photo) => view(photo))) } satisfies PhotoResponse);
}

export async function POST(request: Request): Promise<Response> {
  const user = await currentUser();
  const actor = await aiActor(user);
  const store = await photoStore();

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (form === null || !(file instanceof File)) return refuse("invalid_request", 400);

  const allowed = checkUpload({
    kind: String(form.get("kind") ?? ""),
    contentType: file.type,
    bytes: file.size,
    consent: form.get("consent") === "yes",
    held: await store.countForActor(actor.key),
  });
  if (!allowed.ok) return refuse(allowed.reason, allowed.reason === "too_large" ? 413 : 400);

  // Read only after the checks: an oversized file is refused before it is in memory.
  if (file.size > MAX_UPLOAD_BYTES) return refuse("too_large", 413);
  const bytes = new Uint8Array(await file.arrayBuffer());

  const accepted = await acceptPhoto({
    id: uuidv7(),
    kind: String(form.get("kind")) as PhotoKind,
    actorKey: actor.key,
    userId: user?.id ?? null,
    bytes,
  });
  if (!accepted.ok) return refuse(accepted.reason, 400);
  return Response.json({ ok: true, photo: await view(accepted.photo) } satisfies PhotoResponse);
}
