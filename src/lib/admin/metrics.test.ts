/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Unit tests for the dashboard definitions: periods, day buckets, sales, funnel and return reasons.
 */

import { describe, expect, it } from "vitest";

import { dayKey, funnel, parsePeriod, periodFor, returnReasonCode, salesByDay, salesSummary, share, weekEnding } from "@/lib/admin/metrics";

const NOW = new Date("2026-09-19T15:30:00Z");

describe("periods", () => {
  it("accepts only 7, 30 or 90 days, and falls back to 30", () => {
    expect(parsePeriod("7")).toBe(7);
    expect(parsePeriod(90)).toBe(90);
    expect(parsePeriod("365")).toBe(30);
    expect(parsePeriod(undefined)).toBe(30);
  });

  it("runs from midnight UTC of the first day to now, with a key per day", () => {
    const period = periodFor(7, NOW);
    expect(period.from.toISOString()).toBe("2026-09-13T00:00:00.000Z");
    expect(period.to).toEqual(NOW);
    expect(period.dayKeys).toEqual(["2026-09-13", "2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18", "2026-09-19"]);
  });

  it("names days in UTC, whatever the time zone", () => {
    expect(dayKey(new Date("2026-09-18T23:59:59Z"))).toBe("2026-09-18");
  });

  it("covers seven whole days up to the end of the week it reports on", () => {
    const week = weekEnding("2026-09-20");
    expect(week.from.toISOString()).toBe("2026-09-14T00:00:00.000Z");
    expect(week.to.toISOString()).toBe("2026-09-20T23:59:59.999Z");
    expect(week.dayKeys).toHaveLength(7);
    expect(week.dayKeys.at(-1)).toBe("2026-09-20");
  });

  it("refuses a day it cannot read", () => {
    expect(() => weekEnding("last monday")).toThrow(/YYYY-MM-DD/);
  });
});

describe("sales", () => {
  const period = periodFor(7, NOW);
  const orders = [
    { totalCents: 10000, vatCents: 1935, paidAt: new Date("2026-09-19T10:00:00Z") },
    { totalCents: 5001, vatCents: 968, paidAt: new Date("2026-09-19T11:00:00Z") },
    { totalCents: 20000, vatCents: 3871, paidAt: new Date("2026-09-14T09:00:00Z") },
    // Paid before the period, and never paid: neither counts.
    { totalCents: 99999, vatCents: 0, paidAt: new Date("2026-09-12T23:59:59Z") },
    { totalCents: 77777, vatCents: 0, paidAt: null },
  ];
  // Refunded in the period although paid before it: a refund counts when it happens.
  const refunds = [{ totalCents: 99999, refundedAt: new Date("2026-09-15T12:00:00Z") }];

  it("counts a sale on the day it was paid and a refund on the day it was made", () => {
    expect(salesSummary(orders, refunds, period)).toEqual({
      orders: 3,
      grossCents: 35001,
      vatCents: 6774,
      averageCents: 11667,
      refunds: 1,
      refundsCents: 99999,
      netCents: 35001 - 99999,
    });
  });

  it("has an average of zero, not NaN, with no orders", () => {
    expect(salesSummary([], [], period).averageCents).toBe(0);
  });

  it("puts sales in their UTC day and fills the quiet days with zero", () => {
    const days = salesByDay(orders, period);
    expect(days).toHaveLength(7);
    expect(days.find((entry) => entry.day === "2026-09-19")?.value).toBe(15001);
    expect(days.find((entry) => entry.day === "2026-09-14")?.value).toBe(20000);
    expect(days.find((entry) => entry.day === "2026-09-16")?.value).toBe(0);
  });
});

describe("funnel", () => {
  it("gives each step's share of the one before and of the first", () => {
    expect(funnel([
      { key: "carts", count: 40 },
      { key: "placed", count: 20 },
      { key: "paid", count: 15 },
    ])).toEqual([
      { key: "carts", count: 40, fromPrevious: null, fromFirst: null },
      { key: "placed", count: 20, fromPrevious: 0.5, fromFirst: 0.5 },
      { key: "paid", count: 15, fromPrevious: 0.75, fromFirst: 0.375 },
    ]);
  });

  it("does not divide by zero", () => {
    expect(share(3, 0)).toBeNull();
    expect(funnel([{ key: "carts", count: 0 }, { key: "placed", count: 0 }])[1]!.fromPrevious).toBeNull();
  });
});

describe("returnReasonCode", () => {
  it("reads the code before the note", () => {
    expect(returnReasonCode("damaged: the box was crushed")).toBe("damaged");
    expect(returnReasonCode("changed_mind")).toBe("changed_mind");
    expect(returnReasonCode("Customer phoned")).toBe("unknown");
    expect(returnReasonCode(null)).toBe("unknown");
  });
});
