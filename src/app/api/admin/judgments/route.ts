/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Evaluation E1: a staff member grades how well a product answers a query.
 */

import { z } from "zod";

import { authorize } from "@/lib/auth/session";
import { sql } from "@/lib/db/client";
import { createJudgmentStore } from "@/lib/search/judgments-store";

/** docs/adr/036. For "reports:read": the people who read the dashboards judge the search. */

export const runtime = "nodejs";

const bodySchema = z.object({
  query: z.string().trim().min(1).max(200),
  locale: z.enum(["en", "el"]),
  productId: z.uuid(),
  grade: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
});

export async function POST(request: Request): Promise<Response> {
  const access = await authorize("reports:read");
  if (!access.ok) return Response.json({ ok: false, reason: access.status === 401 ? "sign_in" : "forbidden" }, { status: access.status });
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ ok: false, reason: "invalid_request" }, { status: 400 });
  const saved = await createJudgmentStore(sql).judge({ ...body.data, userId: access.user.id });
  return saved ? Response.json({ ok: true }) : Response.json({ ok: false, reason: "not_found" }, { status: 404 });
}
