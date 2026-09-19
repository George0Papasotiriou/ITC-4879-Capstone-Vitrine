/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Staff order actions: pack, ship, deliver, returns, refunds and cancellation, through the order state machine.
 */

import { z } from "zod";

import { authorize } from "@/lib/auth/session";
import { needsReason } from "@/lib/commerce/desk";
import { ORDER_EVENTS } from "@/lib/commerce/order-state";
import { commerce, notifyOrder } from "@/lib/commerce/server";
import { logger } from "@/lib/log";

/**
 * The order desk's one write (docs/adr/016). The server decides everything:
 * the session must hold "orders:manage" (support or admin), the event must be
 * one the state machine allows staff to take from the order's current status,
 * and cancelling or refunding must say why — the reason is kept in the order's
 * history with the action. The customer's email follows from the transition.
 */

export const runtime = "nodejs";

const bodySchema = z.object({
  event: z.enum(ORDER_EVENTS),
  reason: z.string().trim().max(500).optional(),
});

export async function POST(request: Request, { params }: RouteContext<"/api/staff/orders/[id]/events">): Promise<Response> {
  const access = await authorize("orders:manage");
  if (!access.ok) return Response.json({ ok: false, reason: access.status === 401 ? "sign_in" : "forbidden" }, { status: access.status });

  const { id } = await params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!z.uuid().safeParse(id).success || !parsed.success) return Response.json({ ok: false, reason: "invalid_request" }, { status: 400 });
  const { event, reason } = parsed.data;
  if (needsReason(event) && (reason === undefined || reason === "")) return Response.json({ ok: false, reason: "reason_required" }, { status: 422 });

  const store = await commerce();
  const result = await store.applyEvent(id, event, "staff", { reason: reason === undefined || reason === "" ? null : reason, actorUserId: access.user.id });
  if (!result.ok) {
    const status = result.reason === "not_found" ? 404 : 409;
    return Response.json({ ok: false, reason: result.reason }, { status });
  }
  // Who did what is in the order's history; the log only records that staff acted.
  logger.info({ order: id, event, from: result.from, to: result.to, staff: access.user.id }, "Order moved by staff");
  await notifyOrder(id, result.effects);
  return Response.json({ ok: true, status: result.to });
}
