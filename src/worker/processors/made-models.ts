/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Builds the shop's own 3D models of the pieces that have no scan, a few at a time, so shoppers rarely wait for one.
 */

import type postgres from "postgres";
import { uuidv7 } from "uuidv7";

import { serverEnv } from "@/env";
import { MODELER_VERSION } from "@/lib/catalog/model";
import { canMakeModel } from "@/lib/catalog/model/family";
import { madeModelFor, madeModelKey, type ModelDeps, type ModelPiece } from "@/lib/catalog/model/serve";
import { ROOM_PLACEMENT } from "@/lib/catalog/taxonomy";
import { sql } from "@/lib/db/client";
import type { JobPayloads } from "@/lib/jobs/types";
import { loggerFor } from "@/lib/log";
import { storage } from "@/lib/storage";

/**
 * docs/adr/058. /api/models makes a model the first time a shopper asks for
 * it, which takes a second or two. This job makes them ahead, most popular
 * first, so that wait is rare. Each run compares the key every piece's model
 * should have now (serve.ts: a hash of what it is made from) with the key
 * recorded in `product_models`, and builds the next few that differ — a new
 * piece, an edited one, or every piece after the modeler's version changes.
 * A piece whose photograph could not be fetched is left for a later run.
 */

export type MadeRunStats = { built: number; found: number; deferred: number; remaining: number };

export async function processMadeModels(payload: JobPayloads["made-models"], jobId: string): Promise<MadeRunStats> {
  const log = loggerFor({ job: "made-models", jobId });
  const files = await storage();
  // Without a bucket each service has its own disk: a model the worker stored could not be served by the web.
  if (files.kind === "local" && !serverEnv().localStack) {
    log.warn("made models wait for the bucket (set the S3_* variables)");
    return { built: 0, found: 0, deferred: 0, remaining: 0 };
  }
  const stats = await buildPendingMadeModels({ sql, files, photo: fetchPhoto }, payload.limit ?? 30);
  log.info({ ...stats, reason: payload.reason }, "made models");
  return stats;
}

/** A studio photograph's bytes from wherever the catalogue keeps it, or null when it cannot be had just now. */
export async function fetchPhoto(src: string): Promise<Uint8Array | null> {
  const response = await fetch(new URL(src, serverEnv().APP_URL), { signal: AbortSignal.timeout(20_000) }).catch(() => null);
  return response?.ok === true ? new Uint8Array(await response.arrayBuffer()) : null;
}

type Row = {
  id: string;
  slug: string;
  kind: string;
  title_en: string;
  attributes: Record<string, string>;
  materials: string[];
  colors: string[];
  dims_cm: { w: number; d: number; h: number } | null;
  images: { src: string; width: number | null; height: number | null; white_ground: boolean }[] | null;
  recorded: string | null;
};

export async function buildPendingMadeModels({ sql, files, photo }: ModelDeps & { sql: postgres.Sql }, requested: number): Promise<MadeRunStats> {
  const limit = Math.max(1, Math.min(60, requested));
  const kinds = Object.keys(ROOM_PLACEMENT);
  const rows = await sql<Row[]>`
    SELECT p.id, p.slug, p.kind, p.title_en, p.attributes, p.materials, p.colors, p.dims_cm,
      (SELECT json_agg(json_build_object('src', m.src, 'width', m.width, 'height', m.height, 'white_ground', m.white_ground) ORDER BY m.position)
         FROM product_media m WHERE m.product_id = p.id AND m.kind = 'image') AS images,
      pm.storage_key AS recorded
    FROM products p
    LEFT JOIN product_models pm ON pm.product_id = p.id AND pm.origin = 'made'
    WHERE p.status = 'active' AND p.dims_cm IS NOT NULL AND p.kind = ANY(${kinds}::text[])
      AND NOT EXISTS (SELECT 1 FROM product_media m WHERE m.product_id = p.id AND m.kind = 'model')
    ORDER BY p.popularity DESC, p.id
  `;
  const stats: MadeRunStats = { built: 0, found: 0, deferred: 0, remaining: 0 };
  const pending: { row: Row; piece: ModelPiece; key: string }[] = [];
  for (const row of rows) {
    if (row.dims_cm === null || !canMakeModel(row.kind, row.dims_cm)) continue;
    const images = (row.images ?? []).map((image) => ({ src: image.src, width: image.width ?? 1100, height: image.height ?? 1100, studio: image.white_ground }));
    const studio = images.find((image) => image.studio) ?? images[0] ?? null;
    const piece: ModelPiece = { slug: row.slug, kind: row.kind, title: row.title_en, attributes: row.attributes, materials: row.materials, colors: row.colors, dims: row.dims_cm, studio: studio?.src ?? null, images };
    const key = madeModelKey(piece);
    if (key !== row.recorded) pending.push({ row, piece, key });
  }
  for (const { row, piece } of pending.slice(0, limit)) {
    const made = await madeModelFor(piece, { files, photo }).catch(() => null);
    if (made === null || made.key === null) {
      stats.deferred += 1;
      continue;
    }
    if (made.stored) stats.found += 1;
    else stats.built += 1;
    await sql`
      INSERT INTO product_models (id, product_id, origin, status, provider, model, storage_key)
      VALUES (${uuidv7()}, ${row.id}, 'made', 'ready', 'vitrine', ${`made-v${MODELER_VERSION}`}, ${made.key})
      ON CONFLICT (product_id, origin) DO UPDATE SET status = 'ready', model = excluded.model, storage_key = excluded.storage_key, failure_reason = NULL, updated_at = now()
    `;
  }
  stats.remaining = Math.max(0, pending.length - stats.built - stats.found);
  return stats;
}
