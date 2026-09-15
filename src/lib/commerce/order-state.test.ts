/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Unit tests for the order state machine.
 */

import { describe, expect, it } from "vitest";

import {
  availableEvents,
  isFinal,
  ORDER_EVENTS,
  ORDER_STATUSES,
  RETURN_WINDOW_DAYS,
  transition,
  type Actor,
  type OrderEventType,
  type OrderStatus,
  type SideEffect,
} from "@/lib/commerce/order-state";

const NOW = new Date("2026-09-14T10:00:00Z");
const ACTORS: Actor[] = ["customer", "staff", "system"];
const days = (n: number) => new Date(NOW.getTime() + n * 24 * 60 * 60 * 1000);

/**
 * The diagram in docs/PLAN.md 2.3, written out independently of the
 * implementation's table: [from, event, to, actors, effects].
 */
const EXPECTED: [OrderStatus, OrderEventType, OrderStatus, Actor[], SideEffect[]][] = [
  ["pending_payment", "payment_succeeded", "paid", ["system"], ["email_order_confirmed", "record_purchase"]],
  ["pending_payment", "payment_failed", "cancelled", ["system"], ["release_stock", "email_order_cancelled"]],
  ["pending_payment", "payment_expired", "cancelled", ["system"], ["release_stock", "void_payment"]],
  ["pending_payment", "cancel", "cancelled", ["customer", "staff"], ["release_stock", "void_payment"]],
  ["paid", "pack", "packed", ["staff"], []],
  ["paid", "cancel", "cancelled", ["customer", "staff"], ["release_stock", "issue_refund", "email_order_cancelled"]],
  ["packed", "ship", "shipped", ["staff"], ["email_order_shipped"]],
  ["shipped", "deliver", "delivered", ["staff", "system"], ["email_order_delivered"]],
  ["delivered", "request_return", "return_requested", ["customer", "staff"], []],
  ["cancelled", "refund", "refunded", ["system"], ["email_refunded"]],
  ["return_requested", "receive_return", "returned", ["staff"], ["restock_returned", "email_return_received"]],
  ["returned", "refund", "refunded", ["staff", "system"], ["issue_refund", "email_refunded"]],
];

/** A snapshot for which the edge's extra conditions hold. */
const snapshot = (status: OrderStatus) => ({ status, deliveredAt: status === "delivered" ? days(-2) : null, paid: true });

describe("order state machine: every allowed edge", () => {
  for (const [from, type, to, actors, effects] of EXPECTED) {
    for (const actor of actors) {
      it(`${from} —${type} by ${actor}→ ${to}`, () => {
        const result = transition(snapshot(from), { type, actor, at: NOW });
        expect(result).toEqual({ ok: true, from, to, effects });
      });
    }
  }
});

describe("order state machine: everything else is refused", () => {
  it("refuses every (status, event) pair not in the diagram, for every actor", () => {
    let refused = 0;
    for (const status of ORDER_STATUSES) {
      for (const type of ORDER_EVENTS) {
        const edge = EXPECTED.find(([from, event]) => from === status && event === type);
        for (const actor of ACTORS) {
          const result = transition(snapshot(status), { type, actor, at: NOW });
          if (edge === undefined) {
            expect(result, `${status} ${type} ${actor}`).toEqual({ ok: false, reason: "not_allowed", from: status });
            refused += 1;
          } else if (!edge[3].includes(actor)) {
            expect(result, `${status} ${type} ${actor}`).toEqual({ ok: false, reason: "wrong_actor", from: status });
            refused += 1;
          }
        }
      }
    }
    // 9 statuses × 10 events × 3 actors = 270 combinations, 17 of them allowed.
    expect(refused).toBe(270 - EXPECTED.reduce((sum, edge) => sum + edge[3].length, 0));
  });

  it("never lets a customer confirm their own payment or ship an order", () => {
    expect(transition(snapshot("pending_payment"), { type: "payment_succeeded", actor: "customer", at: NOW })).toMatchObject({ ok: false, reason: "wrong_actor" });
    expect(transition(snapshot("packed"), { type: "ship", actor: "customer", at: NOW })).toMatchObject({ ok: false, reason: "wrong_actor" });
  });

  it("cannot cancel once packed: the parcel is already on its way to the courier", () => {
    for (const status of ["packed", "shipped", "delivered"] as const) {
      for (const actor of ACTORS) expect(transition(snapshot(status), { type: "cancel", actor, at: NOW }).ok).toBe(false);
    }
  });

  it("does not pay an order twice (a replayed webhook changes nothing)", () => {
    expect(transition(snapshot("paid"), { type: "payment_succeeded", actor: "system", at: NOW })).toMatchObject({ ok: false, reason: "not_allowed" });
  });
});

