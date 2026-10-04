/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * AI pictures in the database: asked for within the day's allowance, made by a job, and found again — a scene by anyone.
 */

import type postgres from "postgres";
import { uuidv7 } from "uuidv7";

import { utcDay, type ActorKind } from "@/lib/ai/usage";
import { PICTURE_CAPS, type PictureKind, type PictureStatus, type SceneStyle } from "@/lib/pictures/pictures";
import { verdictSchema, type Verdict } from "@/lib/pictures/quality";

type Sql = postgres.Sql;

export type Picture = {
  id: string;
  kind: PictureKind;
  productId: string;
  style: SceneStyle | null;
  uploadId: string | null;
  actorKey: string;
  status: PictureStatus;
  provider: string;
  model: string;
  resultKey: string | null;
  previewKey: string | null;
  downloadKey: string | null;
  failureReason: string | null;
  costMicros: number | null;
  /** The quality check on the picture kept (src/lib/pictures/quality.ts), or null. */
  quality: Verdict | null;
  attempts: number;
  promptVersion: string | null;
  expiresAt: Date | null;
  createdAt: Date;
};

type Row = {
  id: string;
  kind: string;
  product_id: string;
  style: string | null;
  upload_id: string | null;
  actor_key: string;
  status: string;
  provider: string;
  model: string;
  result_key: string | null;
  preview_key: string | null;
  download_key: string | null;
  failure_reason: string | null;
  cost_micros: number | null;
  quality: unknown;
  attempts: number | null;
  prompt_version: string | null;
  expires_at: Date | string | null;
  created_at: Date | string;
};

/** A stored verdict, read back as the check wrote it; anything else (an older row, a hand edit) is no verdict. */
function readVerdict(value: unknown): Verdict | null {
  const parsed = verdictSchema.safeParse(typeof value === "string" ? JSON.parse(value) : value);
  return parsed.success ? parsed.data : null;
}

const toPicture = (row: Row): Picture => ({
  id: row.id,
  kind: row.kind as PictureKind,
  productId: row.product_id,
  style: row.style as SceneStyle | null,
  uploadId: row.upload_id,
  actorKey: row.actor_key,
  status: row.status as PictureStatus,
  provider: row.provider,
  model: row.model,
  resultKey: row.result_key,
  previewKey: row.preview_key ?? null,
  downloadKey: row.download_key ?? null,
  failureReason: row.failure_reason,
  costMicros: row.cost_micros,
  quality: readVerdict(row.quality),
  attempts: row.attempts ?? 0,
  promptVersion: row.prompt_version ?? null,
  expiresAt: row.expires_at === null ? null : new Date(row.expires_at),
  createdAt: new Date(row.created_at),
});

export type StartPicture = {
  kind: PictureKind;
  productId: string;
  style: SceneStyle | null;
  uploadId: string | null;
  actor: { key: string; kind: ActorKind };
  provider: string;
  model: string;
  expiresAt: Date | null;
};

export type Started = { ok: true; picture: Picture; made: boolean } | { ok: false; reason: "allowance" };

/**
 * `fixtures`: whether pictures made by the tests' stand-in (PICTURES_PROVIDER=fixture) are served. Only
 * while the stand-in is in use, so a test run's pictures never reach a normal one on the same database.
 */
