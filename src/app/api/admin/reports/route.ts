/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * "Generate now": builds the weekly report out of turn, as a job, and answers before it is done.
 */

import { z } from "zod";

import { authorize } from "@/lib/auth/session";
import { enqueue } from "@/lib/jobs/queue";
import { logger } from "@/lib/log";

/**
 * For "reports:generate" (admins): the same job the schedule runs on Monday
 * mornings (docs/adr/020). It is enqueued rather than run here, because it
 * writes a file and sends emails, which no request should wait for.
 */

export const runtime = "nodejs";

const bodySchema = z.object({ endDay: z.iso.date().optional() }).default({});

export async function POST(request: Request): Promise<Response> {
  const access = await authorize("reports:generate");
  if (!access.ok) return Response.json({ ok: false, reason: access.status === 401 ? "sign_in" : "forbidden" }, { status: access.status });

  const body = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!body.success) return Response.json({ ok: false, reason: "invalid_request" }, { status: 400 });

  const jobId = await enqueue("weekly-report", { requestedAt: new Date().toISOString(), reason: "manual", endDay: body.data.endDay });
  logger.info({ report: { jobId, staff: access.user.id } }, "weekly report requested");
  return Response.json({ ok: true, jobId });
}
