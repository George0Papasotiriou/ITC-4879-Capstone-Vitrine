/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Cryptographic helpers: signed cookies, hashed order link tokens and order numbers.
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Small cryptographic helpers for guest commerce (Phase 5).
 *
 * - A cart cookie holds the cart id and an HMAC of it, so a shopper cannot
 *   guess or swap in someone else's cart id.
 * - A guest's order link carries a random secret; only its SHA-256 is stored,
 *   so a database leak does not reveal working links.
 * - Order numbers are short and readable for emails and support, and random,
 *   so they do not reveal how many orders the shop has taken.
 */

const hmac = (value: string, secret: string) => createHmac("sha256", secret).update(value).digest("base64url");

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function signValue(value: string, secret: string): string {
  if (value.includes(".")) throw new RangeError("Signed values must not contain a dot");
  return `${value}.${hmac(value, secret)}`;
}

/** The value, or null when the signature does not match (constant-time comparison). */
export function verifySignedValue(signed: string | undefined, secret: string): string | null {
  if (signed === undefined) return null;
  const dot = signed.lastIndexOf(".");
  if (dot <= 0) return null;
  const value = signed.slice(0, dot);
  return safeEqual(signed.slice(dot + 1), hmac(value, secret)) ? value : null;
}

/** 192 random bits, URL-safe. */
export function newAccessToken(): string {
  return randomBytes(24).toString("base64url");
}

/**
 * The token in an order's private link, derived from the order id and a
 * server secret (HMAC-SHA256, 256 bits, URL-safe) instead of drawn at random.
 * Just as unguessable without the secret, and it means an email written days
 * later ("your order has shipped") can include the guest's link without the
 * shop ever storing it: only its hash is kept, as before (docs/adr/016).
 * Rotating the secret retires every guest link, as it already empties carts.
 */
export function orderLinkToken(orderId: string, secret: string): string {
  return hmac(`order-link:${orderId}`, secret);
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function tokenMatches(token: string, storedHash: string): boolean {
  return safeEqual(hashToken(token), storedHash);
}

/** Crockford's base 32: no I, L, O or U, so a number read aloud or copied by hand survives. */
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** VT-XXXX-XXXX: 40 random bits, about a trillion possibilities; uniqueness is still enforced by the database. */
export function newOrderNumber(random: (size: number) => Uint8Array = (size) => randomBytes(size)): string {
  const bytes = random(5);
  let bits = 0n;
  for (const byte of bytes) bits = (bits << 8n) | BigInt(byte);
  let text = "";
  for (let i = 0; i < 8; i += 1) {
    text = CROCKFORD[Number(bits & 31n)]! + text;
    bits >>= 5n;
  }
  return `VT-${text.slice(0, 4)}-${text.slice(4)}`;
}
