/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * "On a model like you" in the database: a shot per piece and model, made once, then shown to everyone.
 */

import type postgres from "postgres";
import { uuidv7 } from "uuidv7";

import type { ModelPreset } from "@/lib/fitting/presets";

type Sql = postgres.Sql;

export type ShotStatus = "queued" | "running" | "done" | "failed";
export type ModelShotRow = { id: string; productId: string; preset: ModelPreset; status: ShotStatus; storageKey: string | null; failureReason: string | null; provider: string; model: string };

/** Where a shot is stored: under catalog/, so /media serves it to everyone like a showroom picture. */
export const modelShotKey = (productId: string, preset: ModelPreset) => `catalog/model-shots/v1/${productId}-${preset}.jpg`;

const toShot = (row: Record<string, unknown>): ModelShotRow => ({
  id: row.id as string,
  productId: row.product_id as string,
  preset: row.preset as ModelPreset,
  status: row.status as ShotStatus,
  storageKey: (row.storage_key as string | null) ?? null,
  failureReason: (row.failure_reason as string | null) ?? null,
  provider: row.provider as string,
  model: row.model as string,
});

export function createModelShotStore(sql: Sql) {
  /** Every shot of a piece, in the presets' order of asking. */
  async function forProduct(productId: string): Promise<ModelShotRow[]> {
    const rows = await sql`SELECT * FROM model_shots WHERE product_id = ${productId} ORDER BY created_at`;
    return rows.map((row) => toShot(row));
  }

  async function byId(id: string): Promise<ModelShotRow | null> {
    const rows = await sql`SELECT * FROM model_shots WHERE id = ${id} LIMIT 1`;
    return rows[0] === undefined ? null : toShot(rows[0]);
  }

  /**
   * Asks for a shot. When one is being made or is made, that one is the
   * answer and nobody pays again (`created` false); a failed one is asked for
   * afresh. Only the shopper whose request made it is charged.
   */
  async function request(input: { productId: string; preset: ModelPreset; provider: string; model: string; requestedBy: string }, at = new Date()): Promise<{ shot: ModelShotRow; created: boolean }> {
    const inserted = await sql`
      INSERT INTO model_shots (id, product_id, preset, status, provider, model, requested_by, created_at, updated_at)
      VALUES (${uuidv7()}, ${input.productId}, ${input.preset}, 'queued', ${input.provider}, ${input.model}, ${input.requestedBy},
              ${at.toISOString()}::timestamptz, ${at.toISOString()}::timestamptz)
      ON CONFLICT (product_id, preset) DO UPDATE SET status = 'queued', failure_reason = NULL, provider = excluded.provider, model = excluded.model,
        requested_by = excluded.requested_by, updated_at = excluded.updated_at
      WHERE model_shots.status = 'failed'
      RETURNING *
    `;
    if (inserted[0] !== undefined) return { shot: toShot(inserted[0]), created: true };
    const [existing] = await sql`SELECT * FROM model_shots WHERE product_id = ${input.productId} AND preset = ${input.preset}`;
    return { shot: toShot(existing!), created: false };
  }

  async function mark(id: string, change: { status: ShotStatus; storageKey?: string | null; failureReason?: string | null; costMicros?: number | null }, at = new Date()): Promise<void> {
    await sql`
      UPDATE model_shots SET status = ${change.status},
             storage_key = COALESCE(${change.storageKey ?? null}, storage_key),
             failure_reason = ${change.failureReason ?? null},
             cost_micros = COALESCE(${change.costMicros ?? null}, cost_micros),
             updated_at = ${at.toISOString()}::timestamptz
      WHERE id = ${id}
    `;
  }

  return { forProduct, byId, request, mark };
}

export type ModelShotStore = ReturnType<typeof createModelShotStore>;
