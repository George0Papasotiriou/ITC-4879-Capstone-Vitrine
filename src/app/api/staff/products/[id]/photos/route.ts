/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Staff add a photograph to a product: checked, re-encoded like imported photography, stored, audited.
 */

import { uuidv7 } from "uuidv7";
import { z } from "zod";

import { checkDecodedProductPhoto, checkProductPhoto, type ProductPhotoProblem } from "@/lib/admin/catalog";
import { catalogAdmin } from "@/lib/admin/server";
import { authorize } from "@/lib/auth/session";
import { catalogImageKey, hasWhiteGround, webMaster } from "@/lib/catalog/photography";
import { logger } from "@/lib/log";
import { storage } from "@/lib/storage";

/**
 * For "catalog:edit" (docs/adr/034). A product photograph is the shop's own
 * picture of its own stock, not a shopper's photograph, so it is kept like the
 * imported catalogue's: re-encoded to a WebP master of at most 1100 px on a
 * white ground (which also drops the camera's metadata), served at
 * /media/<key> for as long as the product exists, and checked for a studio
 * ground so the plinth blends it like the rest.
 */

export const runtime = "nodejs";

export type ProductPhotoResponse =
  | { ok: true; id: string; src: string; whiteGround: boolean }
  | { ok: false; reason: ProductPhotoProblem | "unreadable" | "not_found" | "too_many" | "invalid_request" | "sign_in" | "forbidden" };

const refuse = (reason: Extract<ProductPhotoResponse, { ok: false }>["reason"], status: number) => Response.json({ ok: false, reason } satisfies ProductPhotoResponse, { status });

export async function POST(request: Request, { params }: RouteContext<"/api/staff/products/[id]/photos">): Promise<Response> {
  const access = await authorize("catalog:edit");
  if (!access.ok) return refuse(access.status === 401 ? "sign_in" : "forbidden", access.status);

  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return refuse("invalid_request", 400);
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (form === null || !(file instanceof File)) return refuse("invalid_request", 400);

  // Refused before the file is in memory, when the browser's own description already says no.
  const early = checkProductPhoto({ contentType: file.type, bytes: file.size });
  if (early !== null) return refuse(early, early === "too_large" ? 413 : 400);

  const { default: sharp } = await import("sharp");
  const bytes = Buffer.from(await file.arrayBuffer());
  let master: Awaited<ReturnType<typeof webMaster>>;
  let whiteGround: boolean;
  try {
    const meta = await sharp(bytes, { failOn: "error" }).metadata();
    const problem = checkDecodedProductPhoto({ format: meta.format, width: meta.width, height: meta.height });
    if (problem !== null) return refuse(problem, 400);
    master = await webMaster(bytes);
    whiteGround = await hasWhiteGround(master.body);
  } catch {
    return refuse("unreadable", 400);
  }

  const key = catalogImageKey("staff", id, uuidv7());
  const files = await storage();
  await files.putObject({ key, body: new Uint8Array(master.body), contentType: master.contentType });
  const src = `/media/${key}`;
  const result = await (await catalogAdmin()).addPhoto(id, { src, width: master.width, height: master.height, bytes: master.body.byteLength, whiteGround }, { userId: access.user.id, email: access.user.email });
  if (!result.ok) {
    // Nothing points at the file, so it goes.
    await files.deleteObject(key).catch(() => undefined);
    return refuse(result.reason, result.reason === "not_found" ? 404 : 409);
  }
  logger.info({ product: id, media: result.id, bytes: master.body.byteLength, staff: access.user.id }, "Product photograph added");
  return Response.json({ ok: true, id: result.id, src, whiteGround } satisfies ProductPhotoResponse, { status: 201 });
}
