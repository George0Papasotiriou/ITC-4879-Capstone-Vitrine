/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Agent keys in the database: making, listing and revoking a person's keys, and finding who a key belongs to.
 */

import type postgres from "postgres";
import { uuidv7 } from "uuidv7";

import { recordAudit, type AuditActor } from "@/lib/admin/audit";
import { expiresAfter, hashAgentKey, keyState, MAX_ACTIVE_KEYS, newAgentKey, type AgentKeyState, type AgentScope, type CreateKeyInput } from "@/lib/agents/tokens";
import { parseRoles, type Role } from "@/lib/auth/roles";

/**
 * docs/adr/043. Making and revoking a key are written to the audit log in the
 * same transaction, with the key's name, what it may do and when it ends —
 * never the key. Using a key marks when it was last used, at most once a
 * minute, so a busy assistant does not write on every call.
 */

type Sql = postgres.Sql;

export type AgentKeyView = {
  id: string;
  name: string;
  hint: string;
  scopes: AgentScope[];
  createdAt: Date;
  expiresAt: Date;
  lastUsedAt: Date | null;
  state: AgentKeyState;
};

/** Who a key speaks for, and what it may do; everything a tool needs to act as that person. */
export type AgentIdentity = {
  keyId: string;
  scopes: AgentScope[];
  user: { id: string; name: string; email: string; emailVerified: boolean; roles: Role[]; twoFactorEnabled: boolean };
};

export type CreateKeyResult = { ok: true; key: string; view: AgentKeyView } | { ok: false; reason: "too_many" };

type KeyRow = { id: string; name: string; hint: string; scopes: string[]; created_at: Date; expires_at: Date; last_used_at: Date | null; revoked_at: Date | null };

const LAST_USED_EVERY_MS = 60_000;

function view(row: KeyRow, now: Date): AgentKeyView {
  const expiresAt = new Date(row.expires_at);
  const revokedAt = row.revoked_at === null ? null : new Date(row.revoked_at);
  return {
    id: row.id,
    name: row.name,
    hint: row.hint,
    scopes: row.scopes as AgentScope[],
    createdAt: new Date(row.created_at),
    expiresAt,
    lastUsedAt: row.last_used_at === null ? null : new Date(row.last_used_at),
    state: keyState({ expiresAt, revokedAt }, now),
  };
}

export function createAgentKeyStore(sql: Sql) {
  async function create(owner: { userId: string; email: string }, input: CreateKeyInput, now = new Date()): Promise<CreateKeyResult> {
    return sql.begin(async (tx) => {
      // One person's keys are made one at a time, so two tabs cannot both take the last place.
      await tx`SELECT id FROM users WHERE id = ${owner.userId} FOR UPDATE`;
      const [counted] = await tx<{ active: number }[]>`
        SELECT count(*)::int AS active FROM agent_tokens
        WHERE user_id = ${owner.userId} AND revoked_at IS NULL AND expires_at > ${now.toISOString()}::timestamptz
      `;
      if ((counted?.active ?? 0) >= MAX_ACTIVE_KEYS) return { ok: false, reason: "too_many" } as const;

      const { key, hash, hint } = newAgentKey();
      const id = uuidv7();
      const expiresAt = expiresAfter(input.days, now);
      const [row] = await tx<KeyRow[]>`
        INSERT INTO agent_tokens (id, user_id, name, token_hash, hint, scopes, created_at, expires_at)
        VALUES (${id}, ${owner.userId}, ${input.name}, ${hash}, ${hint}, ${input.scopes}::text[], ${now.toISOString()}::timestamptz, ${expiresAt.toISOString()}::timestamptz)
        RETURNING id, name, hint, scopes, created_at, expires_at, last_used_at, revoked_at
      `;
      const actor: AuditActor = { userId: owner.userId, email: owner.email };
      await recordAudit(tx, {
        actor,
        action: "agent.create",
        entityType: "agent",
        entityId: id,
        changes: { name: { before: null, after: input.name }, scopes: { before: null, after: input.scopes }, expiresAt: { before: null, after: expiresAt.toISOString() } },
      }, now);
      return { ok: true, key, view: view(row!, now) } as const;
    });
  }

  /** The person's keys, newest first, including ended ones for a while so they can see what stopped. */
  async function list(userId: string, now = new Date()): Promise<AgentKeyView[]> {
    const rows = await sql<KeyRow[]>`
      SELECT id, name, hint, scopes, created_at, expires_at, last_used_at, revoked_at FROM agent_tokens
      WHERE user_id = ${userId}
        AND coalesce(revoked_at, expires_at) > ${now.toISOString()}::timestamptz - interval '30 days'
      ORDER BY created_at DESC
      LIMIT 20
    `;
    return rows.map((row) => view(row, now));
  }

  /** Revokes one of the person's own keys; anyone else's id changes nothing. */
  async function revoke(owner: { userId: string; email: string }, keyId: string, now = new Date()): Promise<boolean> {
    return sql.begin(async (tx) => {
      const [row] = await tx<{ id: string; name: string }[]>`
        UPDATE agent_tokens SET revoked_at = ${now.toISOString()}::timestamptz
        WHERE id = ${keyId} AND user_id = ${owner.userId} AND revoked_at IS NULL
        RETURNING id, name
      `;
      if (row === undefined) return false;
      await recordAudit(tx, { actor: { userId: owner.userId, email: owner.email }, action: "agent.revoke", entityType: "agent", entityId: row.id, changes: { revoked: { before: false, after: true } }, reason: row.name }, now);
      return true;
    });
  }

  /** Who the key speaks for: null for an unknown, ended or revoked key, or an account that is banned. */
  async function authenticate(key: string, now = new Date()): Promise<AgentIdentity | null> {
    const [row] = await sql<{
      id: string;
      scopes: string[];
      last_used_at: Date | null;
      user_id: string;
      name: string;
      email: string;
      email_verified: boolean;
      role: string;
      two_factor_enabled: boolean | null;
    }[]>`
      SELECT t.id, t.scopes, t.last_used_at, u.id AS user_id, u.name, u.email, u.email_verified, u.role, u.two_factor_enabled
      FROM agent_tokens t JOIN users u ON u.id = t.user_id
      WHERE t.token_hash = ${hashAgentKey(key)}
        AND t.revoked_at IS NULL
        AND t.expires_at > ${now.toISOString()}::timestamptz
        AND (u.banned IS NOT TRUE OR (u.ban_expires IS NOT NULL AND u.ban_expires <= ${now.toISOString()}::timestamptz))
      LIMIT 1
    `;
    if (row === undefined) return null;
    const lastUsed = row.last_used_at === null ? 0 : new Date(row.last_used_at).getTime();
    if (now.getTime() - lastUsed >= LAST_USED_EVERY_MS) {
      await sql`UPDATE agent_tokens SET last_used_at = ${now.toISOString()}::timestamptz WHERE id = ${row.id}`;
    }
    return {
      keyId: row.id,
      scopes: row.scopes as AgentScope[],
      user: { id: row.user_id, name: row.name, email: row.email, emailVerified: row.email_verified, roles: parseRoles(row.role), twoFactorEnabled: row.two_factor_enabled === true },
    };
  }

  return { create, list, revoke, authenticate };
}

export type AgentKeyStore = ReturnType<typeof createAgentKeyStore>;
