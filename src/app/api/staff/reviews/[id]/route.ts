/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Staff review moderation: hide a review (with a reason) or restore it.
 */

import { z } from "zod";

import { authorize } from "@/lib/auth/session";
import { reviewsStore } from "@/lib/commerce/server";
import { logger } from "@/lib/log";

/**
 * For "reviews:moderate" (support, merchandiser, admin). Hiding needs a reason,
 * kept with the review for other staff; the product's rating changes in the
 * same transaction (docs/adr/017).
 */

export const runtime = "nodejs";

const bodySchema = z
  .object({ status: z.enum(["published", "hidden"]), reason: z.string().trim().max(500).optional() })
  .refine((body) => body.status === "published" || (body.reason !== undefined && body.reason !== ""), { path: ["reason"] });

export async function POST(request: Request, { params }: RouteContext<"/api/staff/reviews/[id]">): Promise<Response> {
  const access = await authorize("reviews:moderate");
  if (!access.ok) return Response.json({ ok: false, reason: access.status === 401 ? "sign_in" : "forbidden" }, { status: access.status });

  const { id } = await params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!z.uuid().safeParse(id).success || !parsed.success) return Response.json({ ok: false, reason: "invalid_request" }, { status: 400 });

  const store = await reviewsStore();
  const result = await store.moderate(id, { status: parsed.data.status, reason: parsed.data.status === "hidden" ? (parsed.data.reason ?? null) : null, actor: { userId: access.user.id, email: access.user.email } });
  if (!result.ok) return Response.json({ ok: false, reason: result.reason }, { status: 404 });
  logger.info({ review: id, status: parsed.data.status, staff: access.user.id }, "Review moderated");
  return Response.json({ ok: true, status: parsed.data.status });
}
