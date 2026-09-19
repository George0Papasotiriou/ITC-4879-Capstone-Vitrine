/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Staff catalogue edits: a product's details, or one variant's stock, each audited.
 */

import { z } from "zod";

import { fieldErrors, productDetailsSchema, stockChangeSchema } from "@/lib/admin/catalog";
import { catalogAdmin } from "@/lib/admin/server";
import { authorize } from "@/lib/auth/session";
import { logger } from "@/lib/log";

/**
 * For "catalog:edit" (merchandiser, admin). A refused field comes back as a
 * 422 with a message key per field, which the form shows beside the field.
 * The edit and its audit entry are one transaction (docs/adr/018).
 */

export const runtime = "nodejs";

const bodySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("details"), details: z.record(z.string(), z.unknown()) }),
  z.object({ kind: z.literal("stock"), variantId: z.unknown(), stock: z.unknown(), reason: z.unknown() }),
]);

export async function POST(request: Request, { params }: RouteContext<"/api/staff/products/[id]">): Promise<Response> {
  const access = await authorize("catalog:edit");
  if (!access.ok) return Response.json({ ok: false, reason: access.status === 401 ? "sign_in" : "forbidden" }, { status: access.status });

  const { id } = await params;
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!z.uuid().safeParse(id).success || !body.success) return Response.json({ ok: false, reason: "invalid_request" }, { status: 400 });

  const store = await catalogAdmin();
  const actor = { userId: access.user.id, email: access.user.email };

  if (body.data.kind === "details") {
    const details = productDetailsSchema.safeParse(body.data.details);
    if (!details.success) return Response.json({ ok: false, reason: "invalid_fields", fields: fieldErrors(details.error) }, { status: 422 });
    const result = await store.updateProduct(id, details.data, actor);
    if (!result.ok) return Response.json({ ok: false, reason: result.reason }, { status: 404 });
    if (result.changed.length > 0) logger.info({ product: id, fields: result.changed, staff: actor.userId }, "Product edited");
    return Response.json({ ok: true, changed: result.changed });
  }

  const change = stockChangeSchema.safeParse({ variantId: body.data.variantId, stock: body.data.stock, reason: body.data.reason });
  if (!change.success) return Response.json({ ok: false, reason: "invalid_fields", fields: fieldErrors(change.error) }, { status: 422 });
  const result = await store.setStock(id, change.data.variantId, change.data.stock, change.data.reason, actor);
  if (!result.ok) return Response.json({ ok: false, reason: result.reason }, { status: 404 });
  if (result.changed) logger.info({ product: id, variant: change.data.variantId, staff: actor.userId }, "Stock set");
  return Response.json({ ok: true, changed: result.changed, stock: change.data.stock });
}
