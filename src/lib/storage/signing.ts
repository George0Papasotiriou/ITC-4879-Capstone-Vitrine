/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * HMAC signing and verification of local storage URLs.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signed storage URLs for the local driver (ADR-008).
 *
 * The production bucket is only ever reached through presigned URLs: the server
 * decides who may upload or read which object, for how long, and signs that
 * decision into the URL. The local stand-in keeps the same contract, so code
 * written against it cannot quietly depend on files being publicly readable —
 * the one assumption that would break the day it moves to S3.
 *
 * A signature covers the method, the key, the expiry and (for uploads) the
 * content type. Changing any of them invalidates it.
 */

/**
 * Object keys are paths, and on the local driver they become paths on disk. So
 * they are restricted to a conservative alphabet with no `..` segments, no
 * leading slash and no backslashes: a key like `../../.env` or
 * `uploads\..\secret` must be impossible to express, not merely rejected later.
 */
const KEY_SHAPE = /^[a-z0-9][a-z0-9/_.-]{0,254}$/;

export function isValidKey(key: string): boolean {
  if (!KEY_SHAPE.test(key)) return false;
  const segments = key.split("/");
  return segments.every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

export type SignedAction =
  | { method: "GET"; key: string; expires: number }
  | { method: "PUT"; key: string; expires: number; contentType: string };

function canonical(action: SignedAction): string {
  return [
    action.method,
    action.key,
    String(action.expires),
    action.method === "PUT" ? action.contentType : "",
  ].join("\n");
}

export function sign(action: SignedAction, secret: string): string {
  return createHmac("sha256", secret).update(canonical(action)).digest("base64url");
}

export type Verdict =
  | { ok: true }
  | { ok: false; reason: "invalid-key" | "expired" | "bad-signature" };

/**
 * Checks a signature. The comparison is constant-time: a byte-by-byte early
 * exit would let an attacker recover a valid signature one character at a time
 * by measuring how long each rejection takes.
 */
export function verify(
  action: SignedAction,
  signature: string,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Verdict {
  if (!isValidKey(action.key)) return { ok: false, reason: "invalid-key" };
  if (!Number.isInteger(action.expires) || action.expires < nowSeconds) {
    return { ok: false, reason: "expired" };
  }

  const expected = Buffer.from(sign(action, secret));
  const provided = Buffer.from(signature);
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
    return { ok: false, reason: "bad-signature" };
  }
  return { ok: true };
}
