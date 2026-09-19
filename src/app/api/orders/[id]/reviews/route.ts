/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Writes the verified review of one delivered order line, from the order's own page.
 */

import { z } from "zod";

import { reviewInputSchema } from "@/lib/commerce/reviews";
import { accessibleOrder, reviewsStore } from "@/lib/commerce/server";

/**
 * Only whoever may see the order may review its lines — the guest with its
 * link, or the account it belongs to — and only once it was delivered
 * (docs/adr/017). Sending again rewrites the same review. The text is checked
 * and cleaned by `reviewInputSchema`, and the database checks the rest.
 */

export const runtime = "nodejs";

const bodySchema = z.object({
  token: z.string().min(16).max(128).optional(),
  orderItemId: z.uuid(),
  locale: z.enum(["en", "el"]),
  review: z.unknown(),
});

export async function POST(request: Request, { params }: RouteContext<"/api/orders/[id]/reviews">): Promise<Response> {
  const { id } = await params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!z.uuid().safeParse(id).success || !parsed.success) return Response.json({ ok: false, reason: "invalid_request" }, { status: 400 });
  const input = reviewInputSchema.safeParse(parsed.data.review);
  if (!input.success) {
    const fields = Object.fromEntries(input.error.issues.map((issue) => [String(issue.path[0] ?? "review"), issue.message === "too_short" || issue.message === "too_long" ? issue.message : "invalid"]));
    return Response.json({ ok: false, reason: "invalid", fields }, { status: 422 });
  }

  const access = await accessibleOrder(id, parsed.data.token);
  if (access === null) return Response.json({ ok: false, reason: "not_found" }, { status: 404 });

  const store = await reviewsStore();
  const result = await store.saveReview({
    orderId: id,
    orderItemId: parsed.data.orderItemId,
    input: input.data,
    userId: access.user?.id ?? null,
    locale: parsed.data.locale,
  });
  if (!result.ok) return Response.json({ ok: false, reason: result.reason }, { status: result.reason === "not_found" ? 404 : 409 });
  return Response.json({ ok: true, created: result.created });
}
