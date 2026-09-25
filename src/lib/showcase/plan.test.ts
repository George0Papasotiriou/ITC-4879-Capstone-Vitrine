/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Tests for the showcase plan: the accounts, the password switch, and stories the state machine accepts.
 */

import { describe, expect, it } from "vitest";

import { ROLES } from "@/lib/auth/roles";
import { transition, type OrderSnapshot, type OrderStatus } from "@/lib/commerce/order-state";
import {
  isShowcaseEmail,
  MIN_SHOWCASE_PASSWORD,
  ORDER_STORIES,
  SHOWCASE_ACCOUNTS,
  showcasePassword,
  stillReturnable,
  storySteps,
  TICKET_STORIES,
  watchTarget,
  type OrderStage,
} from "@/lib/showcase/plan";

const NOW = new Date("2026-09-26T12:00:00Z");

/** Plays a story through the real state machine and says where it ends. */
function play(steps: ReturnType<typeof storySteps>["steps"]): { status: OrderStatus; deliveredAt: Date | null } {
  let order: OrderSnapshot = { status: "pending_payment", paid: false, deliveredAt: null };
  for (const step of steps) {
    const result = transition(order, { type: step.event, actor: step.actor, at: step.at });
    if (!result.ok) throw new Error(`${step.event} refused from ${order.status}: ${result.reason}`);
    order = { status: result.to, paid: order.paid === true || result.to === "paid", deliveredAt: result.to === "delivered" ? step.at : order.deliveredAt };
  }
  return { status: order.status, deliveredAt: order.deliveredAt ?? null };
}

const ENDS: Record<OrderStage, OrderStatus> = {
  reviewed: "delivered",
  returnable: "delivered",
  shipped: "shipped",
  paid: "paid",
  returned: "refunded",
  cancelled: "cancelled",
};

describe("the showcase accounts", () => {
  it("has at least two accounts for every role", () => {
    for (const role of ROLES) expect(SHOWCASE_ACCOUNTS.filter((account) => account.role === role).length, role).toBeGreaterThanOrEqual(2);
  });

  it("uses addresses that can never receive mail, each once", () => {
    const emails = SHOWCASE_ACCOUNTS.map((account) => account.email);
    expect(new Set(emails).size).toBe(emails.length);
    for (const email of emails) expect(email.endsWith(".test"), email).toBe(true);
    expect(isShowcaseEmail("Admin1@vitrine.test")).toBe(true);
    expect(isShowcaseEmail("someone@example.com")).toBe(false);
  });

  it("gives every account something of its own to show", () => {
    for (const account of SHOWCASE_ACCOUNTS) expect(ORDER_STORIES.some((story) => story.owner === account.key), account.key).toBe(true);
  });
});

describe("the password switch", () => {
  it("stays off without a password, or with a short one", () => {
    expect(showcasePassword(undefined)).toEqual({ ok: false, reason: "unset" });
    expect(showcasePassword("   ")).toEqual({ ok: false, reason: "unset" });
    expect(showcasePassword("x".repeat(MIN_SHOWCASE_PASSWORD - 1))).toEqual({ ok: false, reason: "too_short" });
  });

  it("uses the password as given, without the spaces a paste brings", () => {
    expect(showcasePassword("  a long enough showcase password \n")).toEqual({ ok: true, password: "a long enough showcase password" });
  });
});

describe("the order stories", () => {
  it("are all moves the state machine accepts, ending where the story says", () => {
    for (const story of ORDER_STORIES) {
      const { steps } = storySteps(story, NOW);
      expect(play(steps).status, story.key).toBe(ENDS[story.stage]);
    }
  });

  it("happened in order, and all before now", () => {
    for (const story of ORDER_STORIES) {
      const { placedAt, steps, reviewAt } = storySteps(story, NOW);
      let previous = placedAt.getTime();
      for (const step of steps) {
        expect(step.at.getTime(), `${story.key} ${step.event}`).toBeGreaterThan(previous);
        previous = step.at.getTime();
      }
      expect(previous, story.key).toBeLessThanOrEqual(NOW.getTime());
      if (reviewAt !== null) {
        expect(reviewAt.getTime(), story.key).toBeGreaterThan(previous);
        expect(reviewAt.getTime(), story.key).toBeLessThanOrEqual(NOW.getTime());
      }
    }
  });

  it("leaves a returnable order inside the return window, whenever the showcase is deployed", () => {
    for (const now of [NOW, new Date("2027-03-01T08:00:00Z")]) {
      for (const story of ORDER_STORIES.filter((entry) => entry.stage === "returnable")) {
        const { deliveredAt } = play(storySteps(story, now).steps);
        expect(deliveredAt, story.key).not.toBeNull();
        expect(stillReturnable(deliveredAt!, now), story.key).toBe(true);
      }
    }
  });

  it("reviews only what was delivered and kept", () => {
    for (const story of ORDER_STORIES) {
      if (story.review !== undefined) expect(story.stage, story.key).toBe("reviewed");
      if (story.stage === "reviewed") expect(storySteps(story, NOW).reviewAt, story.key).not.toBeNull();
    }
  });
});

describe("the desk and the watches", () => {
  it("ties a conversation only to an order of the same person", () => {
    for (const ticket of TICKET_STORIES) {
      if (ticket.order === undefined) continue;
      const order = ORDER_STORIES.find((story) => story.key === ticket.order);
      expect(order, ticket.key).toBeDefined();
      expect("account" in ticket.from && ticket.from.account === order!.owner, ticket.key).toBe(true);
    }
  });

  it("covers every state the desk shows: answered, closed with a score, handed over, waiting", () => {
    expect(TICKET_STORIES.some((ticket) => ticket.reply !== undefined && ticket.close === undefined)).toBe(true);
    expect(TICKET_STORIES.some((ticket) => ticket.close !== undefined)).toBe(true);
    expect(TICKET_STORIES.some((ticket) => ticket.concierge !== undefined)).toBe(true);
    expect(TICKET_STORIES.some((ticket) => ticket.reply === undefined && ticket.close === undefined && ticket.concierge === undefined)).toBe(true);
  });

  it("waits for a price a little under today's, in whole euros", () => {
    expect(watchTarget(12_900, 0.1)).toBe(11_600);
    expect(watchTarget(12_900, 0.1)).toBeLessThan(12_900);
    expect(watchTarget(150, 0.5)).toBe(100);
  });
});
