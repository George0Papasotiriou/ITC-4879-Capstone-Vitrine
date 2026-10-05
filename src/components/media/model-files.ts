/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Model files the browser runs on the shopper's device: downloaded once with progress, kept in Cache Storage, checked by their hash.
 */

/**
 * A file from the model folder, from Cache Storage when it has been fetched
 * before, otherwise downloaded with its progress reported and then kept. The
 * cache name carries the model's hash, so a new conversion is a new cache and
 * the old one is cleared.
 */
export async function cachedBytes(url: string, cacheName: string, onChunk: (bytes: number) => void): Promise<ArrayBuffer> {
  const cache = typeof caches === "undefined" ? null : await caches.open(cacheName).catch(() => null);
  const hit = await cache?.match(url);
  if (hit !== undefined) {
    const buffer = await hit.arrayBuffer();
    onChunk(buffer.byteLength);
    return buffer;
  }
  const response = await fetch(url);
  if (!response.ok || response.body === null) throw new Error(`${url}: ${response.status}`);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    onChunk(value.byteLength);
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  await cache?.put(url, new Response(bytes, { headers: { "content-type": response.headers.get("content-type") ?? "application/octet-stream" } })).catch(() => {});
  return bytes.buffer;
}

/** The SHA-256 of a file's bytes, as hex, to compare with the hash its manifest promises. */
export async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
