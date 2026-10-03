/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * One AI picture of a piece in a room: the room and the piece in, the picture stored, its cost recorded.
 */

import { serverEnv } from "@/env";
import { MODELS, type ModelEntry } from "@/lib/ai/models";
import { imageModel } from "@/lib/ai/providers";
import { createUsageStore } from "@/lib/ai/usage";
import { sql } from "@/lib/db/client";
import type { JobPayloads } from "@/lib/jobs/types";
import { loggerFor } from "@/lib/log";
import { pictureKey, sceneKey } from "@/lib/pictures/pictures";
import { roomPlacement } from "@/lib/catalog/taxonomy";
import { renderDrawn, renderWithModel, type PictureImage } from "@/lib/pictures/render";
import { createPictureStore } from "@/lib/pictures/store";
import { storage } from "@/lib/storage";

/**
 * docs/adr/053. The picture was asked for, inside the shopper's allowance, by
 * POST /api/pictures; this makes it. The shopper's photograph never leaves the
 * shop's storage except to the paid model, and the picture made from it is
 * stored beside it, with the same day to live; a showroom scene is stored with
 * the catalogue's media and kept. The cost is recorded under room_picture, so
 * /admin/ai shows it and the daily budget counts it.
 *
 * The piece's studio photograph — its first on a white ground, as the shop
 * window draws from (docs/adr/048) — is fetched from the shop's public URL, so
 * this works in the worker as in the web process. Nothing here logs an image.
 */

/** How the drawn stand-in is recorded, so the AI page can tell it apart. */
const DRAWN_MODEL: ModelEntry = { provider: "drawn", id: "vitrine-drawn-picture", pricing: { kind: "tokens", inputUsdPerMillion: 0, outputUsdPerMillion: 0 } };

export async function processPictureRender(payload: JobPayloads["picture-render"], jobId: string) {
  const log = loggerFor({ job: "picture-render", jobId });
  const env = serverEnv();
  const pictures = createPictureStore(sql);
  const usage = createUsageStore(sql, { mode: env.aiMode, killSwitch: env.AI_KILL_SWITCH, dailyBudgetEur: env.AI_DAILY_BUDGET_EUR });
  const files = await storage();

  const picture = await pictures.byIdForJob(payload.pictureId);
  if (picture === null) return { ok: false, reason: "gone" };
  if (picture.status === "done") return { ok: true, already: true };

  const fail = async (reason: string) => {
    // A failed picture does not count against the shopper's day (store.ts counts only the others).
    await pictures.mark(picture.id, { status: "failed", failureReason: reason });
    log.warn({ picture: picture.id, kind: picture.kind, reason }, "picture failed");
    return { ok: false, reason };
  };
  await pictures.mark(picture.id, { status: "running" });

  const [piece] = await sql<{ title_en: string; kind: string; dims_cm: { w: number; d: number; h: number } | null; studio_src: string | null }[]>`
    SELECT p.title_en, p.kind, p.dims_cm,
           (SELECT m.src FROM product_media m WHERE m.product_id = p.id AND m.kind = 'image' ORDER BY m.white_ground DESC NULLS LAST, m.position LIMIT 1) AS studio_src
    FROM products p WHERE p.id = ${picture.productId}
  `;
  if (piece === undefined || piece.studio_src === null) return fail("piece_gone");

  let room: PictureImage | null = null;
  if (picture.uploadId !== null) {
    const [upload] = await sql<{ storage_key: string }[]>`SELECT storage_key FROM uploads WHERE id = ${picture.uploadId} AND deleted_at IS NULL AND expires_at > now()`;
    const file = upload === undefined ? null : await files.getObject(upload.storage_key);
    if (file === null) return fail("photo_gone");
    room = { bytes: file.body, contentType: file.contentType };
  }

  const response = await fetch(new URL(piece.studio_src, env.APP_URL)).catch(() => null);
  if (response === null || !response.ok) return fail("piece_image");
  const studio: PictureImage = { bytes: new Uint8Array(await response.arrayBuffer()), contentType: response.headers.get("content-type") ?? "image/jpeg" };

  const facts = { title: piece.title_en, dimsCm: piece.dims_cm, lies: roomPlacement(piece.kind, piece.dims_cm) === "lie" };
  const input = { kind: picture.kind, piece: facts, style: picture.style, room, studio };
  // The picture is made the way it was promised when it was asked for (src/lib/pictures/start.ts): a row
  // recorded as drawn is drawn even if a key has since appeared, so its label and its cost always agree.
  const chosen = picture.provider === "drawn" ? null : imageModel(env.aiMode, MODELS.image, { apiKey: env.GOOGLE_GENERATIVE_AI_API_KEY });
  const rendered = chosen === null ? await renderDrawn(input) : await renderWithModel(chosen.model, input);
  if (!rendered.ok) return fail(rendered.reason);

  const key = picture.kind === "scene" ? sceneKey(picture.id) : pictureKey(picture.id);
  await files.putObject({ key, body: rendered.image, contentType: "image/webp" });
  const cost = await usage.record({
    feature: "room_picture",
    model: rendered.drawn ? DRAWN_MODEL : MODELS.image,
    surface: picture.kind === "scene" ? "showroom" : "room",
    actorKey: picture.actorKey,
    usage: { units: 1 },
  });
  await pictures.mark(picture.id, { status: "done", resultKey: key, costMicros: cost });
  const stats = { picture: picture.id, kind: picture.kind, drawn: rendered.drawn, costMicros: cost, bytes: rendered.image.byteLength };
  log.info(stats, "picture made");
  return { ok: true, ...stats };
}
