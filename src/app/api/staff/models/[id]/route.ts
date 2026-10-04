/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Staff: hide an AI 3D model from shoppers, or show it again.
 */

import { z } from "zod";

import { authorize } from "@/lib/auth/session";
import { createAiModelStore } from "@/lib/catalog/model/ai-store";
import { sql } from "@/lib/db/client";
import { logger } from "@/lib/log";

/** For "catalog:edit" (merchandiser, admin), audited (docs/adr/059). */

export const runtime = "nodejs";

const bodySchema = z.object({ shown: z.boolean() });

export async function POST(request: Request, { params }: RouteContext<"/api/staff/models/[id]">): Promise<Response> {
  const access = await authorize("catalog:edit");
  if (!access.ok) return Response.json({ ok: false, reason: access.status === 401 ? "sign_in" : "forbidden" }, { status: access.status });
  const { id } = await params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!z.uuid().safeParse(id).success || !parsed.success) return Response.json({ ok: false, reason: "invalid_request" }, { status: 400 });
  const result = await createAiModelStore(sql).setShown(id, parsed.data.shown, { userId: access.user.id, email: access.user.email });
  if (!result.ok) return Response.json({ ok: false, reason: result.reason }, { status: result.reason === "not_found" ? 404 : 409 });
  logger.info({ model: id, shown: parsed.data.shown, staff: access.user.id }, "AI model moderated");
  return Response.json({ ok: true });
}
