/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Local storage driver: files in a folder reached through signed URLs.
 */

import { mkdir, readFile, rename, stat, writeFile, unlink } from "node:fs/promises";
import path from "node:path";

import type { ServerEnv } from "@/env";
import { isValidKey, sign } from "@/lib/storage/signing";
import type { StorageDriver } from "@/lib/storage/types";

/**
 * The local storage driver: files in a folder, reached through signed URLs
 * served by `/api/storage/[...key]` (ADR-008).
 *
 * It mirrors the bucket's contract rather than taking a shortcut. Uploads and
 * reads need a signature that expires, and the content type is fixed when the
 * URL is issued, so nothing written against this driver will break when the
 * same code talks to S3.
 */

/** Uploads larger than this are refused, matching the bucket's limit. */
export const LOCAL_MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

export type LocalConfig = { root: string; secret: string; appUrl: string };

export function localConfig(env: ServerEnv): LocalConfig {
  if (env.LOCAL_STORAGE_SECRET === undefined) {
    throw new Error("The local storage driver was selected without LOCAL_STORAGE_SECRET.");
  }
  return {
    root: path.resolve(env.LOCAL_STORAGE_DIR),
    secret: env.LOCAL_STORAGE_SECRET,
    appUrl: env.APP_URL,
  };
}

/**
 * Resolves a key to a path and proves it stays inside the storage root.
 *
 * `isValidKey` already rules out traversal; this is the second, independent
 * check, done on the resolved path, so a mistake in one cannot become a read of
 * arbitrary files on the machine.
 */
export function resolveKeyPath(root: string, key: string): string {
  if (!isValidKey(key)) throw new Error("Invalid storage key.");
  const resolved = path.resolve(root, key);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error("Storage key resolves outside the storage root.");
  }
  return resolved;
}

function signedUrl(
  config: LocalConfig,
  action: { method: "GET"; key: string } | { method: "PUT"; key: string; contentType: string },
  expiresInSeconds: number,
): string {
  const expires = Math.floor(Date.now() / 1000) + expiresInSeconds;
  const signature = sign({ ...action, expires }, config.secret);
  const url = new URL(`/api/storage/${action.key}`, config.appUrl);
  url.searchParams.set("expires", String(expires));
  url.searchParams.set("sig", signature);
  if (action.method === "PUT") url.searchParams.set("ct", action.contentType);
  return url.toString();
}

export function createLocalDriver(env: ServerEnv): StorageDriver {
  const config = localConfig(env);

  return {
    kind: "local",
    presignedUploadUrl: async ({ key, contentType, expiresInSeconds = 300 }) => {
      resolveKeyPath(config.root, key);
      return signedUrl(config, { method: "PUT", key, contentType }, expiresInSeconds);
    },
    presignedDownloadUrl: async ({ key, expiresInSeconds = 300 }) => {
      resolveKeyPath(config.root, key);
      return signedUrl(config, { method: "GET", key }, expiresInSeconds);
    },
    putObject: ({ key, body, contentType }) => writeObject(config.root, key, body, contentType),
    getObject: async (key) => {
      const object = await readObject(config.root, key);
      return object === null ? null : { body: new Uint8Array(object.body), contentType: object.meta.contentType };
    },
    check: async () => {
      // Writable, not just present: a read-only folder would pass a stat and
      // then fail on the first upload.
      await mkdir(config.root, { recursive: true });
      const probe = path.join(config.root, `.health-${process.pid}`);
      await writeFile(probe, "ok");
      await unlink(probe);
      return { location: config.root };
    },
  };
}

/* -------------------------------------------------------------------------- */
/* File operations used by the local storage route                            */
/* -------------------------------------------------------------------------- */

type Meta = { contentType: string; size: number; uploadedAt: string };

/**
 * Writes atomically: to a temporary file, then renamed into place. A reader
 * never sees half an upload, and an interrupted upload leaves no corrupt file.
 */
export async function writeObject(root: string, key: string, body: Uint8Array, contentType: string): Promise<void> {
  const target = resolveKeyPath(root, key);
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${Date.now()}.partial`;
  await writeFile(temporary, body);
  await rename(temporary, target);
  const meta: Meta = { contentType, size: body.byteLength, uploadedAt: new Date().toISOString() };
  await writeFile(`${target}.meta.json`, JSON.stringify(meta));
}

export async function readObject(root: string, key: string): Promise<{ body: Buffer; meta: Meta } | null> {
  const target = resolveKeyPath(root, key);
  try {
    await stat(target);
  } catch {
    return null;
  }
  const [body, metaText] = await Promise.all([readFile(target), readFile(`${target}.meta.json`, "utf8")]);
  return { body, meta: JSON.parse(metaText) as Meta };
}