export function createPictureStore(sql: Sql, { fixtures = false }: { fixtures?: boolean } = {}) {
  /** Which makers' scenes are shown: never the old drawn previews, and the stand-in's only in its own runs. */
  const served = sql`provider <> 'drawn' AND (provider <> 'fixture' OR ${fixtures})`;

  /**
   * Asks for a picture. A scene someone already made, or is making, is
   * returned as it is (`made: false`): it costs nothing and uses none of the
   * allowance. Anything else is a new picture, recorded only if the shopper
   * has not yet made their day's share — the count and the insert are one
   * statement, so two quick clicks cannot both slip under the cap.
   */
  async function start(input: StartPicture, at = new Date()): Promise<Started> {
    if (input.kind === "scene" && input.style !== null) {
      const existing = await sceneFor(input.productId, input.style);
      if (existing !== null) return { ok: true, picture: existing, made: false };
    }
    const id = uuidv7();
    const cap = PICTURE_CAPS[input.actor.kind];
    const dayStart = `${utcDay(at)}T00:00:00Z`;
    const rows = await sql<Row[]>`
      INSERT INTO pictures (id, kind, product_id, style, upload_id, actor_key, status, provider, model, expires_at, created_at, updated_at)
      SELECT ${id}, ${input.kind}, ${input.productId}, ${input.style}, ${input.uploadId}, ${input.actor.key}, 'queued', ${input.provider}, ${input.model},
             ${input.expiresAt === null ? null : input.expiresAt.toISOString()}::timestamptz, ${at.toISOString()}::timestamptz, ${at.toISOString()}::timestamptz
      WHERE (
        SELECT count(*) FROM pictures
        WHERE actor_key = ${input.actor.key} AND created_at >= ${dayStart}::timestamptz AND status <> 'failed'
      ) < ${cap}
      ON CONFLICT DO NOTHING
      RETURNING *
    `;
    const row = rows[0];
    if (row !== undefined) return { ok: true, picture: toPicture(row), made: true };
    // Nothing inserted: either the day's share is used, or another shopper started the same scene a moment ago.
    if (input.kind === "scene" && input.style !== null) {
      const raced = await sceneFor(input.productId, input.style);
      if (raced !== null) return { ok: true, picture: raced, made: false };
    }
    return { ok: false, reason: "allowance" };
  }

  /**
   * The scene of a piece in a style that is made or being made, if any: anyone
   * may see it. The shop's old drawn previews (docs/adr/053) are never shown
   * again: only a picture a model made counts (docs/adr/060).
   */
  async function sceneFor(productId: string, style: SceneStyle): Promise<Picture | null> {
    const rows = await sql<Row[]>`
      SELECT * FROM pictures WHERE kind = 'scene' AND product_id = ${productId} AND style = ${style} AND status <> 'failed' AND ${served}
      ORDER BY created_at DESC LIMIT 1
    `;
    return rows[0] === undefined ? null : toPicture(rows[0]);
  }

  /** Every finished scene of a piece made by a model, for its page. */
  async function scenesOf(productId: string): Promise<Picture[]> {
    const rows = await sql<Row[]>`
      SELECT * FROM pictures WHERE kind = 'scene' AND product_id = ${productId} AND status = 'done' AND ${served} ORDER BY created_at
    `;
    return rows.map(toPicture);
  }

  /** One picture: a scene for anyone; a shopper's own only for them, and only while it lives. */
  async function view(id: string, actorKey: string | null, at = new Date()): Promise<Picture | null> {
    const rows = await sql<Row[]>`SELECT * FROM pictures WHERE id = ${id} LIMIT 1`;
    const picture = rows[0] === undefined ? null : toPicture(rows[0]);
    if (picture === null) return null;
    if (picture.kind === "scene") return picture;
    if (picture.actorKey !== actorKey) return null;
    if (picture.expiresAt !== null && picture.expiresAt <= at) return null;
    return picture;
  }

  /** What a job needs and nobody else: the row as it is. */
  async function byIdForJob(id: string): Promise<Picture | null> {
    const rows = await sql<Row[]>`SELECT * FROM pictures WHERE id = ${id} LIMIT 1`;
    return rows[0] === undefined ? null : toPicture(rows[0]);
  }

  async function mark(
    id: string,
    change: {
      status: PictureStatus;
      resultKey?: string;
      previewKey?: string;
      downloadKey?: string;
      failureReason?: string;
      costMicros?: number | null;
      quality?: Verdict | null;
      attempts?: number;
      promptVersion?: string;
    },
  ) {
    await sql`
      UPDATE pictures SET
        status = ${change.status},
        result_key = COALESCE(${change.resultKey ?? null}, result_key),
        preview_key = COALESCE(${change.previewKey ?? null}, preview_key),
        download_key = COALESCE(${change.downloadKey ?? null}, download_key),
        failure_reason = ${change.failureReason ?? null},
        cost_micros = COALESCE(${change.costMicros ?? null}, cost_micros),
        quality = COALESCE(${change.quality == null ? null : JSON.stringify(change.quality)}::text::jsonb, quality),
        attempts = COALESCE(${change.attempts ?? null}::int, attempts),
        prompt_version = COALESCE(${change.promptVersion ?? null}, prompt_version),
        updated_at = now()
      WHERE id = ${id}
    `;
  }

  /** Pictures this shopper may still make today. */
  async function left(actor: { key: string; kind: ActorKind }, at = new Date()): Promise<number> {
    const [row] = await sql<{ made: number }[]>`
      SELECT count(*)::int AS made FROM pictures
      WHERE actor_key = ${actor.key} AND created_at >= ${`${utcDay(at)}T00:00:00Z`}::timestamptz AND status <> 'failed'
    `;
    return Math.max(0, PICTURE_CAPS[actor.kind] - (row?.made ?? 0));
  }

  /** This shopper's own pictures still alive, newest first. */
  async function forActor(actorKey: string, at = new Date()): Promise<Picture[]> {
    const rows = await sql<Row[]>`
      SELECT * FROM pictures
      WHERE actor_key = ${actorKey} AND kind <> 'scene' AND (expires_at IS NULL OR expires_at > ${at.toISOString()}::timestamptz)
      ORDER BY created_at DESC LIMIT 20
    `;
    return rows.map(toPicture);
  }

  /** This shopper's own pictures of one piece, still alive and not failed, newest first: what they come back to. */
  async function mineFor(actorKey: string, productId: string, at = new Date()): Promise<Picture[]> {
    const rows = await sql<Row[]>`
      SELECT * FROM pictures
      WHERE actor_key = ${actorKey} AND product_id = ${productId} AND kind <> 'scene' AND provider <> 'drawn' AND status <> 'failed'
        AND (expires_at IS NULL OR expires_at > ${at.toISOString()}::timestamptz)
      ORDER BY created_at DESC LIMIT 6
    `;
    return rows.map(toPicture);
  }

  /**
   * The room photograph this shopper last gave the shop, while it lives
   * (docs/adr/060, "your room, remembered"): one tap pictures any other piece
   * in it. The planner's pictures are left out — they already hold a placed
   * piece — and so is anything deleted or past its day.
   */
  async function rememberedRoom(actorKey: string, at = new Date()): Promise<{ uploadId: string; storageKey: string; expiresAt: Date } | null> {
    const [row] = await sql<{ id: string; storage_key: string; expires_at: Date | string }[]>`
      SELECT u.id, u.storage_key, u.expires_at FROM uploads u
      WHERE u.actor_key = ${actorKey} AND u.kind = 'room' AND u.deleted_at IS NULL AND u.expires_at > ${at.toISOString()}::timestamptz
        AND NOT EXISTS (SELECT 1 FROM pictures p WHERE p.upload_id = u.id AND p.kind = 'room')
      ORDER BY u.created_at DESC LIMIT 1
    `;
    return row === undefined ? null : { uploadId: row.id, storageKey: row.storage_key, expiresAt: new Date(row.expires_at) };
  }

  return { start, sceneFor, scenesOf, view, byIdForJob, mark, left, forActor, mineFor, rememberedRoom };
}

export type PictureStore = ReturnType<typeof createPictureStore>;
