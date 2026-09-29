/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * What a verified Stripe event means for an order: pure, so every case is tested without Stripe.
 */

import type { OrderEventType, OrderStatus } from "@/lib/commerce/order-state";

/**
 * docs/adr/038. Stripe tells the shop what happened to a payment; the order's
 * own state machine (src/lib/commerce/order-state.ts) decides what that does to
 * the order. This table is the only translation between the two, and it never
 * trusts the event alone about money: a succeeded payment counts only when its
 * amount and currency are exactly the order's, as the database holds them.
 *
 *   payment_intent.succeeded       → payment_succeeded (if the amount matches)
 *   payment_intent.payment_failed  → nothing: the shopper may try another card
 *                                    until the 30-minute hold runs out
 *   charge.refunded (in full)      → refund, confirming a cancelled order's refund
 *   anything else                  → ignored
 *
 * A payment that arrives for an order no longer waiting for one (the hold ran
 * out and the stock went back on the shelf) is not an order: it is refunded.
 */

/** The fields of a Stripe event the shop reads, whatever else Stripe sends. */
export type StripeEventLike = {
  id: string;
  type: string;
  data: {
    object: {
      id: string;
      object: string;
      amount?: number;
      amount_received?: number;
      amount_refunded?: number;
      currency?: string;
      refunded?: boolean;
      payment_intent?: string | { id: string } | null;
      metadata?: Record<string, string> | null;
      last_payment_error?: { code?: string | null; decline_code?: string | null } | null;
    };
  };
};

export type OrderForPayment = { id: string; status: OrderStatus; totalCents: number; currency: string; paymentReference: string | null };

export type PaymentDecision =
  | { kind: "ignore"; why: string }
  | { kind: "apply"; orderId: string; event: OrderEventType; reason: string }
  /** Money arrived that no order is waiting for: give it back. */
  | { kind: "refund"; orderId: string; paymentIntentId: string; why: string }
  /** Something is wrong enough for a person to look (amounts disagree). */
  | { kind: "alert"; orderId: string; why: string };

/** The order an event is about: the id the shop wrote into the intent's metadata. */
export function orderIdOf(event: StripeEventLike): string | null {
  const id = event.data.object.metadata?.orderId;
  return typeof id === "string" && id.length > 0 ? id : null;
}

export function paymentIntentIdOf(event: StripeEventLike): string | null {
  const object = event.data.object;
  if (object.object === "payment_intent") return object.id;
  const intent = object.payment_intent;
  if (typeof intent === "string") return intent;
  return intent?.id ?? null;
}

export function decidePayment(event: StripeEventLike, order: OrderForPayment | null): PaymentDecision {
  const handled = ["payment_intent.succeeded", "payment_intent.payment_failed", "charge.refunded"];
  if (!handled.includes(event.type)) return { kind: "ignore", why: `not an event the shop acts on (${event.type})` };
  if (order === null) return { kind: "ignore", why: "no order of this shop" };
  const intentId = paymentIntentIdOf(event);
  // The intent must be the one this order created: a stray or replayed intent changes nothing.
  if (intentId === null || (order.paymentReference !== null && order.paymentReference !== intentId)) {
    return { kind: "alert", orderId: order.id, why: `payment ${intentId ?? "unknown"} is not this order's (${order.paymentReference ?? "none"})` };
  }
  const object = event.data.object;

  if (event.type === "payment_intent.payment_failed") {
    const code = object.last_payment_error?.decline_code ?? object.last_payment_error?.code ?? "declined";
    return { kind: "ignore", why: `a card was declined (${code}); the shopper may try again until the hold ends` };
  }

  if (event.type === "payment_intent.succeeded") {
    const received = object.amount_received ?? object.amount ?? -1;
    const currency = (object.currency ?? "").toUpperCase();
    if (received !== order.totalCents || currency !== order.currency.toUpperCase()) {
      return { kind: "alert", orderId: order.id, why: `paid ${received} ${currency}, the order is ${order.totalCents} ${order.currency}` };
    }
    if (order.status === "pending_payment") return { kind: "apply", orderId: order.id, event: "payment_succeeded", reason: `Stripe ${intentId}` };
    if (order.status === "cancelled") return { kind: "refund", orderId: order.id, paymentIntentId: intentId, why: "paid after the order was cancelled" };
    return { kind: "ignore", why: `already ${order.status}` };
  }

  // charge.refunded: only a full refund finishes an order's refund.
  const refundedInFull = object.refunded === true || (object.amount !== undefined && object.amount_refunded === object.amount);
  if (!refundedInFull) return { kind: "ignore", why: "a partial refund" };
  if (order.status === "cancelled") return { kind: "apply", orderId: order.id, event: "refund", reason: `Stripe refund of ${intentId}` };
  return { kind: "ignore", why: `refund confirmed; the order is already ${order.status}` };
}
