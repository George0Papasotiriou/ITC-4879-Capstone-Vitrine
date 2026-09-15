/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Serves public catalogue images from storage with long-lived caching.
 */

import { loggerForRequest } from "@/lib/log";
import { storage } from "@/lib/storage";
import { isValidKey } from "@/lib/storage/signing";

/**
 * Public catalogue media: product photography imported into storage.
 *
 * Only keys under `catalog/` are served, and only by GET. Catalogue images are
 * public by nature (they are on every product page) and never change under the
 * same key — the importer names each file by a hash of its source — so they are
 * cached for a year as immutable. Anything else in storage, such as a room photo
 * a shopper uploaded, stays reachable only through a short-lived signed URL.
 *
 * `next/image` requests these paths and caches its resized output, so the
 * bytes pass through the application once per size, not once per visitor.
 */

export const runtime = "nodejs";

const PUBLIC_PREFIX = "catalog/";
const PUBLIC_TYPES = new Set(["image/webp", "image/jpeg", "image/png", "image/avif", "model/gltf-binary"]);

type Context = { params: Promise<{ key: string[] }> };

export async function GET(request: Request, context: Context): Promise<Response> {
  const key = (await context.params).key.join("/");
  if (!key.startsWith(PUBLIC_PREFIX) || !isValidKey(key)) {
    return new Response("Not found", { status: 404 });
  }

  const object = await (await storage()).getObject(key);
  if (object === null || !PUBLIC_TYPES.has(object.contentType)) {
    loggerForRequest(request.headers).debug({ key }, "catalogue media not found");
    return new Response("Not found", { status: 404 });
  }

  return new Response(new Uint8Array(object.body), {
    status: 200,
    headers: {
      "content-type": object.contentType,
      "content-length": String(object.body.byteLength),
      "cache-control": "public, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
    },
  });
}
