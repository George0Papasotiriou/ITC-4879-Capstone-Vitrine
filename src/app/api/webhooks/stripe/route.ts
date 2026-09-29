/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Stripe's webhook: the only thing that marks an order paid.
 */

import { stripePayments } from "@/lib/payments/service";

/**
 * docs/adr/038. The signature is checked on the body exactly as it arrived, so
 * it is read as text, never parsed first (CLAUDE.md, known gotchas). A 400
 * tells Stripe the delivery was not ours; anything the shop decided — applied,
 * refunded, needs a person, ignored, already seen — is a 200, so Stripe stops
 * retrying. An unexpected failure throws: Stripe retries, and the event is
 * handled then, because it is recorded only after it was acted on.
 */

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const payments = stripePayments();
  if (payments === null) return new Response("Not found", { status: 404 });
  const result = await payments.handleWebhook(await request.text(), request.headers.get("stripe-signature"));
  return Response.json({ received: result.status === 200, outcome: result.outcome }, { status: result.status });
}
