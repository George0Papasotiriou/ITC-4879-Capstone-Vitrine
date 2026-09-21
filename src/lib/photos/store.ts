/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Photographs and try-ons in the database: recording one, listing a shopper's, and finding what has expired.
 */

import type postgres from "postgres";
import { uuidv7 } from "uuidv7";

import { photoExpiry, type PhotoKind } from "@/lib/photos/photos";

/**
 * The rows behind the Fitting Room (docs/adr/023). A photograph is recorded
 * when it arrives and marked deleted when it goes; the file itself is removed
 * by whoever calls `deleted()`, because only the caller has the storage.
 *
 * Nothing here ever returns a photograph's bytes: routes hand out short-lived
 * signed links instead, so a photograph is never proxied through a page.
 */

type Sql = postgres.Sql;

export type PhotoRow = {
  id: string;
  kind: PhotoKind;
  actorKey: string;
  userId: string | null;
  storageKey: string;
  contentType: string;
  bytes: number;
  width: number | null;
  height: number | null;
  expiresAt: Date;
  createdAt: Date;
};

export type TryOnStatus = "queued" | "running" | "done" | "failed";

export type TryOnRow = {
  id: string;
  uploadId: string;
  productId: string | null;
  variantId: string | null;
  actorKey: string;
  status: TryOnStatus;
  provider: string;
  model: string;
  resultKey: string | null;
  failureReason: string | null;
  costMicros: number | null;
  expiresAt: Date;
  createdAt: Date;
};

const toPhoto = (row: Record<string, unknown>): PhotoRow => ({
  id: row.id as string,
  kind: row.kind as PhotoKind,
  actorKey: row.actor_key as string,
  userId: (row.user_id as string | null) ?? null,
  storageKey: row.storage_key as string,
  contentType: row.content_type as string,
  bytes: Number(row.bytes ?? 0),
  width: (row.width as number | null) ?? null,
  height: (row.height as number | null) ?? null,
  expiresAt: new Date(row.expires_at as string),
  createdAt: new Date(row.created_at as string),
});

const toTryOn = (row: Record<string, unknown>): TryOnRow => ({
  id: row.id as string,
  uploadId: row.upload_id as string,
  productId: (row.product_id as string | null) ?? null,
  variantId: (row.variant_id as string | null) ?? null,
  actorKey: row.actor_key as string,
  status: row.status as TryOnStatus,
  provider: row.provider as string,
  model: row.model as string,
  resultKey: (row.result_key as string | null) ?? null,
  failureReason: (row.failure_reason as string | null) ?? null,
  costMicros: (row.cost_micros as number | null) ?? null,
  expiresAt: new Date(row.expires_at as string),
  createdAt: new Date(row.created_at as string),
});

