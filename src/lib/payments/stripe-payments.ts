/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Paying with Stripe in test mode: starting a payment, reading its webhook once, voiding and refunding.
 */

import type postgres from "postgres";

import type { OrderEventType, OrderStatus, SideEffect } from "@/lib/commerce/order-state";
import { decidePayment, orderIdOf, paymentIntentIdOf, type OrderForPayment, type StripeEventLike } from "@/lib/payments/stripe-events";

/**
 * docs/adr/038.
 *
 * - Starting a payment creates one PaymentIntent per order, for the total the
 *   database holds, with the order's id as the idempotency key: pressing "Pay"
 *   twice, or two tabs, never makes two. The client secret goes to the
 *   shopper's browser, which talks to Stripe directly; card numbers never
 *   touch this server.
 * - The webhook is the only thing that marks an order paid. Its signature is
 *   checked on the raw body, each event is handled once (payment_events), and
 *   what it means is decided by stripe-events.ts.
 * - The order machine's side effects `void_payment` (an unpaid order cancelled
 *   or expired: its intent is cancelled, so it can no longer be paid) and
 *   `issue_refund` (a paid order cancelled or returned) reach Stripe here,
 *   each with an idempotency key.
 */

/** The parts of the Stripe SDK the shop calls; the real client satisfies it, tests pass a stand-in. */
export type StripeLike = {
  paymentIntents: {
    create(
      params: {
        amount: number;
        currency: string;
        automatic_payment_methods: { enabled: boolean };
        metadata: Record<string, string>;
        description: string;
      },
      options: { idempotencyKey: string },
    ): Promise<{ id: string; client_secret: string | null; status: string }>;
    retrieve(id: string): Promise<{ id: string; client_secret: string | null; status: string }>;
    cancel(id: string): Promise<{ id: string; status: string }>;
  };
  refunds: { create(params: { payment_intent: string }, options: { idempotencyKey: string }): Promise<{ id: string; status: string | null }> };
  webhooks: { constructEvent(payload: string, header: string, secret: string): unknown };
};

type OrderRow = { id: string; number: string; status: OrderStatus; total_cents: number; currency: string; payment_provider: string; payment_reference: string | null };

export type PaymentsDeps = {
  sql: postgres.Sql;
  stripe: () => Promise<StripeLike>;
  webhookSecret: string;
  /** The order machine's one door (store.applyEvent), as the system actor. */
  applyEvent: (orderId: string, type: OrderEventType, reason: string) => Promise<{ ok: true; to: OrderStatus; effects: SideEffect[] } | { ok: false; reason: string }>;
  /** Emails, the live message to open pages, and anything else a transition asks for, after the payment effects. */
  afterEvent: (orderId: string, effects: readonly SideEffect[], status: OrderStatus) => Promise<void>;
  log: { warn: (details: object, message: string) => void; error: (details: object, message: string) => void };
};

export type StartPayment = { ok: true; clientSecret: string } | { ok: false; reason: "not_payable" | "wrong_provider" | "cancelled_payment" };

export type WebhookResult = { status: 200 | 400; outcome: "applied" | "refunded" | "alerted" | "ignored" | "duplicate" | "bad_signature"; detail?: string };

export const STRIPE_PROVIDER = "stripe";

