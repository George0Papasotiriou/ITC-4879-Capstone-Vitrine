/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Storage driver interface shared by the local and S3 drivers.
 */

/**
 * The storage contract both drivers implement (ADR-008).
 *
 * Deliberately small: callers get signed URLs and never a file handle, so the
 * same code works whether the bytes end up in a bucket or in a local folder.
 */
export interface StorageDriver {
  readonly kind: "s3" | "local";
  /** A URL the browser can PUT one object to, until it expires. */
  presignedUploadUrl(params: { key: string; contentType: string; expiresInSeconds?: number }): Promise<string>;
  /** A short-lived URL to read one object. */
  presignedDownloadUrl(params: { key: string; expiresInSeconds?: number }): Promise<string>;
  /**
   * Server-side write, for files the application produces itself (imported
   * catalogue photography, resized images). User uploads never come through
   * here; they go straight to storage with a presigned URL.
   */
  putObject(params: { key: string; body: Uint8Array; contentType: string }): Promise<void>;
  /** Server-side read of one object, or null when it does not exist. */
  getObject(key: string): Promise<{ body: Uint8Array; contentType: string } | null>;
  /** Health probe: resolves if storage is reachable and writable. */
  check(): Promise<{ location: string }>;
}