export function createPhotoStore(sql: Sql) {
  /** Records a photograph that has arrived and been re-encoded. */
  async function record(
    photo: { kind: PhotoKind; actorKey: string; userId: string | null; storageKey: string; contentType: string; bytes: number; width: number; height: number },
    at = new Date(),
  ): Promise<PhotoRow> {
    const id = photo.storageKey.split("/").at(-1)?.replace(/\.[a-z]+$/, "") ?? uuidv7();
    const expiresAt = photoExpiry(at);
    await sql`
      INSERT INTO uploads (id, kind, user_id, actor_key, storage_key, content_type, bytes, width, height, consent_at, expires_at, created_at, updated_at)
      VALUES (${id}, ${photo.kind}, ${photo.userId}, ${photo.actorKey}, ${photo.storageKey}, ${photo.contentType}, ${photo.bytes}, ${photo.width}, ${photo.height},
              ${at.toISOString()}::timestamptz, ${expiresAt.toISOString()}::timestamptz, ${at.toISOString()}::timestamptz, ${at.toISOString()}::timestamptz)
    `;
    return {
      id,
      kind: photo.kind,
      actorKey: photo.actorKey,
      userId: photo.userId,
      storageKey: photo.storageKey,
      contentType: photo.contentType,
      bytes: photo.bytes,
      width: photo.width,
      height: photo.height,
      expiresAt,
      createdAt: at,
    };
  }

  /** One photograph, and only for the shopper who gave it. */
  async function byId(id: string, actorKey: string): Promise<PhotoRow | null> {
    const rows = await sql`SELECT * FROM uploads WHERE id = ${id} AND actor_key = ${actorKey} AND deleted_at IS NULL LIMIT 1`;
    return rows[0] === undefined ? null : toPhoto(rows[0]);
  }

  /** What this shopper has given the shop and not yet lost, newest first. */
  async function forActor(actorKey: string, kind?: PhotoKind): Promise<PhotoRow[]> {
    const rows = await sql`
      SELECT * FROM uploads
      WHERE actor_key = ${actorKey} AND deleted_at IS NULL AND expires_at > now()
      ${kind === undefined ? sql`` : sql`AND kind = ${kind}`}
      ORDER BY created_at DESC
      LIMIT 20
    `;
    return rows.map((row) => toPhoto(row));
  }

  async function countForActor(actorKey: string): Promise<number> {
    const [row] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM uploads WHERE actor_key = ${actorKey} AND deleted_at IS NULL AND expires_at > now()
    `;
    return row?.count ?? 0;
  }

  /** Marks a photograph gone. The caller removes the file; this only records it. */
  async function markDeleted(ids: readonly string[], at = new Date()): Promise<number> {
    if (ids.length === 0) return 0;
    const rows = await sql<{ id: string }[]>`
      UPDATE uploads SET deleted_at = ${at.toISOString()}::timestamptz, updated_at = ${at.toISOString()}::timestamptz
      WHERE id = ANY(${[...ids]}::uuid[]) AND deleted_at IS NULL
      RETURNING id
    `;
    return rows.length;
  }

  /** A shopper deleting their own photograph. */
  async function deleteOwn(id: string, actorKey: string, at = new Date()): Promise<PhotoRow | null> {
    const photo = await byId(id, actorKey);
    if (photo === null) return null;
    await markDeleted([id], at);
    return photo;
  }

  /**
   * Everything past its day, with the try-on results made from it: what the
   * expiry job deletes. Photographs already marked deleted are included while
   * their files may still be there, so a failed delete is retried.
   */
  async function expired(at = new Date(), limit = 200): Promise<{ photos: PhotoRow[]; results: string[] }> {
    const rows = await sql`
      SELECT * FROM uploads WHERE expires_at <= ${at.toISOString()}::timestamptz AND deleted_at IS NULL ORDER BY expires_at LIMIT ${limit}
    `;
    const photos = rows.map((row) => toPhoto(row));
    if (photos.length === 0) return { photos, results: [] };
    const resultRows = await sql<{ result_key: string }[]>`
      SELECT result_key FROM try_ons WHERE upload_id = ANY(${photos.map((photo) => photo.id)}::uuid[]) AND result_key IS NOT NULL
    `;
    return { photos, results: resultRows.map((row) => row.result_key) };
  }

  /* --------------------------------- try-ons -------------------------------- */

  async function startTryOn(
    input: { uploadId: string; productId: string | null; variantId: string | null; actorKey: string; provider: string; model: string; expiresAt: Date },
    at = new Date(),
  ): Promise<string> {
    const id = uuidv7();
    await sql`
      INSERT INTO try_ons (id, upload_id, product_id, variant_id, actor_key, status, provider, model, expires_at, created_at, updated_at)
      VALUES (${id}, ${input.uploadId}, ${input.productId}, ${input.variantId}, ${input.actorKey}, 'queued', ${input.provider}, ${input.model},
              ${input.expiresAt.toISOString()}::timestamptz, ${at.toISOString()}::timestamptz, ${at.toISOString()}::timestamptz)
    `;
    return id;
  }

  async function markTryOn(
    id: string,
    change: { status: TryOnStatus; resultKey?: string | null; failureReason?: string | null; costMicros?: number | null },
    at = new Date(),
  ): Promise<void> {
    await sql`
      UPDATE try_ons SET status = ${change.status},
             result_key = COALESCE(${change.resultKey ?? null}, result_key),
             failure_reason = ${change.failureReason ?? null},
             cost_micros = COALESCE(${change.costMicros ?? null}, cost_micros),
             updated_at = ${at.toISOString()}::timestamptz
      WHERE id = ${id}
    `;
  }

  async function tryOnById(id: string, actorKey: string): Promise<TryOnRow | null> {
    const rows = await sql`SELECT * FROM try_ons WHERE id = ${id} AND actor_key = ${actorKey} LIMIT 1`;
    return rows[0] === undefined ? null : toTryOn(rows[0]);
  }

  /** This shopper's try-ons that have not expired, newest first. */
  async function tryOnsForActor(actorKey: string): Promise<TryOnRow[]> {
    const rows = await sql`
      SELECT * FROM try_ons WHERE actor_key = ${actorKey} AND expires_at > now() ORDER BY created_at DESC LIMIT 20
    `;
    return rows.map((row) => toTryOn(row));
  }

  return { record, byId, forActor, countForActor, markDeleted, deleteOwn, expired, startTryOn, markTryOn, tryOnById, tryOnsForActor };
}

export type PhotoStore = ReturnType<typeof createPhotoStore>;
