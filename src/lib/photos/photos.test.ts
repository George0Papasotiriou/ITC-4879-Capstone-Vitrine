/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Tests for the photograph rules: what is accepted, what is refused, and when a photograph goes.
 */

import { describe, expect, it } from "vitest";

import { checkDecoded, checkUpload, MAX_PHOTOS_PER_ACTOR, MAX_UPLOAD_BYTES, minutesLeft, photoExpiry, photoKey, PHOTO_TTL_HOURS, tryOnKey } from "@/lib/photos/photos";

const ask = (overrides: Partial<Parameters<typeof checkUpload>[0]> = {}) =>
  checkUpload({ kind: "try_on", contentType: "image/jpeg", bytes: 2 * 1024 * 1024, consent: true, held: 0, ...overrides });

describe("what the shop accepts", () => {
  it("takes a photograph for a purpose the shopper agreed to", () => {
    expect(ask()).toEqual({ ok: true });
  });

  it("refuses without consent, whatever else is right", () => {
    expect(ask({ consent: false })).toEqual({ ok: false, reason: "no_consent" });
  });

  it("refuses anything that is not a photograph", () => {
    expect(ask({ contentType: "image/svg+xml" })).toEqual({ ok: false, reason: "type" });
    expect(ask({ contentType: "application/pdf" })).toEqual({ ok: false, reason: "type" });
    expect(ask({ contentType: "video/mp4" })).toEqual({ ok: false, reason: "type" });
  });

  it("refuses a purpose it does not have", () => {
    expect(ask({ kind: "passport" })).toEqual({ ok: false, reason: "kind" });
  });

  it("refuses a file too big to be a photograph, and an empty one", () => {
    expect(ask({ bytes: MAX_UPLOAD_BYTES + 1 })).toEqual({ ok: false, reason: "too_large" });
    expect(ask({ bytes: 0 })).toEqual({ ok: false, reason: "too_small" });
  });

  it("stops a shopper filling the shop's storage", () => {
    expect(ask({ held: MAX_PHOTOS_PER_ACTOR })).toEqual({ ok: false, reason: "too_many" });
    expect(ask({ held: MAX_PHOTOS_PER_ACTOR - 1 })).toEqual({ ok: true });
  });
});

describe("what the server finds when it opens the file", () => {
  it("accepts a real photograph of a usable size", () => {
    expect(checkDecoded({ format: "jpeg", width: 1200, height: 1600 })).toEqual({ ok: true });
    expect(checkDecoded({ format: "jpg", width: 1200, height: 1600 })).toEqual({ ok: true });
  });

  it("refuses a file that only claimed to be a photograph", () => {
    expect(checkDecoded({ format: "svg", width: 1200, height: 1600 })).toEqual({ ok: false, reason: "type" });
    expect(checkDecoded({ format: undefined, width: 1200, height: 1600 })).toEqual({ ok: false, reason: "type" });
  });

  it("refuses something too small to be a person or a room", () => {
    expect(checkDecoded({ format: "jpeg", width: 100, height: 100 })).toEqual({ ok: false, reason: "too_small" });
  });
});

describe("when a photograph goes", () => {
  it("is a day after it arrived", () => {
    const arrived = new Date("2026-09-21T10:00:00Z");
    expect(photoExpiry(arrived).toISOString()).toBe("2026-09-22T10:00:00.000Z");
    expect(PHOTO_TTL_HOURS).toBe(24);
  });

  it("counts down in minutes, and never below zero", () => {
    const now = new Date("2026-09-21T10:00:00Z");
    expect(minutesLeft(new Date("2026-09-21T11:30:00Z"), now)).toBe(90);
    expect(minutesLeft(new Date("2026-09-21T09:00:00Z"), now)).toBe(0);
  });
});

describe("where a photograph is kept", () => {
  it("is named by its id and nothing else", () => {
    expect(photoKey("01a0-abc")).toBe("photos/01a0-abc.webp");
    expect(tryOnKey("01a0-abc")).toBe("photos/try-on/01a0-abc.webp");
  });
});
