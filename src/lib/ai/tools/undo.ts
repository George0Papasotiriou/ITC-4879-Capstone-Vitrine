/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Undo for the Concierge's cart changes: a signed note of what a line was before, which only that cart can redeem.
 */

import { z } from "zod";

import { signValue, verifySignedValue } from "@/lib/commerce/tokens";

/**
 * Cart changes by the Concierge run at once and are always undoable (docs/PLAN.md
 * 2.5). The tool returns a token saying "this cart's line for this variant was
 * N before"; the timeline's Undo sends it back. It is signed with the server
 * secret, names the cart it belongs to, and expires after an hour, so a token
 * cannot be forged, replayed on another cart, or kept forever.
 */

export const UNDO_LIFETIME_MS = 60 * 60 * 1000;

const payloadSchema = z.object({ c: z.uuid(), v: z.uuid(), q: z.number().int().min(0).max(99), e: z.number().int() });
export type UndoPayload = { cartId: string; variantId: string; quantity: number };

export function createUndoToken({ cartId, variantId, quantity }: UndoPayload, secret: string, now = Date.now()): string {
  const json = JSON.stringify({ c: cartId, v: variantId, q: quantity, e: now + UNDO_LIFETIME_MS });
  return signValue(Buffer.from(json).toString("base64url"), secret);
}

/** The payload, or null for a forged, damaged or expired token. */
export function readUndoToken(token: string, secret: string, now = Date.now()): UndoPayload | null {
  const value = verifySignedValue(token, secret);
  if (value === null) return null;
  try {
    const parsed = payloadSchema.safeParse(JSON.parse(Buffer.from(value, "base64url").toString("utf8")));
    if (!parsed.success || parsed.data.e < now) return null;
    return { cartId: parsed.data.c, variantId: parsed.data.v, quantity: parsed.data.q };
  } catch {
    return null;
  }
}
