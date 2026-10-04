/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * One AI picture of a piece in a room: the room and the piece's photographs in, a checked photograph out, every call's cost recorded.
 */

import { serverEnv } from "@/env";
import { MODELS, type ModelEntry, type Usage } from "@/lib/ai/models";
import { createUsageStore } from "@/lib/ai/usage";
import { ABO_PRODUCT_KINDS, roomPlacement } from "@/lib/catalog/taxonomy";
import { sql } from "@/lib/db/client";
import type { JobPayloads } from "@/lib/jobs/types";
import { loggerFor } from "@/lib/log";
import { fixtureJudge, fixtureMaker, googleJudge, googleMaker, type ImageMaker, type PictureJudge } from "@/lib/pictures/makers";
import { pictureFiles, roomTypeFor, showroomFiles } from "@/lib/pictures/pictures";
import { encodePicture, renderPicture } from "@/lib/pictures/render";
import { chooseReferenceMedia, detailCrop, prepareImage, type PictureImage } from "@/lib/pictures/studio";
import { createPictureStore, type Picture } from "@/lib/pictures/store";
import { storage } from "@/lib/storage";

/**
 * docs/adr/053, docs/adr/060. The picture was asked for, inside the
 * shopper's allowance, by POST /api/pictures or the Concierge; this makes it
 * (src/lib/pictures/render.ts) and stores its three files. The shopper's
 * photograph never leaves the shop's storage except to the paid model and
 * its check, and the picture made from it is stored beside it with the same
 * day to live; a showroom scene is stored with the catalogue's media and kept.
 * Every call — each attempt and each check — is recorded under room_picture
 * as it happens, so /admin/ai and the daily budget see what was really spent,
 * kept or not.
 *
 * The piece's photographs are fetched from the shop's public addresses (or
 * the catalogue's image bucket), so this works in the worker as in the web
 * process. Nothing here logs an image or a prompt.
 */

/** Who makes and checks this picture: the one its row was promised to when it was asked for. */
function workersFor(picture: Picture, env: ReturnType<typeof serverEnv>): { maker: ImageMaker; judge: PictureJudge } | "retired" | "off" {
  if (picture.provider === "fixture") return { maker: fixtureMaker(), judge: fixtureJudge() };
  // The old drawn previews are not made any more (docs/adr/060); a row still queued from before is let go.
  if (picture.provider !== "google") return "retired";
  if (env.GOOGLE_GENERATIVE_AI_API_KEY === undefined || env.aiMode !== "google") return "off";
  const entry: ModelEntry = picture.model === MODELS.image.id ? MODELS.image : MODELS.imagePro;
  return { maker: googleMaker(entry, env.GOOGLE_GENERATIVE_AI_API_KEY), judge: googleJudge(env.GOOGLE_GENERATIVE_AI_API_KEY) };
}

/** One photograph by its address: the shop's own paths against APP_URL, the catalogue bucket's as they are. */
async function fetchImage(src: string, base: string): Promise<PictureImage | null> {
  const response = await fetch(new URL(src, base), { signal: AbortSignal.timeout(20_000) }).catch(() => null);
  if (response === null || !response.ok) return null;
  return { bytes: new Uint8Array(await response.arrayBuffer()), contentType: response.headers.get("content-type") ?? "image/jpeg" };
}

