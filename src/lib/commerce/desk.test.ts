/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Tests for the order desk's queues and the actions it offers staff.
 */

import { describe, expect, it } from "vitest";

import { DESK_STATUSES, DESK_VIEWS, needsReason, oldestFirst, staffActions, viewCounts } from "@/lib/commerce/desk";
import { ORDER_STATUSES } from "@/lib/commerce/order-state";

const NOW = new Date("2026-09-19T12:00:00Z");

describe("order desk", () => {
  it("puts every status in exactly one queue besides 'all'", () => {
    for (const status of ORDER_STATUSES) {
      const holding = DESK_VIEWS.filter((view) => view !== "all" && DESK_STATUSES[view]!.includes(status));
      expect(holding, status).toHaveLength(1);
    }
  });

  it("counts each view from the counts per status", () => {
    const counts = viewCounts({ paid: 3, packed: 1, delivered: 5, cancelled: 2 });
    expect(counts).toMatchObject({ pack: 3, ship: 1, transit: 0, closed: 7, all: 11 });
  });

  it("works queues oldest first and looks up newest first", () => {
    expect(oldestFirst("pack")).toBe(true);
    expect(oldestFirst("all")).toBe(false);
  });

  it("offers staff only what the state machine allows, next step first and cancelling last", () => {
    expect(staffActions({ status: "paid", paid: true }, NOW)).toEqual(["pack", "cancel"]);
    expect(staffActions({ status: "packed", paid: true }, NOW)).toEqual(["ship"]);
    expect(staffActions({ status: "shipped", paid: true }, NOW)).toEqual(["deliver"]);
    // Staff may accept a return after the customer's 14 days.
    expect(staffActions({ status: "delivered", paid: true, deliveredAt: new Date("2026-06-01") }, NOW)).toEqual(["request_return"]);
    expect(staffActions({ status: "return_requested", paid: true }, NOW)).toEqual(["receive_return"]);
    expect(staffActions({ status: "returned", paid: true }, NOW)).toEqual(["refund"]);
    // Payment is the payment system's, never a person's.
    expect(staffActions({ status: "pending_payment" }, NOW)).toEqual(["cancel"]);
    expect(staffActions({ status: "refunded", paid: true }, NOW)).toEqual([]);
  });

  it("asks for a reason before the actions that cannot be undone", () => {
    expect(needsReason("cancel")).toBe(true);
    expect(needsReason("refund")).toBe(true);
    expect(needsReason("ship")).toBe(false);
  });
});
