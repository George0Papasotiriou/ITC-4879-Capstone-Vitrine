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

export type ModelRunStats = { processed: number; skipped: number; remaining: number; bytesIn: number; bytesOut: number };

export async function processCatalogModels(payload: JobPayloads["catalog-models"], jobId: string): Promise<ModelRunStats> {
  const log = loggerFor({ job: "catalog-models", jobId });
  const stats = await compressPendingModels({ sql, files: await storage(), download: fetch, log }, payload.limit ?? 8);
  log.info({ ...stats, reason: payload.reason }, "3D scans processed");
  return stats;
}

type ModelDeps = {
  sql: postgres.Sql;
  files: Pick<StorageDriver, "putObject">;
  /** The ABO bucket in production; a stand-in in tests, which never reach AWS. */
  download: (url: string) => Promise<Response>;
  log: Pick<ReturnType<typeof loggerFor>, "warn">;
};

/** One batch: the next `limit` pieces with a scan and no stored model. */
export async function compressPendingModels({ sql, files, download, log }: ModelDeps, requested: number): Promise<ModelRunStats> {
  const limit = Math.max(1, Math.min(50, requested));
  const pending = await sql<{ id: string; source_id: string; model_source: string; dims_cm: { w: number; d: number; h: number } | null }[]>`
    SELECT p.id, p.source_id, p.model_source, p.dims_cm FROM products p
    WHERE p.model_source IS NOT NULL AND p.status = 'active'
      AND NOT EXISTS (SELECT 1 FROM product_media m WHERE m.product_id = p.id AND m.kind = 'model')
    ORDER BY p.popularity DESC, p.source_id
    LIMIT ${limit}
  `;
  const stats: ModelRunStats = { processed: 0, skipped: 0, remaining: 0, bytesIn: 0, bytesOut: 0 };

  for (const product of pending) {
    const setAside = async (reason: string) => {
      stats.skipped += 1;
      await sql`UPDATE products SET model_source = NULL WHERE id = ${product.id}`;
      log.warn({ product: product.source_id, reason }, "3D scan set aside");
    };
    try {
      const response = await download(`${ABO_BUCKET}/3dmodels/original/${product.model_source}`);
      if (!response.ok) {
        await setAside(`download ${response.status}`);
        continue;
      }
      const declared = Number(response.headers.get("content-length") ?? "0");
      if (declared > MAX_ORIGINAL_BYTES) {
        await setAside(`too large (${Math.round(declared / 1_048_576)} MB)`);
        continue;
      }
      const original = new Uint8Array(await response.arrayBuffer());
      const model = await compressModel(original);
      const key = modelKey(product.source_id);
      await files.putObject({ key, body: model.glb, contentType: "model/gltf-binary" });
      await sql`
        INSERT INTO product_media (id, product_id, kind, src, bytes, alt_en, position)
        VALUES (${uuidv7()}, ${product.id}, 'model', ${`/media/${key}`}, ${model.bytes}, 'A 3D scan of the piece', 0)
      `;
      stats.processed += 1;
      stats.bytesIn += original.byteLength;
      stats.bytesOut += model.bytes;
      const agrees = extentMatches(model.extentM, product.dims_cm);
      if (agrees === false) log.warn({ product: product.source_id, extentM: model.extentM, dimsCm: product.dims_cm }, "3D scan size differs from the listing");
    } catch (error) {
      await setAside(error instanceof Error ? error.message.slice(0, 120) : "unreadable");
    }
  }

  const [left] = await sql<{ count: number }[]>`
    SELECT count(*)::int AS count FROM products p
    WHERE p.model_source IS NOT NULL AND p.status = 'active'
      AND NOT EXISTS (SELECT 1 FROM product_media m WHERE m.product_id = p.id AND m.kind = 'model')
  `;
  stats.remaining = left?.count ?? 0;
  return stats;
}