export function createStripePayments(deps: PaymentsDeps) {
  const { sql, stripe, log } = deps;

  async function orderRow(where: { id: string } | { reference: string }): Promise<OrderRow | null> {
    const [row] =
      "id" in where
        ? await sql<OrderRow[]>`SELECT id, number, status, total_cents, currency, payment_provider, payment_reference FROM orders WHERE id = ${where.id}`
        : await sql<OrderRow[]>`SELECT id, number, status, total_cents, currency, payment_provider, payment_reference FROM orders WHERE payment_reference = ${where.reference}`;
    return row ?? null;
  }

  const forPayment = (row: OrderRow): OrderForPayment => ({ id: row.id, status: row.status, totalCents: row.total_cents, currency: row.currency, paymentReference: row.payment_reference });

  /** The client secret the order's payment form needs; creates the intent the first time. */
  async function startPayment(orderId: string): Promise<StartPayment> {
    const order = await orderRow({ id: orderId });
    if (order === null || order.status !== "pending_payment") return { ok: false, reason: "not_payable" };
    if (order.payment_provider !== STRIPE_PROVIDER) return { ok: false, reason: "wrong_provider" };
    const client = await stripe();
    if (order.payment_reference !== null) {
      const intent = await client.paymentIntents.retrieve(order.payment_reference);
      if (intent.status === "canceled" || intent.client_secret === null) return { ok: false, reason: "cancelled_payment" };
      return { ok: true, clientSecret: intent.client_secret };
    }
    const intent = await client.paymentIntents.create(
      {
        amount: order.total_cents,
        currency: order.currency.toLowerCase(),
        automatic_payment_methods: { enabled: true },
        // Only what finds the order again: no name, address or email goes to Stripe from here.
        metadata: { orderId: order.id, orderNumber: order.number },
        description: `Vitrine order ${order.number}`,
      },
      { idempotencyKey: `vitrine-order-${order.id}` },
    );
    // Kept only if none was written meanwhile (two tabs): the idempotency key makes both the same intent anyway.
    await sql`UPDATE orders SET payment_reference = ${intent.id}, updated_at = now() WHERE id = ${order.id} AND payment_reference IS NULL`;
    if (intent.client_secret === null) return { ok: false, reason: "cancelled_payment" };
    return { ok: true, clientSecret: intent.client_secret };
  }

  /** `void_payment` and `issue_refund` for a Stripe order; other orders and effects are left alone. */
  async function runPaymentEffects(orderId: string, effects: readonly SideEffect[]): Promise<void> {
    if (!effects.includes("void_payment") && !effects.includes("issue_refund")) return;
    const order = await orderRow({ id: orderId });
    if (order === null || order.payment_provider !== STRIPE_PROVIDER || order.payment_reference === null) return;
    const client = await stripe();
    try {
      if (effects.includes("void_payment")) {
        const intent = await client.paymentIntents.retrieve(order.payment_reference);
        // Only an intent that can still be paid is cancelled; a succeeded one is refunded by the webhook's rule.
        if (!["canceled", "succeeded"].includes(intent.status)) await client.paymentIntents.cancel(order.payment_reference);
      }
      if (effects.includes("issue_refund")) {
        await client.refunds.create({ payment_intent: order.payment_reference }, { idempotencyKey: `vitrine-refund-${order.payment_reference}` });
      }
    } catch (error) {
      // The order has already changed; a person must finish this at Stripe. Said loudly, not thrown at the shopper.
      log.error({ orderId, effects, err: error instanceof Error ? error.message : String(error) }, "Stripe did not accept a void or refund");
    }
  }

  /** One webhook delivery: verified, read once, decided, acted on. */
  async function handleWebhook(rawBody: string, signature: string | null): Promise<WebhookResult> {
    if (signature === null) return { status: 400, outcome: "bad_signature" };
    let event: StripeEventLike;
    try {
      event = (await stripe()).webhooks.constructEvent(rawBody, signature, deps.webhookSecret) as StripeEventLike;
    } catch {
      return { status: 400, outcome: "bad_signature" };
    }

    const [seen] = await sql<{ id: string }[]>`SELECT id FROM payment_events WHERE id = ${event.id}`;
    if (seen !== undefined) return { status: 200, outcome: "duplicate" };

    const intentId = paymentIntentIdOf(event);
    const byMetadata = orderIdOf(event);
    const order = byMetadata !== null ? await orderRow({ id: byMetadata }) : intentId === null ? null : await orderRow({ reference: intentId });
    const decision = decidePayment(event, order === null ? null : forPayment(order));

    let result: WebhookResult;
    switch (decision.kind) {
      case "apply": {
        const applied = await deps.applyEvent(decision.orderId, decision.event, decision.reason);
        if (applied.ok) {
          await runPaymentEffects(decision.orderId, applied.effects);
          await deps.afterEvent(decision.orderId, applied.effects, applied.to);
          result = { status: 200, outcome: "applied", detail: decision.event };
        } else {
          result = { status: 200, outcome: "ignored", detail: applied.reason };
        }
        break;
      }
      case "refund": {
        await (await stripe()).refunds.create({ payment_intent: decision.paymentIntentId }, { idempotencyKey: `vitrine-refund-${decision.paymentIntentId}` });
        log.warn({ orderId: decision.orderId, paymentIntentId: decision.paymentIntentId }, `Stripe payment refunded: ${decision.why}`);
        result = { status: 200, outcome: "refunded", detail: decision.why };
        break;
      }
      case "alert":
        log.error({ orderId: decision.orderId, eventId: event.id }, `Stripe event needs a person: ${decision.why}`);
        result = { status: 200, outcome: "alerted", detail: decision.why };
        break;
      default:
        result = { status: 200, outcome: "ignored", detail: decision.why };
    }

    // Recorded after acting: a failure above makes Stripe retry, and the retry is then handled, not skipped.
    await sql`
      INSERT INTO payment_events (id, provider, type, order_id, outcome, detail)
      VALUES (${event.id}, ${STRIPE_PROVIDER}, ${event.type}, ${order?.id ?? null}, ${result.outcome}, ${result.detail ?? null})
      ON CONFLICT (id) DO NOTHING
    `;
    return result;
  }

  return { startPayment, runPaymentEffects, handleWebhook };
}

export type StripePayments = ReturnType<typeof createStripePayments>;