export async function processPictureRender(payload: JobPayloads["picture-render"], jobId: string) {
  const log = loggerFor({ job: "picture-render", jobId });
  const env = serverEnv();
  const pictures = createPictureStore(sql);
  const usage = createUsageStore(sql, { mode: env.aiMode, killSwitch: env.AI_KILL_SWITCH, dailyBudgetEur: env.AI_DAILY_BUDGET_EUR });
  const files = await storage();

  const picture = await pictures.byIdForJob(payload.pictureId);
  if (picture === null) return { ok: false, reason: "gone" };
  if (picture.status === "done") return { ok: true, already: true };

  let spent = 0;
  const fail = async (reason: string, extra: { attempts?: number; quality?: Parameters<typeof pictures.mark>[1]["quality"] } = {}) => {
    // A failed picture does not count against the shopper's day (store.ts counts only the others); what was spent stays recorded.
    await pictures.mark(picture.id, { status: "failed", failureReason: reason, costMicros: spent, ...extra });
    log.warn({ picture: picture.id, kind: picture.kind, reason, attempts: extra.attempts ?? 0, costMicros: spent }, "picture failed");
    return { ok: false, reason };
  };

  const workers = workersFor(picture, env);
  if (workers === "retired" || workers === "off") return fail(workers);
  await pictures.mark(picture.id, { status: "running" });

  const [piece] = await sql<{ title_en: string; kind: string; dims_cm: { w: number; d: number; h: number } | null; colors: string[]; materials: string[]; color_label: string | null }[]>`
    SELECT title_en, kind, dims_cm, colors, materials, color_label FROM products WHERE id = ${picture.productId}
  `;
  if (piece === undefined) return fail("piece_gone");
  const media = await sql<{ src: string; kind: string; white_ground: boolean; position: number }[]>`
    SELECT src, kind, white_ground, position FROM product_media WHERE product_id = ${picture.productId} AND kind = 'image'
  `;

  // The piece's own photographs, as the model reads them, and the close crop from the first on white.
  const chosen = chooseReferenceMedia(media.map((row) => ({ src: row.src, kind: row.kind, whiteGround: row.white_ground, position: row.position })));
  const originals = await Promise.all(chosen.map((entry) => fetchImage(entry.src, env.APP_URL)));
  const references = (await Promise.all(originals.map((image) => (image === null ? null : prepareImage(image))))).filter((image): image is PictureImage => image !== null);
  if (references.length === 0) return fail("piece_image");
  const studio = chosen[0]?.whiteGround === true ? originals[0] : null;
  const detail = studio == null ? null : await detailCrop(studio);

  const roomType = roomTypeFor(piece.kind, piece.title_en, piece.dims_cm);
  let room: PictureImage | null = null;
  if (picture.uploadId !== null) {
    const [upload] = await sql<{ storage_key: string }[]>`SELECT storage_key FROM uploads WHERE id = ${picture.uploadId} AND deleted_at IS NULL AND expires_at > now()`;
    const file = upload === undefined ? null : await files.getObject(upload.storage_key);
    if (file === null) return fail("photo_gone");
    room = { bytes: file.body, contentType: file.contentType };
  } else if (picture.style !== null) {
    // The style's own room photograph, if it has been made (scripts/pictures.ts showrooms); without it the model makes the whole room.
    const base = await files.getObject(showroomFiles(picture.style, roomType).original);
    room = base === null ? null : { bytes: base.body, contentType: base.contentType };
  }

  const spend = async (entry: ModelEntry, used: Usage) => {
    const cost = await usage.record({ feature: "room_picture", model: entry, surface: picture.kind === "scene" ? "showroom" : "room", actorKey: picture.actorKey, usage: used });
    spent += cost ?? 0;
  };
  const rendered = await renderPicture(
    { ...workers, spend },
    {
      kind: picture.kind,
      piece: {
        title: piece.title_en,
        kindLabel: ABO_PRODUCT_KINDS[piece.kind]?.kindEn ?? null,
        dimsCm: piece.dims_cm,
        lies: roomPlacement(piece.kind, piece.dims_cm) === "lie",
        colours: piece.color_label === null ? piece.colors : [piece.color_label],
        materials: piece.materials,
      },
      style: picture.style,
      roomType,
      room,
      references,
      detail,
    },
  );
  if (!rendered.ok) return fail(rendered.reason, { attempts: rendered.attempts, quality: rendered.verdict });

  const encoded = await encodePicture(rendered.image);
  const keys = pictureFiles(picture.id, picture.kind);
  await files.putObject({ key: keys.result, body: encoded.result, contentType: "image/webp" });
  await files.putObject({ key: keys.preview, body: encoded.preview, contentType: "image/webp" });
  await files.putObject({ key: keys.download, body: encoded.download, contentType: "image/jpeg" });
  await pictures.mark(picture.id, {
    status: "done",
    resultKey: keys.result,
    previewKey: keys.preview,
    downloadKey: keys.download,
    costMicros: spent,
    quality: rendered.verdict,
    attempts: rendered.attempts,
    promptVersion: rendered.promptVersion,
  });
  const stats = { picture: picture.id, kind: picture.kind, roomType, attempts: rendered.attempts, costMicros: spent, width: encoded.width, height: encoded.height, references: references.length, showroom: picture.kind === "scene" && room !== null };
  log.info(stats, "picture made");
  return { ok: true, ...stats };
}
