/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The audit log: what counts as a change, and writing an entry in the same transaction as the change it records.
 */

import type postgres from "postgres";
import { uuidv7 } from "uuidv7";

/**
 * Audit log (docs/adr/018). An entry names who acted, what they did to which
 * record, and only the fields that changed, before and after. It is written by
 * the same transaction as the change, so there is never a change without its
 * entry, or an entry for a change that was rolled back.
 */

export const AUDIT_ACTIONS = ["product.update", "stock.set", "review.hide", "review.restore", "role.grant", "role.revoke"] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_ENTITIES = ["product", "variant", "review", "user"] as const;
export type AuditEntity = (typeof AUDIT_ENTITIES)[number];

export type AuditChanges = Record<string, { before: unknown; after: unknown }>;

/** The person acting, or null for the system (ADMIN_EMAILS, a script). */
export type AuditActor = { userId: string; email: string } | null;

export type AuditEntry = {
  actor: AuditActor;
  action: AuditAction;
  entityType: AuditEntity;
  entityId: string;
  changes: AuditChanges;
  reason?: string | null;
};

/** Values compared as a person reading the log would: dates by instant, arrays and objects by content. */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a instanceof Date || b instanceof Date) {
    return a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : false;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, index) => sameValue(item, b[index]));
  }
  if (a !== null && b !== null && typeof a === "object" && typeof b === "object") {
    const keysA = Object.keys(a).sort();
    const keysB = Object.keys(b).sort();
    return sameValue(keysA, keysB) && keysA.every((key) => sameValue((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
  }
  return Object.is(a, b);
}

/**
 * The fields of `after` that differ from `before`. A field missing from
 * `after` (undefined) was not part of the edit and is not a change; setting a
 * field to null is.
 */
export function diffFields<T extends Record<string, unknown>>(before: T, after: Partial<T>): AuditChanges {
  const changes: AuditChanges = {};
  for (const key of Object.keys(after).sort()) {
    const next = after[key];
    if (next === undefined) continue;
    const previous = before[key];
    if (!sameValue(previous, next)) {
      changes[key] = { before: previous instanceof Date ? previous.toISOString() : (previous ?? null), after: next instanceof Date ? next.toISOString() : next };
    }
  }
  return changes;
}

/** The row an entry becomes; shared by the raw-SQL and the Drizzle writers. */
export function auditRow(entry: AuditEntry, at = new Date()) {
  return {
    id: uuidv7(),
    actorUserId: entry.actor?.userId ?? null,
    actorEmail: entry.actor?.email ?? null,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    changes: entry.changes,
    reason: entry.reason ?? null,
    createdAt: at,
  };
}

export type AuditListEntry = {
  id: string;
  createdAt: Date;
  actorEmail: string | null;
  action: AuditAction;
  entityType: AuditEntity;
  entityId: string;
  changes: AuditChanges;
  reason: string | null;
  /** The product the entry is about (directly, or through a variant or review), when it still exists. */
  product: { id: string; titleEn: string; titleEl: string | null } | null;
  /** The variant's SKU, for stock entries. */
  sku: string | null;
  /** The account's email, for role entries. */
  userEmail: string | null;
};

/** Newest first, optionally one kind of record, a page at a time. */
export async function listAudit(
  sql: postgres.Sql,
  { entity = null, limit = 50, offset = 0 }: { entity?: AuditEntity | null; limit?: number; offset?: number } = {},
): Promise<{ entries: AuditListEntry[]; more: boolean }> {
  const rows = await sql<{
    id: string;
    created_at: Date;
    actor_email: string | null;
    action: AuditAction;
    entity_type: AuditEntity;
    entity_id: string;
    changes: AuditChanges;
    reason: string | null;
    product_id: string | null;
    title_en: string | null;
    title_el: string | null;
    sku: string | null;
    user_email: string | null;
  }[]>`
    SELECT a.id, a.created_at, a.actor_email, a.action, a.entity_type, a.entity_id, a.changes, a.reason,
           p.id AS product_id, p.title_en, p.title_el, v.sku, u.email AS user_email
    FROM audit_log a
    LEFT JOIN product_variants v ON a.entity_type = 'variant' AND v.id::text = a.entity_id
    LEFT JOIN reviews r ON a.entity_type = 'review' AND r.id::text = a.entity_id
    LEFT JOIN products p ON p.id::text = CASE a.entity_type WHEN 'product' THEN a.entity_id WHEN 'variant' THEN v.product_id::text WHEN 'review' THEN r.product_id::text END
    LEFT JOIN users u ON a.entity_type = 'user' AND u.id::text = a.entity_id
    WHERE ${entity === null ? sql`TRUE` : sql`a.entity_type = ${entity}`}
    ORDER BY a.created_at DESC, a.id DESC
    LIMIT ${limit + 1} OFFSET ${offset}
  `;
  return {
    more: rows.length > limit,
    entries: rows.slice(0, limit).map((row) => ({
      id: row.id,
      createdAt: new Date(row.created_at),
      actorEmail: row.actor_email,
      action: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id,
      // Drizzle-wrapped clients hand jsonb back as text; the shared client as an object.
      changes: typeof row.changes === "string" ? (JSON.parse(row.changes) as AuditChanges) : row.changes,
      reason: row.reason,
      product: row.product_id === null ? null : { id: row.product_id, titleEn: row.title_en!, titleEl: row.title_el },
      sku: row.sku,
      userEmail: row.user_email,
    })),
  };
}

/** Writes one entry; call it with the transaction that makes the change. */
export async function recordAudit(tx: postgres.Sql | postgres.TransactionSql, entry: AuditEntry, at = new Date()): Promise<void> {
  const row = auditRow(entry, at);
  await tx`
    INSERT INTO audit_log (id, actor_user_id, actor_email, action, entity_type, entity_id, changes, reason, created_at)
    VALUES (${row.id}, ${row.actorUserId}, ${row.actorEmail}, ${row.action}, ${row.entityType},
            ${row.entityId}, ${JSON.stringify(row.changes)}::text::jsonb, ${row.reason}, ${at.toISOString()}::timestamptz)
  `;
}
