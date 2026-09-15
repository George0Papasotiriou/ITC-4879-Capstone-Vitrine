/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Serves signed upload and download URLs for the local storage driver.
 */

import { serverEnv } from "@/env";
import { loggerForRequest } from "@/lib/log";
import { LOCAL_MAX_UPLOAD_BYTES, localConfig, readObject, writeObject } from "@/lib/storage/local";
import { verify } from "@/lib/storage/signing";

/**
 * Serves the local storage driver's signed URLs (ADR-008).
 *
 * This route exists only for the local stack. With the s3 driver it answers
 * 404, so a production deployment has no second, weaker path to its files.
 *
 * Every rejection is a plain 403 with no reason in the body: telling a caller
 * whether a key exists, or whether its signature was merely expired, helps an
 * attacker map the store. The reason goes to the log instead.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ key: string[] }> };

function notFound(): Response {
  return new Response("Not found", { status: 404 });
}

function forbidden(): Response {
  return new Response("Forbidden", { status: 403 });
}

async function keyFrom(context: Context): Promise<string> {
  const { key } = await context.params;
  return key.join("/");
}

export async function GET(request: Request, context: Context): Promise<Response> {
  const env = serverEnv();
  if (env.storageDriver !== "local") return notFound();

  const log = loggerForRequest(request.headers);
  const config = localConfig(env);
  const key = await keyFrom(context);
  const url = new URL(request.url);

  const verdict = verify(
    { method: "GET", key, expires: Number(url.searchParams.get("expires")) },
    url.searchParams.get("sig") ?? "",
    config.secret,
  );
  if (!verdict.ok) {
    log.warn({ key, reason: verdict.reason }, "storage read refused");
    return forbidden();
  }

  const object = await readObject(config.root, key);
  if (object === null) return notFound();

  return new Response(new Uint8Array(object.body), {
    status: 200,
    headers: {
      "content-type": object.meta.contentType,
      "content-length": String(object.meta.size),
      // Private objects (user photos) must not be cached by anything in between.
      "cache-control": "private, no-store",
      // Never let a stored file be interpreted as something other than its type.
      "x-content-type-options": "nosniff",
    },
  });
}

export async function PUT(request: Request, context: Context): Promise<Response> {
  const env = serverEnv();
  if (env.storageDriver !== "local") return notFound();

  const log = loggerForRequest(request.headers);
  const config = localConfig(env);
  const key = await keyFrom(context);
  const url = new URL(request.url);
  const contentType = url.searchParams.get("ct") ?? "";

  const verdict = verify(
    { method: "PUT", key, expires: Number(url.searchParams.get("expires")), contentType },
    url.searchParams.get("sig") ?? "",
    config.secret,
  );
  if (!verdict.ok) {
    log.warn({ key, reason: verdict.reason }, "storage upload refused");
    return forbidden();
  }

  // The signed content type must be the one actually sent.
  if (request.headers.get("content-type") !== contentType) {
    log.warn({ key }, "storage upload refused: content type differs from the signed one");
    return forbidden();
  }

  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > LOCAL_MAX_UPLOAD_BYTES) {
    return new Response("Payload too large", { status: 413 });
  }

  const body = new Uint8Array(await request.arrayBuffer());
  // Checked again on the bytes received: Content-Length is only a claim.
  if (body.byteLength > LOCAL_MAX_UPLOAD_BYTES) {
    return new Response("Payload too large", { status: 413 });
  }

  await writeObject(config.root, key, body, contentType);
  log.info({ key, size: body.byteLength }, "storage object written");
  return new Response(null, { status: 204 });
}
