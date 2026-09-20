/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Tests for the weekly report: the figures it prints, and that nothing it draws falls off the page.
 */

import { describe, expect, it } from "vitest";

import type { DashboardOverview } from "@/lib/admin/dashboard-store";
import { A4 } from "@/lib/report/pdf";
import { summarize, weeklyReportPdf, type AiSpendSummary } from "@/lib/report/weekly";

const overview: DashboardOverview = {
  sales: { orders: 42, grossCents: 1_413_963, vatCents: 245_511, averageCents: 33_666, refunds: 2, refundsCents: 44_651, netCents: 1_369_312 },
  salesByDay: ["2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18", "2026-09-19", "2026-09-20"].map((day, index) => ({
    day,
    value: index * 20_000,
  })),
  statuses: [{ status: "delivered", count: 30 }],
  countries: [{ country: "GR", orders: 30, grossCents: 900_000, vatCents: 170_000 }],
  topProducts: [
    { productId: "p1", slug: "canova", title: "Canova 3-seater sofa in oatmeal linen with a very long name that will not fit the column", units: 4, revenueCents: 207_800 },
    // A Greek title: the standard fonts cannot show it, and the report must still be written.
    { productId: "p2", slug: "kanapes", title: "Καναπές Canova", units: 2, revenueCents: 103_900 },
  ],
  funnel: [
    { key: "carts", count: 100, fromPrevious: null, fromFirst: 1 },
    { key: "placed", count: 50, fromPrevious: 0.5, fromFirst: 0.5 },
    { key: "paid", count: 42, fromPrevious: 0.84, fromFirst: 0.42 },
    { key: "delivered", count: 30, fromPrevious: 0.714, fromFirst: 0.3 },
  ],
  returns: { requested: 3, deliveries: 30, rate: 0.1, reasons: [{ reason: "damaged", count: 2 }] },
  reviews: { published: 12, average: 4.4, hidden: 1 },
  searches: {
    total: 240,
    zeroResults: 12,
    zeroShare: 0.05,
    top: [{ query: "sofa", count: 30, averageResults: 12.5 }],
    zero: [{ query: "waterbed", count: 7 }],
  },
  lowStock: { count: 2, items: [{ productId: "p1", title: "Canova 3-seater", sku: "VT-CAN-3S", stock: 1 }] },
};

const ai: AiSpendSummary = {
  byFeature: [
    { feature: "concierge", calls: 120, costMicros: 42_000, inputTokens: 90_000, outputTokens: 8_000, unpriced: 0 },
    { feature: "embedding", calls: 300, costMicros: 0, inputTokens: 120_000, outputTokens: 0, unpriced: 300 },
  ],
  totalMicros: 42_000,
  calls: 420,
  demoCalls: 15,
  unpriced: 300,
};

const support = {
  opened: 9,
  answered: 8,
  lateFirstReplies: 1,
  medianFirstReplyMinutes: 95,
  csat: { count: 4, average: 4.5 },
  byTopic: [
    { topic: "delivery", count: 5 },
    { topic: "returns", count: 4 },
  ],
};

const build = () =>
  Buffer.from(weeklyReportPdf({ period: { start: "2026-09-14", end: "2026-09-20" }, generatedAt: new Date("2026-09-21T06:00:00Z"), overview, ai, support })).toString("latin1");

/** Every string the report prints, in the order it is drawn. */
function printed(file: string): string[] {
  return [...file.matchAll(/\((.*?)\) Tj/g)].map((match) => match[1]!);
}

describe("weekly report", () => {
  it("prints the week's headline figures", () => {
    const words = printed(build()).join(" | ");
    // The month's short name is the platform's ("Sep" or "Sept"); the date is what matters.
    expect(words).toMatch(/Weekly report, 14 Sept? to 20 Sept?/);
    expect(words).toContain("Gross sales, paid orders");
    // The euro sign is character 128 in the encoding the standard fonts use.
    expect(words).toContain(`${String.fromCharCode(128)}14,139.63`);
    expect(words).toContain("Orders paid");
    expect(words).toContain("Searches that found nothing");
    expect(words).toContain("waterbed");
    expect(words).toContain("Concierge");
    // The desk's week, when there is one (docs/adr/021).
    expect(words).toContain("Questions asked");
    expect(words).toContain("95 min");
    // Parentheses are escaped in a PDF literal, which is what `printed` reads.
    expect(words).toContain("4.5 of 5");
  });

  it("says what AI cost in euros, from millionths", () => {
    // 42,000 millionths of a euro is four cents.
    expect(printed(build()).join(" | ")).toContain(`${String.fromCharCode(128)}0.04`);
  });

  it("cuts a title that is too long, and still writes a row whose title it cannot show", () => {
    const words = printed(build());
    const long = words.find((word) => word.startsWith("Canova 3-seater sofa"));
    expect(long).toBeDefined();
    expect(long!.endsWith("...")).toBe(true);
    expect(words.filter((word) => word === "4")).not.toHaveLength(0);
    // The Greek title is dropped by the encoding, but its figures are still printed.
    expect(words.join(" | ")).toContain(`${String.fromCharCode(128)}1,039.00`);
  });

  it("keeps everything it draws inside the page", () => {
    const file = build();
    const positions = [...file.matchAll(/1 0 0 1 (-?[\d.]+) (-?[\d.]+) Tm/g)].map((match) => [Number(match[1]), Number(match[2])] as const);
    expect(positions.length).toBeGreaterThan(30);
    for (const [x, y] of positions) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(A4.width);
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(A4.height);
    }

    const rects = [...file.matchAll(/(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) re f/g)].map((match) => match.slice(1, 5).map(Number));
    for (const [x, y, width, height] of rects) {
      expect(x!).toBeGreaterThanOrEqual(0);
      expect(x! + width!).toBeLessThanOrEqual(A4.width);
      expect(y!).toBeGreaterThanOrEqual(0);
      expect(y! + height!).toBeLessThanOrEqual(A4.height);
    }
  });

  it("runs onto a second page rather than off the bottom of the first", () => {
    const file = build();
    const count = Number(/\/Count (\d+)/.exec(file)![1]);
    expect(count).toBeGreaterThanOrEqual(2);
  });

  it("stores the figures the admin page lists", () => {
    expect(summarize({ overview, ai, support })).toEqual({
      salesCents: 1_413_963,
      ticketsOpened: 9,
      csatAverage: 4.5,
      orders: 42,
      refundsCents: 44_651,
      returnsRequested: 3,
      reviewsPublished: 12,
      searches: 240,
      zeroResultShare: 0.05,
      aiMicros: 42_000,
      aiCalls: 420,
    });
  });
});
