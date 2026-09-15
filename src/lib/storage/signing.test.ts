/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Unit tests for storage keys and signed URL verification.
 */

import { describe, expect, it } from "vitest";

import { isValidKey, sign, verify, type SignedAction } from "@/lib/storage/signing";

const SECRET = "s".repeat(32);
const NOW = 1_800_000_000;

describe("object keys", () => {
  it("accepts ordinary keys", () => {
    for (const key of ["uploads/person/0192f3a1.webp", "rooms/r1/photo.jpg", "a"]) {
      expect(isValidKey(key), key).toBe(true);
    }
  });

  it("rejects every path-traversal shape", () => {
    for (const key of [
      "../.env",
      "uploads/../../.env",
      "uploads/./x",
      "/etc/passwd",
      "uploads\\..\\secret",
      "uploads//double",
      "trailing/",
      ".hidden",
      "C:/Windows/win.ini",
      "UPPER/case",
      "space in key",
      "",
    ]) {
      expect(isValidKey(key), key).toBe(false);
    }
  });
});

describe("signatures", () => {
  const put: SignedAction = { method: "PUT", key: "uploads/a.webp", expires: NOW + 300, contentType: "image/webp" };

  it("verifies a signature it produced", () => {
    expect(verify(put, sign(put, SECRET), SECRET, NOW)).toEqual({ ok: true });
  });

  it("rejects an expired URL", () => {
    const expired = { ...put, expires: NOW - 1 };
    expect(verify(expired, sign(expired, SECRET), SECRET, NOW)).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects a URL whose expiry was pushed out after signing", () => {
    const signature = sign(put, SECRET);
    expect(verify({ ...put, expires: NOW + 86_400 }, signature, SECRET, NOW)).toEqual({
      ok: false,
      reason: "bad-signature",
    });
  });

  it("binds the signature to the key, so it cannot be replayed for another object", () => {
    const signature = sign(put, SECRET);
    expect(verify({ ...put, key: "uploads/b.webp" }, signature, SECRET, NOW).ok).toBe(false);
  });

  it("binds the upload's content type, so an image URL cannot receive HTML", () => {
    const signature = sign(put, SECRET);
    expect(verify({ ...put, contentType: "text/html" }, signature, SECRET, NOW).ok).toBe(false);
  });

  it("does not let a read signature authorise an upload", () => {
    const get: SignedAction = { method: "GET", key: put.key, expires: put.expires };
    expect(verify(put, sign(get, SECRET), SECRET, NOW).ok).toBe(false);
  });

  it("rejects a signature made with another secret", () => {
    expect(verify(put, sign(put, "o".repeat(32)), SECRET, NOW).ok).toBe(false);
  });

  it("rejects an invalid key before checking anything else", () => {
    const traversal = { ...put, key: "../secret" };
    expect(verify(traversal, sign(traversal, SECRET), SECRET, NOW)).toEqual({ ok: false, reason: "invalid-key" });
  });
});
