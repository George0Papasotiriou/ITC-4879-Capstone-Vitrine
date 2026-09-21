/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The rules for a photograph a shopper gives the shop: what is accepted, where it is kept, and when it goes.
 */

/**
 * Photographs (docs/adr/023, docs/PLAN.md 2.9).
 *
 * A shopper's photograph is the most personal thing this shop ever holds, so
 * the rules are few and strict, and they live here rather than in a route:
 *
 * - it is accepted only for a purpose the shopper agreed to, one at a time;
 * - only real photograph formats, and only up to a size a phone produces;
 * - it is re-encoded on arrival, which strips the camera's metadata — where
 *   and when it was taken, and on what;
 * - it is kept for a day and then deleted by a job, and the shopper can
 *   delete it sooner;
 * - it never appears in a log, and never goes to a free-tier API.
 */

export const PHOTO_KINDS = ["try_on", "snap", "room"] as const;
export type PhotoKind = (typeof PHOTO_KINDS)[number];

/** What a phone produces, and nothing else: no SVG, no PDF, no video. */
export const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"] as const;

/** 12 MB: a modern phone's photograph, with room to spare. */
export const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;

/** Smaller than this is not a photograph of a person or a room. */
export const MIN_EDGE_PX = 240;

/** The longest edge kept after re-encoding: enough for try-on, small enough to move. */
export const STORED_EDGE_PX = 1280;

/** How long a photograph is kept, unless the shopper deletes it sooner. */
export const PHOTO_TTL_HOURS = 24;

/** How many photographs one shopper may have at a time, so nobody fills the bucket. */
export const MAX_PHOTOS_PER_ACTOR = 5;

export type PhotoRefusal = "kind" | "type" | "too_large" | "too_small" | "no_consent" | "too_many";

export type PhotoCheck = { ok: true } | { ok: false; reason: PhotoRefusal };

export function isPhotoKind(value: unknown): value is PhotoKind {
  return typeof value === "string" && (PHOTO_KINDS as readonly string[]).includes(value);
}

/** What the browser says before it uploads: the purpose, the type, the size, and the shopper's consent. */
export function checkUpload(input: { kind: string; contentType: string; bytes: number; consent: boolean; held: number }): PhotoCheck {
  if (!isPhotoKind(input.kind)) return { ok: false, reason: "kind" };
  if (!input.consent) return { ok: false, reason: "no_consent" };
  if (!(ACCEPTED_TYPES as readonly string[]).includes(input.contentType)) return { ok: false, reason: "type" };
  if (input.bytes > MAX_UPLOAD_BYTES) return { ok: false, reason: "too_large" };
  if (input.bytes <= 0) return { ok: false, reason: "too_small" };
  if (input.held >= MAX_PHOTOS_PER_ACTOR) return { ok: false, reason: "too_many" };
  return { ok: true };
}

/** What the server finds when it opens the file: it must be a photograph, of a usable size. */
export function checkDecoded(input: { format: string | undefined; width: number | undefined; height: number | undefined }): PhotoCheck {
  const format = input.format === undefined ? "" : `image/${input.format === "jpg" ? "jpeg" : input.format}`;
  if (!(ACCEPTED_TYPES as readonly string[]).includes(format)) return { ok: false, reason: "type" };
  if ((input.width ?? 0) < MIN_EDGE_PX || (input.height ?? 0) < MIN_EDGE_PX) return { ok: false, reason: "too_small" };
  return { ok: true };
}

export const photoExpiry = (from: Date, hours = PHOTO_TTL_HOURS) => new Date(from.getTime() + hours * 60 * 60 * 1000);

/**
 * Where a photograph lives in storage. The id is enough: nothing in the key
 * says who gave it or what is in it, so a key in a log or a bucket listing
 * tells nobody anything.
 */
export const photoKey = (id: string) => `photos/${id}.webp`;

/** Where the result of a try-on lives. It expires with the photograph it was made from. */
export const tryOnKey = (id: string) => `photos/try-on/${id}.webp`;

/** Minutes left before a photograph goes, for the interface to say so. */
export function minutesLeft(expiresAt: Date, now = new Date()): number {
  return Math.max(0, Math.round((expiresAt.getTime() - now.getTime()) / 60_000));
}
