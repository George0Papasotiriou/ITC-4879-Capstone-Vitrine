/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Order events API: guest cancellation and the local test payment actions.
 */

import { z } from "zod";

import type { OrderEventType } from "@/lib/commerce/order-state";
import { RETURN_REASONS } from "@/lib/commerce/returns";
import { accessibleOrder, commerce, notifyOrder, PAYMENT_PROVIDER } from "@/lib/commerce/server";

/**
 * What a guest can do to their own order, holding its link token.
 *
 * - `cancel`: the customer cancels (allowed before packing; the state machine
 *   decides).
 * - `test_pay` and `test_decline`: the local test payment driver. They stand in
 *   for the payment provider's webhook, so they act as the "system" actor and go
 *   through exactly the same `applyEvent` as a verified Stripe event will. They
 *   are refused for any order not created with the local test provider.
 */

export const runtime = "nodejs";

const bodySchema = z
  .object({
    /** The guest link's token; without it the signed-in owner's session is checked. */
    token: z.string().min(16).max(128).optional(),
    action: z.enum(["cancel", "test_pay", "test_decline", "request_return"]),
    returnReason: z.enum(RETURN_REASONS).optional(),
    note: z.string().trim().max(500).optional(),
  })
  .refine((body) => body.action !== "request_return" || body.returnReason !== undefined, { path: ["returnReason"] });

const EVENTS: Record<z.infer<typeof bodySchema>["action"], { type: OrderEventType; actor: "customer" | "system" }> = {
  cancel: { type: "cancel", actor: "customer" },
  test_pay: { type: "payment_succeeded", actor: "system" },
  test_decline: { type: "payment_failed", actor: "system" },
  request_return: { type: "request_return", actor: "customer" },
};

export async function POST(request: Request, { params }: RouteContext<"/api/orders/[id]/events">): Promise<Response> {
  const { id } = await params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!z.uuid().safeParse(id).success || !parsed.success) return Response.json({ ok: false, reason: "invalid_request" }, { status: 400 });

  const store = await commerce();
  const access = await accessibleOrder(id, parsed.data.token);
  // The same answer for a wrong id and a wrong token: nothing to learn by guessing.
  if (access === null) return Response.json({ ok: false, reason: "not_found" }, { status: 404 });
  const { order, user } = access;

  const testPayment = parsed.data.action === "test_pay" || parsed.data.action === "test_decline";
  if (testPayment && order.paymentProvider !== PAYMENT_PROVIDER) {
    return Response.json({ ok: false, reason: "not_allowed" }, { status: 403 });
  }
  // A test payment cannot rescue an order whose payment window has passed.
  if (await store.expireIfDue(id)) return Response.json({ ok: false, reason: "expired" }, { status: 409 });

  const { type, actor } = EVENTS[parsed.data.action];
  // The return's reason goes into the order's history, where the desk reads it.
  const returnNote = parsed.data.note === undefined || parsed.data.note === "" ? "" : `: ${parsed.data.note}`;
  const reason = testPayment ? "local test payment" : parsed.data.action === "request_return" ? `${parsed.data.returnReason}${returnNote}` : null;
  const result = await store.applyEvent(id, type, actor, {
    reason,
    actorUserId: actor === "customer" ? (user?.id ?? null) : null,
  });
  if (!result.ok) return Response.json({ ok: false, reason: result.reason }, { status: 409 });
  await notifyOrder(id, result.effects);
  return Response.json({ ok: true, status: result.to });
}
