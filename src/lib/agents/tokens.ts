/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Agent keys: what one looks like, what it may do, how long it lives, and how it is stored.
 */

import { createHash, randomBytes } from "node:crypto";

import { z } from "zod";

/**
 * docs/adr/043. A shopper's own AI assistant reaches their cart and orders
 * through /api/mcp with a key they made at /account/agents. The key is 32
 * random bytes (256 bits) behind a recognisable prefix, so secret scanners and
 * people can tell what it is. With that much randomness a plain SHA-256 is the
 * right way to store it — a slow password hash protects guessable secrets,
 * and this one cannot be guessed — and it lets the key be found by an index.
 */

export const AGENT_KEY_PREFIX = "vta_";
/** What a key may do beyond looking at the catalogue, which needs no key. */
export const AGENT_SCOPES = ["cart", "orders"] as const;
export type AgentScope = (typeof AGENT_SCOPES)[number];
/** How long a key lives, in days: the shopper picks one. */
export const AGENT_KEY_DAYS = [1, 7, 30, 90] as const;
/** Active keys per person: enough for a few assistants, not a pile of forgotten ones. */
export const MAX_ACTIVE_KEYS = 5;

export const createKeySchema = z.object({
  name: z.string().trim().min(1).max(60),
  scopes: z.array(z.enum(AGENT_SCOPES)).min(1).max(10).transform((scopes) => [...new Set(scopes)].sort()),
  days: z.coerce.number().int().refine((days) => (AGENT_KEY_DAYS as readonly number[]).includes(days), "One of 1, 7, 30 or 90 days"),
});
export type CreateKeyInput = z.infer<typeof createKeySchema>;

export function newAgentKey(): { key: string; hash: string; hint: string } {
  const key = `${AGENT_KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
  return { key, hash: hashAgentKey(key), hint: key.slice(-4) };
}

export function hashAgentKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

/** The key in an `Authorization: Bearer …` header, if it looks like one of ours; anything else is not a key. */
export function bearerKey(authorization: string | null): string | null {
  if (authorization === null) return null;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(authorization);
  if (match === null) return null;
  const key = match[1]!;
  return key.startsWith(AGENT_KEY_PREFIX) && /^[A-Za-z0-9_-]{40,60}$/.test(key.slice(AGENT_KEY_PREFIX.length)) ? key : null;
}

export function expiresAfter(days: number, from: Date): Date {
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
}

export type AgentKeyState = "active" | "expired" | "revoked";

export function keyState(key: { expiresAt: Date; revokedAt: Date | null }, now: Date): AgentKeyState {
  if (key.revokedAt !== null) return "revoked";
  return key.expiresAt.getTime() <= now.getTime() ? "expired" : "active";
}
