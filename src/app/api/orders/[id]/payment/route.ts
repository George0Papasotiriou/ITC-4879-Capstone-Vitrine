/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The payment form's start: the client secret for an order waiting to be paid with Stripe.
 */

import { z } from "zod";

import { serverEnv } from "@/env";
import { accessibleOrder } from "@/lib/commerce/server";
import { stripePayments } from "@/lib/payments/service";

/**
 * docs/adr/038. Only for someone who may see the order — its link's token, or
 * the signed-in owner — and only while it waits for payment. The answer is the
 * PaymentIntent's client secret, which lets the browser pay this one amount
 * and nothing else, and the publishable key; neither is a secret of the shop.
 */

export const runtime = "nodejs";

const bodySchema = z.object({ token: z.string().min(16).max(128).optional() });

export async function POST(request: Request, { params }: RouteContext<"/api/orders/[id]/payment">): Promise<Response> {
  const { id } = await params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!z.uuid().safeParse(id).success || !parsed.success) return Response.json({ ok: false, reason: "invalid_request" }, { status: 400 });

  const payments = stripePayments();
  const publishableKey = serverEnv().STRIPE_PUBLISHABLE_KEY;
  if (payments === null || publishableKey === undefined) return Response.json({ ok: false, reason: "no_provider" }, { status: 404 });

  const access = await accessibleOrder(id, parsed.data.token);
  if (access === null) return Response.json({ ok: false, reason: "not_found" }, { status: 404 });

  const started = await payments.startPayment(id);
  if (!started.ok) return Response.json({ ok: false, reason: started.reason }, { status: 409 });
  return Response.json({ ok: true, clientSecret: started.clientSecret, publishableKey }, { headers: { "cache-control": "no-store" } });
}
