/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Job processor that deletes the photographs whose day is up, and the try-ons made from them.
 */

import { sql } from "@/lib/db/client";
import type { JobPayloads } from "@/lib/jobs/types";
import { loggerFor } from "@/lib/log";
import { createPhotoStore } from "@/lib/photos/store";
import { storage } from "@/lib/storage";

/**
 * The promise in docs/policies.md and docs/PLAN.md 2.9: a photograph is kept
 * for a day. This is what keeps it (docs/adr/023).
 *
 * The file goes first and the row is marked afterwards, so a crash between the
 * two leaves a row whose file is already gone — which the next pass tidies —
 * rather than a row that says "deleted" beside a file that is still there.
 */
export async function processPhotoExpiry(payload: JobPayloads["photo-expiry"], jobId: string) {
  const log = loggerFor({ job: "photo-expiry", jobId });
  const photos = createPhotoStore(sql);
  const files = await storage();

  const { photos: expired, results } = await photos.expired();
  if (expired.length === 0) return { removed: 0, results: 0, reason: payload.reason };

  let removed = 0;
  const gone: string[] = [];
  for (const photo of expired) {
    try {
      await files.deleteObject(photo.storageKey);
      gone.push(photo.id);
      removed += 1;
    } catch (error) {
      log.warn({ err: error, photo: photo.id }, "photograph file could not be deleted");
    }
  }
  for (const key of results) {
    try {
      await files.deleteObject(key);
    } catch (error) {
      log.warn({ err: error }, "try-on result could not be deleted");
    }
  }
  await photos.markDeleted(gone);

  const stats = { removed, results: results.length, reason: payload.reason };
  log.info(stats, "photographs past their day removed");
  return stats;
}
