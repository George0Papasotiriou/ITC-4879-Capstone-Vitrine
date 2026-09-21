/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Server wiring for photographs: the store, re-encoding on arrival, signed links, and deleting one.
 */

import { connection } from "next/server";

import { sql } from "@/lib/db/client";
import { logger } from "@/lib/log";
import { checkDecoded, photoKey, STORED_EDGE_PX, type PhotoKind } from "@/lib/photos/photos";
import { createPhotoStore, type PhotoRow, type PhotoStore } from "@/lib/photos/store";
import { storage } from "@/lib/storage";

/**
 * A photograph arrives here, is re-encoded, and is written to the shop's own
 * storage (docs/adr/023). Re-encoding is the privacy step as much as the size
 * step: it drops the camera's metadata — where and when the photograph was
 * taken, and on what — before anything is stored.
 *
 * Nothing in this file ever logs a photograph, its bytes, or anything from it.
 */

let store: PhotoStore | undefined;

export async function photoStore(): Promise<PhotoStore> {
  await connection();
  return (store ??= createPhotoStore(sql));
}

export type AcceptedPhoto = { ok: true; photo: PhotoRow } | { ok: false; reason: "type" | "too_small" | "unreadable" };

/**
 * Re-encodes and stores one photograph. `bytes` is whatever the browser sent;
 * what is kept is a WebP of at most 1280 px, with no metadata.
 */
export async function acceptPhoto(
  input: { id: string; kind: PhotoKind; actorKey: string; userId: string | null; bytes: Uint8Array },
  at = new Date(),
): Promise<AcceptedPhoto> {
  // sharp is Node-only and heavy; it is loaded where a photograph is handled.
  const { default: sharp } = await import("sharp");

  let width = 0;
  let height = 0;
  let encoded: Buffer;
  try {
    const source = sharp(Buffer.from(input.bytes), { failOn: "error" });
    const meta = await source.metadata();
    const decoded = checkDecoded({ format: meta.format, width: meta.width, height: meta.height });
    if (!decoded.ok) return { ok: false, reason: decoded.reason === "type" ? "type" : "too_small" };

    const result = await source
      // `rotate()` applies the orientation and drops the rest of the metadata.
      .rotate()
      .resize(STORED_EDGE_PX, STORED_EDGE_PX, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 86 })
      .toBuffer({ resolveWithObject: true });
    encoded = result.data;
    width = result.info.width;
    height = result.info.height;
  } catch {
    // Never log the error: it can carry the file's own bytes.
    return { ok: false, reason: "unreadable" };
  }

  const key = photoKey(input.id);
  await (await storage()).putObject({ key, body: new Uint8Array(encoded), contentType: "image/webp" });
  const photo = await (await photoStore()).record(
    { kind: input.kind, actorKey: input.actorKey, userId: input.userId, storageKey: key, contentType: "image/webp", bytes: encoded.byteLength, width, height },
    at,
  );
  logger.info({ photo: { id: photo.id, kind: photo.kind, bytes: photo.bytes } }, "photograph accepted");
  return { ok: true, photo };
}

/** A short-lived link to a photograph or a try-on result. */
export async function photoUrl(key: string, seconds = 15 * 60): Promise<string> {
  return (await storage()).presignedDownloadUrl({ key, expiresInSeconds: seconds });
}

/** Deletes the files of photographs that are gone, and says how many went. */
export async function removeFiles(keys: readonly string[]): Promise<number> {
  const files = await storage();
  let removed = 0;
  for (const key of keys) {
    try {
      await files.deleteObject(key);
      removed += 1;
    } catch (error) {
      logger.warn({ err: error, key }, "photograph file could not be deleted");
    }
  }
  return removed;
}
