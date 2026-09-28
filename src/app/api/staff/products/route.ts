/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Staff make a new product: a draft with its words, kind, price and stock, audited.
 */

import { z } from "zod";

import { fieldErrors, newProductSchema } from "@/lib/admin/catalog";
import { catalogAdmin } from "@/lib/admin/server";
import { authorize } from "@/lib/auth/session";
import { logger } from "@/lib/log";

/**
 * For "catalog:edit" (docs/adr/034). A refused field comes back as a 422 with
 * a message key per field, like the edit form. The product starts as a draft
 * that nobody outside the staff can see; photographs and publishing follow on
 * its edit page.
 */

export const runtime = "nodejs";

const bodySchema = z.object({ details: z.record(z.string(), z.unknown()) });

export async function POST(request: Request): Promise<Response> {
  const access = await authorize("catalog:edit");
  if (!access.ok) return Response.json({ ok: false, reason: access.status === 401 ? "sign_in" : "forbidden" }, { status: access.status });

  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ ok: false, reason: "invalid_request" }, { status: 400 });

  const input = newProductSchema.safeParse(body.data.details);
  if (!input.success) return Response.json({ ok: false, reason: "invalid_fields", fields: fieldErrors(input.error) }, { status: 422 });

  const result = await (await catalogAdmin()).createProduct(input.data, { userId: access.user.id, email: access.user.email });
  if (!result.ok) return Response.json({ ok: false, reason: result.reason }, { status: 409 });
  logger.info({ product: result.id, staff: access.user.id }, "Product created");
  return Response.json({ ok: true, id: result.id, slug: result.slug }, { status: 201 });
}
