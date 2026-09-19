/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Tests for the return deadline, which must agree with the state machine's window.
 */

import { describe, expect, it } from "vitest";

import { transition } from "@/lib/commerce/order-state";
import { returnDeadline } from "@/lib/commerce/returns";

describe("returnDeadline", () => {
  it("is 14 days after delivery, and agrees with what the state machine allows", () => {
    const deliveredAt = new Date("2026-09-01T10:00:00Z");
    const deadline = returnDeadline(deliveredAt);
    expect(deadline.toISOString()).toBe("2026-09-15T10:00:00.000Z");
    const order = { status: "delivered" as const, paid: true, deliveredAt };
    expect(transition(order, { type: "request_return", actor: "customer", at: deadline }).ok).toBe(true);
    expect(transition(order, { type: "request_return", actor: "customer", at: new Date(deadline.getTime() + 1) }).ok).toBe(false);
  });
});
