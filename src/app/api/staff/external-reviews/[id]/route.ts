/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Staff moderation of reviews written elsewhere: hide one from Amazon.com (with a reason) or restore it.
 */

import { z } from "zod";

import { authorize } from "@/lib/auth/session";
import { logger } from "@/lib/log";
import { externalReviewStore } from "@/lib/reviews/server";

/**
 * docs/adr/061. The same permission and the same rule as the shop's own reviews
 * (docs/adr/017): "reviews:moderate", and a reason to hide, kept for other
 * staff and written to the audit log. A hidden review stays hidden through
 * every deploy's sync (external-store.ts keys reviews by their content).
 */

export const runtime = "nodejs";

const bodySchema = z
  .object({ status: z.enum(["published", "hidden"]), reason: z.string().trim().max(500).optional() })
  .refine((body) => body.status === "published" || (body.reason !== undefined && body.reason !== ""), { path: ["reason"] });

export async function POST(request: Request, { params }: RouteContext<"/api/staff/external-reviews/[id]">): Promise<Response> {
  const access = await authorize("reviews:moderate");
  if (!access.ok) return Response.json({ ok: false, reason: access.status === 401 ? "sign_in" : "forbidden" }, { status: access.status });

  const { id } = await params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!z.uuid().safeParse(id).success || !parsed.success) return Response.json({ ok: false, reason: "invalid_request" }, { status: 400 });

  const hidden = parsed.data.status === "hidden";
  const done = await (await externalReviewStore()).setHidden(id, { hidden, reason: hidden ? (parsed.data.reason ?? null) : null, actor: { userId: access.user.id, email: access.user.email } });
  if (!done) return Response.json({ ok: false, reason: "not_found" }, { status: 404 });
  logger.info({ review: id, status: parsed.data.status, staff: access.user.id, source: "amazon" }, "External review moderated");
  return Response.json({ ok: true, status: parsed.data.status });
}
