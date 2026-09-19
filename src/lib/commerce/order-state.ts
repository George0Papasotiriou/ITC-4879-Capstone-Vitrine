/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Order state machine: statuses, events, allowed transitions and side effects.
 */

/**
 * The order state machine (docs/PLAN.md 2.3).
 *
 *  checkout ──► pending_payment ─payment_succeeded─► paid ─pack─► packed ─ship─► shipped ─deliver─► delivered
 *                     │                               │                                                │
 *        payment_failed / payment_expired / cancel  cancel (before packing)               request_return (14 days)
 *                     ▼                               ▼                                                ▼
 *                 cancelled                       cancelled ─refund─► refunded      return_requested ─receive_return─► returned ─refund─► refunded
 *
 * `transition` is pure: it takes the order's current state and an event, and
 * returns the next status and the side effects the caller must run in the same
 * database transaction (release stock, issue a refund, send an email). It never
 * performs them. That keeps every rule testable in isolation, and makes the
 * payment webhook, a staff action and the local test payment all go through
 * the same function.
 *
 * Who may cause an event is part of the rule: only the payment system confirms
 * payment, only staff pack and ship, a customer may cancel before packing or
 * ask to return. The caller authenticates the actor; this module authorises it.
 */

export const ORDER_STATUSES = [
  "pending_payment",
  "paid",
  "packed",
  "shipped",
  "delivered",
  "cancelled",
  "refunded",
  "return_requested",
  "returned",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_EVENTS = [
  "payment_succeeded",
  "payment_failed",
  "payment_expired",
  "cancel",
  "pack",
  "ship",
  "deliver",
  "request_return",
  "receive_return",
  "refund",
] as const;

export type OrderEventType = (typeof ORDER_EVENTS)[number];

/** "system": the payment provider's verified webhook or a scheduled job. */
export type Actor = "customer" | "staff" | "system";

export type SideEffect =
  /** Put the reserved quantities back on the shelf. */
  | "release_stock"
  /** Return quantities that came back in a return. */
  | "restock_returned"
  /** Ask the payment provider to refund the charge. */
  | "issue_refund"
  /** Stop a payment that has not completed. */
  | "void_payment"
  | "email_order_confirmed"
  | "email_order_cancelled"
  | "email_order_shipped"
  | "email_order_delivered"
  | "email_return_requested"
  | "email_return_received"
  | "email_refunded"
  /** Record purchases for the Taste Graph (only for shoppers who opted in). */
  | "record_purchase";

/** The EU right of withdrawal for distance purchases: 14 days from delivery. */
export const RETURN_WINDOW_DAYS = 14;

/** An unpaid order holds stock for this long before it expires. */
export const PAYMENT_WINDOW_MINUTES = 30;

type Edge = { to: OrderStatus; actors: readonly Actor[]; effects: readonly SideEffect[] };

/** Every allowed edge. Anything not listed is refused. */
export const TRANSITIONS: Readonly<Partial<Record<OrderStatus, Partial<Record<OrderEventType, Edge>>>>> = {
  pending_payment: {
    payment_succeeded: { to: "paid", actors: ["system"], effects: ["email_order_confirmed", "record_purchase"] },
    payment_failed: { to: "cancelled", actors: ["system"], effects: ["release_stock", "email_order_cancelled"] },
    payment_expired: { to: "cancelled", actors: ["system"], effects: ["release_stock", "void_payment"] },
    cancel: { to: "cancelled", actors: ["customer", "staff"], effects: ["release_stock", "void_payment"] },
  },
  paid: {
    pack: { to: "packed", actors: ["staff"], effects: [] },
    cancel: { to: "cancelled", actors: ["customer", "staff"], effects: ["release_stock", "issue_refund", "email_order_cancelled"] },
  },
  packed: {
    ship: { to: "shipped", actors: ["staff"], effects: ["email_order_shipped"] },
  },
  shipped: {
    deliver: { to: "delivered", actors: ["staff", "system"], effects: ["email_order_delivered"] },
  },
  delivered: {
    request_return: { to: "return_requested", actors: ["customer", "staff"], effects: ["email_return_requested"] },
  },
  cancelled: {
    // Confirms the refund issued when a paid order was cancelled.
    refund: { to: "refunded", actors: ["system"], effects: ["email_refunded"] },
  },
  return_requested: {
    receive_return: { to: "returned", actors: ["staff"], effects: ["restock_returned", "email_return_received"] },
  },
  returned: {
    refund: { to: "refunded", actors: ["staff", "system"], effects: ["issue_refund", "email_refunded"] },
  },
};

export type OrderSnapshot = {
  status: OrderStatus;
  /** Set when the order reached "delivered". */
  deliveredAt?: Date | null;
  /** Whether a payment was ever captured; a cancelled order without one has nothing to refund. */
  paid?: boolean;
};

export type OrderEvent = { type: OrderEventType; actor: Actor; at: Date };

export type TransitionResult =
  | { ok: true; from: OrderStatus; to: OrderStatus; effects: SideEffect[] }
  | { ok: false; reason: "not_allowed" | "wrong_actor" | "return_window_closed" | "nothing_to_refund"; from: OrderStatus };

export function transition(order: OrderSnapshot, event: OrderEvent): TransitionResult {
  const edge = TRANSITIONS[order.status]?.[event.type];
  if (edge === undefined) return { ok: false, reason: "not_allowed", from: order.status };
  if (!edge.actors.includes(event.actor)) return { ok: false, reason: "wrong_actor", from: order.status };

  if (event.type === "request_return") {
    const deliveredAt = order.deliveredAt;
    const windowEnds = deliveredAt == null ? null : deliveredAt.getTime() + RETURN_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    // Staff may accept a late return; a customer cannot open one.
    if (event.actor === "customer" && (windowEnds === null || event.at.getTime() > windowEnds)) {
      return { ok: false, reason: "return_window_closed", from: order.status };
    }
  }
  if (order.status === "cancelled" && event.type === "refund" && order.paid !== true) {
    return { ok: false, reason: "nothing_to_refund", from: order.status };
  }

  return { ok: true, from: order.status, to: edge.to, effects: [...edge.effects] };
}

/** Events an actor could apply now, for showing only the buttons that will work. */
export function availableEvents(order: OrderSnapshot, actor: Actor, at: Date): OrderEventType[] {
  return ORDER_EVENTS.filter((type) => transition(order, { type, actor, at }).ok);
}

/** Nothing more can happen: refunded, or cancelled before any payment was taken. */
export function isFinal(order: OrderSnapshot): boolean {
  return order.status === "refunded" || (order.status === "cancelled" && order.paid !== true);
}
