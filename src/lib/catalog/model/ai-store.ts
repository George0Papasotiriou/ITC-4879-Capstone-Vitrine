/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The AI 3D models the shop keeps: listed for staff to look over, and hidden or shown again, every change audited.
 */

import type postgres from "postgres";

import { recordAudit, type AuditActor } from "@/lib/admin/audit";

/**
 * docs/adr/059. An AI model is shown only when its status is "ready". The
 * batch sets "ready" or, when its shape did not match the piece, "rejected";
 * staff can hide a ready one that looks wrong, or show a rejected one that
 * looks right — the fit number is a guide, the person looking decides. Each
 * change is one audited transaction, as review moderation is (docs/adr/017).
 */

export type AiModelRow = {
  id: string;
  productId: string;
  slug: string;
  title: string;
  status: "queued" | "running" | "ready" | "rejected" | "hidden" | "failed";
  model: string;
  fit: number | null;
  bytes: number | null;
  triangles: number | null;
  costMicros: number | null;
  failureReason: string | null;
  storageKey: string | null;
  updatedAt: Date;
  hasScan: boolean;
};

export const AI_MODEL_VIEWS = ["ready", "rejected", "hidden", "failed", "all"] as const;
export type AiModelView = (typeof AI_MODEL_VIEWS)[number];

export function createAiModelStore(sql: postgres.Sql) {
  async function list(view: AiModelView, limit = 200): Promise<AiModelRow[]> {
    const rows = await sql<
      {
        id: string;
        product_id: string;
        slug: string;
        title_en: string;
        status: AiModelRow["status"];
        model: string;
        fit: number | null;
        bytes: number | null;
        triangles: number | null;
        cost_micros: number | null;
        failure_reason: string | null;
        storage_key: string | null;
        updated_at: string | Date;
        has_scan: boolean;
      }[]
    >`
      SELECT pm.id, pm.product_id, p.slug, p.title_en, pm.status, pm.model, pm.fit, pm.bytes, pm.triangles, pm.cost_micros, pm.failure_reason, pm.storage_key, pm.updated_at,
        EXISTS (SELECT 1 FROM product_media m WHERE m.product_id = p.id AND m.kind = 'model') AS has_scan
      FROM product_models pm JOIN products p ON p.id = pm.product_id
      WHERE pm.origin = 'ai' AND (${view} = 'all' OR pm.status = ${view})
      ORDER BY pm.fit ASC NULLS FIRST, pm.updated_at DESC
      LIMIT ${limit}
    `;
    return rows.map((row) => ({
      id: row.id,
      productId: row.product_id,
      slug: row.slug,
      title: row.title_en,
      status: row.status,
      model: row.model,
      fit: row.fit,
      bytes: row.bytes,
      triangles: row.triangles,
      costMicros: row.cost_micros,
      failureReason: row.failure_reason,
      storageKey: row.storage_key,
      updatedAt: new Date(row.updated_at),
      hasScan: row.has_scan,
    }));
  }

  /** Hides a shown model, or shows a hidden or rejected one. A model without a file cannot be shown. */
  async function setShown(id: string, shown: boolean, actor: AuditActor): Promise<{ ok: true } | { ok: false; reason: "not_found" | "no_file" }> {
    return sql.begin(async (tx) => {
      const [row] = await tx<{ product_id: string; status: string; storage_key: string | null }[]>`
        SELECT product_id, status, storage_key FROM product_models WHERE id = ${id} AND origin = 'ai' FOR UPDATE
      `;
      if (row === undefined) return { ok: false as const, reason: "not_found" as const };
      if (shown && row.storage_key === null) return { ok: false as const, reason: "no_file" as const };
      const next = shown ? "ready" : "hidden";
      if (row.status === next) return { ok: true as const };
      await tx`UPDATE product_models SET status = ${next}, updated_at = now() WHERE id = ${id}`;
      await recordAudit(tx, { actor, action: shown ? "model.show" : "model.hide", entityType: "product", entityId: row.product_id, changes: { aiModel: { before: row.status, after: next } } });
      return { ok: true as const };
    });
  }

  return { list, setShown };
}

export type AiModelStore = ReturnType<typeof createAiModelStore>;
