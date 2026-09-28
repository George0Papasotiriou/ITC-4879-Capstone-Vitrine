/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Tests for the Concierge and recommendation figures, held against hand-counted rows.
 */

import { describe, expect, it } from "vitest";

import { conciergeSummary, isShelf, percentile, recoSummary, type ConciergeRow, type RecoRow } from "@/lib/admin/events";
import { periodFor } from "@/lib/admin/metrics";

const now = new Date("2026-09-26T12:00:00Z");
const period = periodFor(7, now);
const at = (day: string) => new Date(`2026-09-${day}T10:00:00Z`);

describe("percentile", () => {
  it("is the nearest-rank value: always one that was measured", () => {
    const values = [900, 100, 500, 300, 700];
    expect(percentile(values, 50)).toBe(500);
    expect(percentile(values, 95)).toBe(900);
    expect(percentile(values, 0)).toBe(100);
    expect(percentile([42], 95)).toBe(42);
    expect(percentile([], 50)).toBeNull();
  });

  it("matches a hand count on twenty turns", () => {
    const values = Array.from({ length: 20 }, (_, index) => (index + 1) * 100);
    // 95% of 20 is 19: the 19th smallest.
    expect(percentile(values, 95)).toBe(1_900);
    expect(percentile(values, 50)).toBe(1_000);
  });
});

describe("conciergeSummary", () => {
  const rows: ConciergeRow[] = [
    { kind: "turn", tool: null, outcome: "ok", latencyMs: 800, occurredAt: at("24") },
    { kind: "turn", tool: null, outcome: "ok", latencyMs: 1_200, occurredAt: at("24") },
    { kind: "turn", tool: null, outcome: "ok", latencyMs: 3_000, occurredAt: at("25") },
    { kind: "refused", tool: null, outcome: "credits", latencyMs: null, occurredAt: at("25") },
    { kind: "tool", tool: "add_to_cart", outcome: "ok", latencyMs: 40, occurredAt: at("24") },
    { kind: "tool", tool: "add_to_cart", outcome: "ok", latencyMs: 55, occurredAt: at("25") },
    { kind: "tool", tool: "add_to_cart", outcome: "undone", latencyMs: null, occurredAt: at("25") },
    { kind: "tool", tool: "start_checkout", outcome: "approval_asked", latencyMs: null, occurredAt: at("25") },
    { kind: "tool", tool: "start_checkout", outcome: "approved", latencyMs: null, occurredAt: at("25") },
    { kind: "tool", tool: "remember_preference", outcome: "approval_asked", latencyMs: null, occurredAt: at("25") },
    { kind: "tool", tool: "remember_preference", outcome: "declined", latencyMs: null, occurredAt: at("25") },
    { kind: "tool", tool: "search_products", outcome: "error", latencyMs: 12, occurredAt: at("26") },
    // Before the period: not counted.
    { kind: "turn", tool: null, outcome: "ok", latencyMs: 9_999, occurredAt: new Date("2026-09-01T10:00:00Z") },
  ];
  const summary = conciergeSummary(rows, period);

  it("counts turns per day and refused turns by reason", () => {
    expect(summary.turns).toBe(3);
    expect(summary.refused).toBe(1);
    expect(summary.refusedBy).toEqual([{ reason: "credits", count: 1 }]);
    expect(summary.turnsByDay.find((entry) => entry.day === "2026-09-24")?.value).toBe(2);
    expect(summary.turnsByDay).toHaveLength(7);
  });

  it("reports the turn latency's median and 95th percentile", () => {
    expect(summary.latencyP50).toBe(1_200);
    expect(summary.latencyP95).toBe(3_000);
  });

  it("works out approval and undo rates from the tool rows", () => {
    // One approved, one declined.
    expect(summary.approvalRate).toBe(0.5);
    // One of two successful cart additions undone; remember_preference never ran, so adds nothing.
    expect(summary.undoRate).toBe(0.5);
    expect(summary.tools.find((tool) => tool.tool === "add_to_cart")).toEqual({ tool: "add_to_cart", runs: 2, errors: 0, approvalsAsked: 0, approved: 0, declined: 0, undone: 1 });
    expect(summary.tools.find((tool) => tool.tool === "search_products")?.errors).toBe(1);
  });

  it("says nothing rather than 0% before anything happened", () => {
    const empty = conciergeSummary([], period);
    expect(empty.approvalRate).toBeNull();
    expect(empty.undoRate).toBeNull();
    expect(empty.latencyP50).toBeNull();
  });
});

describe("recoSummary", () => {
  it("gives click-through and add rates per shelf", () => {
    const rows: RecoRow[] = [
      ...Array.from({ length: 10 }, () => ({ shelf: "for-you", kind: "impression" as const, occurredAt: at("25") })),
      ...Array.from({ length: 3 }, () => ({ shelf: "for-you", kind: "click" as const, occurredAt: at("25") })),
      { shelf: "for-you", kind: "add_to_cart", occurredAt: at("25") },
      { shelf: "complete-set", kind: "impression", occurredAt: at("26") },
    ];
    const summary = recoSummary(rows, period);
    expect(summary.shelves).toEqual([
      { shelf: "for-you", impressions: 10, clicks: 3, adds: 1, clickRate: 0.3, addRate: 1 / 3 },
      { shelf: "complete-set", impressions: 1, clicks: 0, adds: 0, clickRate: 0, addRate: null },
    ]);
    expect(summary.clicksByDay.find((entry) => entry.day === "2026-09-25")?.value).toBe(3);
  });

  it("knows its shelves", () => {
    expect(isShelf("complete-set")).toBe(true);
    expect(isShelf("everything")).toBe(false);
  });
});

describe("counted rows", () => {
  it("gives the same figures whether the database counted or the rows came one by one", () => {
    const single: RecoRow[] = Array.from({ length: 4 }, () => ({ shelf: "popular", kind: "click" as const, occurredAt: at("25") }));
    const counted: RecoRow[] = [{ shelf: "popular", kind: "click", occurredAt: new Date("2026-09-25T00:00:00Z"), count: 4 }];
    expect(recoSummary(counted, period)).toEqual(recoSummary(single, period));
    const tools: ConciergeRow[] = [{ kind: "tool", tool: "add_to_cart", outcome: "ok", latencyMs: null, occurredAt: new Date("2026-09-25T00:00:00Z"), count: 5 }];
    expect(conciergeSummary(tools, period).tools[0]?.runs).toBe(5);
  });
});