describe("returns", () => {
  const delivered = (daysAgo: number) => ({ status: "delivered" as const, deliveredAt: days(-daysAgo), paid: true });

  it(`lets a customer ask for a return within ${RETURN_WINDOW_DAYS} days of delivery, to the moment`, () => {
    expect(transition(delivered(RETURN_WINDOW_DAYS), { type: "request_return", actor: "customer", at: NOW }).ok).toBe(true);
    const late = { status: "delivered" as const, deliveredAt: new Date(days(-RETURN_WINDOW_DAYS).getTime() - 1), paid: true };
    expect(transition(late, { type: "request_return", actor: "customer", at: NOW })).toMatchObject({ ok: false, reason: "return_window_closed" });
  });

  it("lets staff accept a late return", () => {
    expect(transition(delivered(40), { type: "request_return", actor: "staff", at: NOW }).ok).toBe(true);
  });

  it("refuses a customer return when the delivery date is unknown", () => {
    expect(transition({ status: "delivered", paid: true }, { type: "request_return", actor: "customer", at: NOW })).toMatchObject({ ok: false, reason: "return_window_closed" });
  });
});

describe("refunds and final states", () => {
  it("has nothing to refund on an order cancelled before payment", () => {
    expect(transition({ status: "cancelled", paid: false }, { type: "refund", actor: "system", at: NOW })).toMatchObject({ ok: false, reason: "nothing_to_refund" });
    expect(isFinal({ status: "cancelled", paid: false })).toBe(true);
    expect(isFinal({ status: "cancelled", paid: true })).toBe(false);
    expect(isFinal({ status: "refunded", paid: true })).toBe(true);
  });

  it("releases stock on every path out of an unpaid order, and refunds a paid cancellation", () => {
    for (const type of ["payment_failed", "payment_expired", "cancel"] as const) {
      const actor = type === "cancel" ? "customer" : "system";
      const result = transition(snapshot("pending_payment"), { type, actor, at: NOW });
      expect(result.ok && result.effects).toContain("release_stock");
      expect(result.ok && result.effects).not.toContain("issue_refund");
    }
    const paidCancel = transition(snapshot("paid"), { type: "cancel", actor: "customer", at: NOW });
    expect(paidCancel.ok && paidCancel.effects).toEqual(expect.arrayContaining(["release_stock", "issue_refund"]));
  });

  it("every status except refunded can still move, and refunded cannot", () => {
    for (const status of ORDER_STATUSES) {
      const moves = ACTORS.flatMap((actor) => availableEvents(snapshot(status), actor, NOW));
      if (status === "refunded") expect(moves).toEqual([]);
      else expect(moves.length).toBeGreaterThan(0);
    }
  });

  it("reaches every status from pending_payment", () => {
    const reached = new Set<OrderStatus>(["pending_payment"]);
    const queue: OrderStatus[] = ["pending_payment"];
    while (queue.length > 0) {
      const status = queue.shift()!;
      for (const [from, , to] of EXPECTED) {
        if (from === status && !reached.has(to)) {
          reached.add(to);
          queue.push(to);
        }
      }
    }
    expect([...reached].sort()).toEqual([...ORDER_STATUSES].sort());
  });

  it("offers a customer only the actions that will work", () => {
    expect(availableEvents(snapshot("pending_payment"), "customer", NOW)).toEqual(["cancel"]);
    expect(availableEvents(snapshot("paid"), "customer", NOW)).toEqual(["cancel"]);
    expect(availableEvents(snapshot("packed"), "customer", NOW)).toEqual([]);
    expect(availableEvents(snapshot("delivered"), "customer", NOW)).toEqual(["request_return"]);
  });
});
