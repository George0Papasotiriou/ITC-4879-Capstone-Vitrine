/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Turns the catalogue's ABO 3D scans into light files in the shop's storage, a few at a time.
 */

import type postgres from "postgres";
import { uuidv7 } from "uuidv7";

import { serverEnv } from "@/env";
import { ABO_BUCKET } from "@/lib/catalog/abo";
import { compressModel, modelKey } from "@/lib/catalog/model-compress";
import { extentMatches } from "@/lib/catalog/turntable";
import { sql } from "@/lib/db/client";
import type { JobPayloads } from "@/lib/jobs/types";
import { loggerFor } from "@/lib/log";
import { storage } from "@/lib/storage";
import type { StorageDriver } from "@/lib/storage/types";

/**
 * docs/adr/035. After a deploy the database knows which pieces have a scan
 * (`products.model_source`, from the committed fixture) and which already
 * have it as `model` media. Each run takes the next few, most popular first:
 * downloads the original from ABO's public bucket, compresses it
 * (model-compress.ts), stores it, and only then adds the media row — so a
 * piece shows its stand-in shape until its scan is ready, never a broken one.
 * One model is in memory at a time. A scan that cannot be read or is far too
 * large is set aside (its source cleared, logged) rather than retried every
 * run; the next deploy's sync offers it once more.
 */

/** Scans larger than this are left alone: a phone could not open the result either. */
const MAX_ORIGINAL_BYTES = 150 * 1024 * 1024;

export type ModelRunStats = { processed: number; repaired: number; skipped: number; remaining: number; bytesIn: number; bytesOut: number };

export async function processCatalogModels(payload: JobPayloads["catalog-models"], jobId: string): Promise<ModelRunStats> {
  const log = loggerFor({ job: "catalog-models", jobId });
  const files = await storage();
  // On a deployment without a bucket each service has its own disk: a scan the
  // worker stored there could never be served by the web service (2026-09-29).
  if (files.kind === "local" && !serverEnv().localStack) {
    log.warn("3D scans wait for the bucket: with local storage the web service cannot read what the worker stores (set the S3_* variables)");
    return { processed: 0, repaired: 0, skipped: 0, remaining: 0, bytesIn: 0, bytesOut: 0 };
  }
  const stats = await compressPendingModels({ sql, files, download: fetch, log }, payload.limit ?? 8);
  log.info({ ...stats, reason: payload.reason }, "3D scans processed");
  return stats;
}

type ModelDeps = {
  sql: postgres.Sql;
  files: Pick<StorageDriver, "putObject" | "exists">;
  /** The ABO bucket in production; a stand-in in tests, which never reach AWS. */
  download: (url: string) => Promise<Response>;
  log: Pick<ReturnType<typeof loggerFor>, "warn">;
};

type Piece = { id: string; source_id: string; model_source: string; dims_cm: { w: number; d: number; h: number } | null };

/**
 * One batch. First the stored scans are checked, a few at a time in turn: a
 * row whose file is missing (a scan stored where the web could not read it,
 * or a bucket emptied by hand) is made again and its row brought up to date —
 * nothing is deleted. Then the next `limit` pieces that have a scan and no
 * stored model get theirs.
 */
export async function compressPendingModels({ sql, files, download, log }: ModelDeps, requested: number): Promise<ModelRunStats> {
  const limit = Math.max(1, Math.min(50, requested));
  const stats: ModelRunStats = { processed: 0, repaired: 0, skipped: 0, remaining: 0, bytesIn: 0, bytesOut: 0 };

  /** Downloads, compresses and stores one scan; false when it was set aside. */
  const store = async (piece: Piece): Promise<{ bytes: number } | false> => {
    const setAside = async (reason: string) => {
      stats.skipped += 1;
      await sql`UPDATE products SET model_source = NULL WHERE id = ${piece.id}`;
      log.warn({ product: piece.source_id, reason }, "3D scan set aside");
      return false as const;
    };
    try {
      const response = await download(`${ABO_BUCKET}/3dmodels/original/${piece.model_source}`);
      if (!response.ok) return await setAside(`download ${response.status}`);
      const declared = Number(response.headers.get("content-length") ?? "0");
      if (declared > MAX_ORIGINAL_BYTES) return await setAside(`too large (${Math.round(declared / 1_048_576)} MB)`);
      const original = new Uint8Array(await response.arrayBuffer());
      const model = await compressModel(original);
      await files.putObject({ key: modelKey(piece.source_id), body: model.glb, contentType: "model/gltf-binary" });
      stats.bytesIn += original.byteLength;
      stats.bytesOut += model.bytes;
      const agrees = extentMatches(model.extentM, piece.dims_cm);
      if (agrees === false) log.warn({ product: piece.source_id, extentM: model.extentM, dimsCm: piece.dims_cm }, "3D scan size differs from the listing");
      return { bytes: model.bytes };
    } catch (error) {
      return await setAside(error instanceof Error ? error.message.slice(0, 120) : "unreadable");
    }
  };

  // The stored ones, oldest check first; each checked row moves to the back of the queue.
  const stored = await sql<(Piece & { media_id: string; src: string })[]>`
    SELECT m.id AS media_id, m.src, p.id, p.source_id, p.model_source, p.dims_cm
    FROM product_media m JOIN products p ON p.id = m.product_id
    WHERE m.kind = 'model' AND p.model_source IS NOT NULL AND p.status = 'active'
    ORDER BY m.updated_at, m.id
    LIMIT ${limit * 4}
  `;
  for (const row of stored) {
    // Storage unreachable counts as present: a hiccup must not re-download every scan.
    const present = await files.exists(row.src.replace(/^\/media\//, "")).catch(() => true);
    if (!present && stats.repaired < limit) {
      const made = await store(row);
      if (made !== false) {
        await sql`UPDATE product_media SET src = ${`/media/${modelKey(row.source_id)}`}, bytes = ${made.bytes}, updated_at = now() WHERE id = ${row.media_id}`;
        stats.repaired += 1;
      }
      continue;
    }
    await sql`UPDATE product_media SET updated_at = now() WHERE id = ${row.media_id}`;
  }

  const pending = await sql<Piece[]>`
    SELECT p.id, p.source_id, p.model_source, p.dims_cm FROM products p
    WHERE p.model_source IS NOT NULL AND p.status = 'active'
      AND NOT EXISTS (SELECT 1 FROM product_media m WHERE m.product_id = p.id AND m.kind = 'model')
    ORDER BY p.popularity DESC, p.source_id
    LIMIT ${limit}
  `;
  for (const piece of pending) {
    const made = await store(piece);
    if (made === false) continue;
    await sql`
      INSERT INTO product_media (id, product_id, kind, src, bytes, alt_en, position)
      VALUES (${uuidv7()}, ${piece.id}, 'model', ${`/media/${modelKey(piece.source_id)}`}, ${made.bytes}, 'A 3D scan of the piece', 0)
    `;
    stats.processed += 1;
  }

  const [left] = await sql<{ count: number }[]>`
    SELECT count(*)::int AS count FROM products p
    WHERE p.model_source IS NOT NULL AND p.status = 'active'
      AND NOT EXISTS (SELECT 1 FROM product_media m WHERE m.product_id = p.id AND m.kind = 'model')
  `;
  stats.remaining = left?.count ?? 0;
  return stats;
}
