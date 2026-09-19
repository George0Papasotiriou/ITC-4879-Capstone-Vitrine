/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Unit tests for demo order plans: every plan is a life the state machine allows, in time order, and never in the future.
 */

import { describe, expect, it } from "vitest";

import { demoPlacedAt, pickWeighted, planDemoOrder } from "@/lib/commerce/demo-orders";
import { transition, type OrderSnapshot, type OrderStatus } from "@/lib/commerce/order-state";
import { RETURN_REASONS } from "@/lib/commerce/returns";
import { seededRandom } from "@/lib/reco/simulate";

const NOW = new Date("2026-09-19T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

/** Plays a plan through the real state machine, as the script does through the store. */
function replay(steps: ReturnType<typeof planDemoOrder>["steps"]) {
  let order: OrderSnapshot = { status: "pending_payment", paid: false, deliveredAt: null };
  for (const step of steps) {
    const result = transition(order, { type: step.event, actor: step.actor, at: step.at });
    if (!result.ok) throw new Error(`${step.event} by ${step.actor} refused from ${order.status}: ${result.reason}`);
    order = {
      status: result.to,
      paid: order.paid === true || result.to === "paid",
      deliveredAt: result.to === "delivered" ? step.at : order.deliveredAt,
    };
  }
  return order;
}

describe("planDemoOrder", () => {
  const random = seededRandom(7);
  const plans = Array.from({ length: 2000 }, () => {
    const placedAt = demoPlacedAt(random, NOW, 60);
    return { placedAt, plan: planDemoOrder(random, placedAt, NOW) };
  });

  it("only plans lives the state machine allows", () => {
    for (const { plan } of plans) expect(() => replay(plan.steps)).not.toThrow();
  });

  it("keeps steps in time order, after the order was placed and never after now", () => {
    for (const { placedAt, plan } of plans) {
      let previous = placedAt.getTime();
      for (const step of plan.steps) {
        expect(step.at.getTime()).toBeGreaterThanOrEqual(previous);
        expect(step.at.getTime()).toBeLessThanOrEqual(NOW.getTime());
        previous = step.at.getTime();
      }
    }
  });

  it("reviews only delivered orders that were kept, after delivery", () => {
    const reviewed = plans.filter(({ plan }) => plan.review !== null);
    expect(reviewed.length).toBeGreaterThan(0);
    for (const { plan } of reviewed) {
      const last = plan.steps.at(-1)!;
      expect(last.event).toBe("deliver");
      expect(plan.review!.at.getTime()).toBeGreaterThan(last.at.getTime());
      expect(plan.review!.at.getTime()).toBeLessThanOrEqual(NOW.getTime());
    }
  });

  it("gives every return a known reason code", () => {
    const returns = plans.flatMap(({ plan }) => plan.steps.filter((step) => step.event === "request_return"));
    expect(returns.length).toBeGreaterThan(0);
    for (const step of returns) expect(RETURN_REASONS).toContain(step.reason);
  });

  it("leaves orders at every step, as a running shop has them", () => {
    const statuses = new Set<OrderStatus>(plans.map(({ plan }) => replay(plan.steps).status));
    expect([...statuses].sort()).toEqual(
      ["cancelled", "delivered", "packed", "paid", "pending_payment", "refunded", "return_requested", "returned", "shipped"].sort(),
    );
  });

  it("plans the same lives from the same seed", () => {
    const again = seededRandom(7);
    const first = Array.from({ length: 50 }, () => planDemoOrder(again, demoPlacedAt(again, NOW, 60), NOW));
    expect(first).toEqual(plans.slice(0, 50).map(({ plan }) => plan));
  });
});

describe("demoPlacedAt", () => {
  it("places orders within the last days asked for, never in the future", () => {
    const random = seededRandom(3);
    for (let i = 0; i < 1000; i += 1) {
      const at = demoPlacedAt(random, NOW, 30).getTime();
      expect(at).toBeLessThanOrEqual(NOW.getTime());
      expect(at).toBeGreaterThan(NOW.getTime() - 31 * DAY);
    }
  });
});

describe("pickWeighted", () => {
  it("follows the weights", () => {
    const random = seededRandom(11);
    const counts = { a: 0, b: 0 };
    for (let i = 0; i < 10_000; i += 1) counts[pickWeighted(random, [["a", 0.8], ["b", 0.2]] as const)] += 1;
    expect(counts.a / 10_000).toBeCloseTo(0.8, 1);
  });
});
