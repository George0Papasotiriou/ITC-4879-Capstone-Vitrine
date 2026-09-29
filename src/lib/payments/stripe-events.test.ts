/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Tests for what a Stripe event means for an order.
 */

import { describe, expect, it } from "vitest";

import { decidePayment, orderIdOf, paymentIntentIdOf, type OrderForPayment, type StripeEventLike } from "@/lib/payments/stripe-events";

const order: OrderForPayment = { id: "order-1", status: "pending_payment", totalCents: 42_990, currency: "EUR", paymentReference: "pi_1" };

const succeeded = (overrides: Partial<StripeEventLike["data"]["object"]> = {}): StripeEventLike => ({
  id: "evt_1",
  type: "payment_intent.succeeded",
  data: { object: { id: "pi_1", object: "payment_intent", amount: 42_990, amount_received: 42_990, currency: "eur", metadata: { orderId: "order-1" }, ...overrides } },
});

describe("decidePayment", () => {
  it("marks a waiting order paid when the exact amount and currency arrive", () => {
    expect(decidePayment(succeeded(), order)).toEqual({ kind: "apply", orderId: "order-1", event: "payment_succeeded", reason: "Stripe pi_1" });
  });

  it("never marks an order paid for a different amount or currency, and asks a person to look", () => {
    expect(decidePayment(succeeded({ amount_received: 100 }), order).kind).toBe("alert");
    expect(decidePayment(succeeded({ currency: "gbp" }), order).kind).toBe("alert");
  });

  it("refuses a payment that is not the one this order created", () => {
    expect(decidePayment(succeeded({ id: "pi_other" }), order)).toMatchObject({ kind: "alert" });
  });

  it("gives back money that arrives after the order was cancelled", () => {
    expect(decidePayment(succeeded(), { ...order, status: "cancelled" })).toEqual({
      kind: "refund",
      orderId: "order-1",
      paymentIntentId: "pi_1",
      why: "paid after the order was cancelled",
    });
  });

  it("changes nothing when the same success comes again (a replay)", () => {
    expect(decidePayment(succeeded(), { ...order, status: "paid" }).kind).toBe("ignore");
  });

  it("lets the shopper try another card: a decline does not cancel the order", () => {
    const failed: StripeEventLike = {
      id: "evt_2",
      type: "payment_intent.payment_failed",
      data: { object: { id: "pi_1", object: "payment_intent", last_payment_error: { decline_code: "insufficient_funds" } } },
    };
    expect(decidePayment(failed, order)).toMatchObject({ kind: "ignore", why: expect.stringContaining("insufficient_funds") });
  });

  it("finishes a cancelled order's refund only when the charge is refunded in full", () => {
    const refunded = (amountRefunded: number): StripeEventLike => ({
      id: "evt_3",
      type: "charge.refunded",
      data: { object: { id: "ch_1", object: "charge", amount: 42_990, amount_refunded: amountRefunded, payment_intent: "pi_1" } },
    });
    const cancelled = { ...order, status: "cancelled" as const };
    expect(decidePayment(refunded(42_990), cancelled)).toMatchObject({ kind: "apply", event: "refund" });
    expect(decidePayment(refunded(1_000), cancelled).kind).toBe("ignore");
    expect(decidePayment(refunded(42_990), { ...order, status: "refunded" }).kind).toBe("ignore");
  });

  it("ignores events it does not act on, and events for no order of this shop", () => {
    expect(decidePayment({ ...succeeded(), type: "customer.created" }, order).kind).toBe("ignore");
    expect(decidePayment(succeeded(), null).kind).toBe("ignore");
  });
});

describe("orderIdOf and paymentIntentIdOf", () => {
  it("reads the order from the metadata and the intent from an intent or a charge", () => {
    expect(orderIdOf(succeeded())).toBe("order-1");
    expect(paymentIntentIdOf(succeeded())).toBe("pi_1");
    expect(paymentIntentIdOf({ id: "e", type: "charge.refunded", data: { object: { id: "ch", object: "charge", payment_intent: { id: "pi_9" } } } })).toBe("pi_9");
    expect(orderIdOf({ id: "e", type: "charge.refunded", data: { object: { id: "ch", object: "charge", metadata: {} } } })).toBeNull();
  });
});
