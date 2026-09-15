/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Unit tests for Taste Graph edge building and blending.
 */

import { describe, expect, it } from "vitest";

import { behaviourEdges, blend, contentEdges, ENGAGED_DWELL_SECONDS, eventWeight, type InteractionEvent } from "@/lib/reco/graph";

const NOW = Date.UTC(2026, 8, 13, 12);
const MIN = 60_000;
const DAY = 24 * 60 * MIN;

const event = (sessionId: string, productId: string, kind: InteractionEvent["kind"], minutesAgo: number, dwellSeconds?: number): InteractionEvent => ({
  sessionId,
  productId,
  kind,
  at: NOW - minutesAgo * MIN,
  dwellSeconds,
});

describe("eventWeight", () => {
  it("weights stronger signals more", () => {
    expect([eventWeight("view"), eventWeight("cart"), eventWeight("purchase")]).toEqual([1, 3, 6]);
    expect(eventWeight("search_click")).toBe(1.5);
  });

  it("counts a dwell as interest only past the engagement threshold", () => {
    expect(eventWeight("dwell", ENGAGED_DWELL_SECONDS)).toBe(2);
    expect(eventWeight("dwell", 5)).toBe(0.5);
    expect(eventWeight("dwell", null)).toBe(0.5);
  });
});

describe("behaviourEdges", () => {
  it("relates two products in one session with the geometric mean of their weights", () => {
    const { raw } = behaviourEdges([event("s1", "A", "view", 0), event("s1", "B", "purchase", 0)], { now: NOW });
    expect(raw.get("A")!.get("B")).toBeCloseTo(Math.sqrt(6), 12);
    expect(raw.get("B")!.get("A")).toBeCloseTo(Math.sqrt(6), 12);
  });

  it("decays with the time between events and with their age", () => {
    const near = behaviourEdges([event("s", "A", "view", 1), event("s", "B", "view", 0)], { now: NOW }).raw.get("A")!.get("B")!;
    const far = behaviourEdges([event("s", "A", "view", 20), event("s", "B", "view", 0)], { now: NOW }).raw.get("A")!.get("B")!;
    expect(near).toBeCloseTo(Math.exp(-1 / 10), 12);
    expect(far).toBeCloseTo(Math.exp(-20 / 10), 12);

    const monthOld = behaviourEdges([event("s", "A", "view", 30 * 24 * 60), event("s", "B", "view", 30 * 24 * 60)], { now: NOW }).raw.get("A")!.get("B")!;
    expect(monthOld).toBeCloseTo(0.5, 12);
  });

  it("ignores pairs outside the window, across sessions, and a product with itself", () => {
    const { raw, counts } = behaviourEdges(
      [
        event("s1", "A", "view", 60),
        event("s1", "B", "view", 0), // an hour later: outside the 30-minute window
        event("s2", "C", "view", 0),
        event("s3", "D", "view", 1),
        event("s3", "D", "cart", 0),
      ],
      { now: NOW },
    );
    expect(raw.size).toBe(0);
    expect(counts.get("D")).toBe(2);
  });

  it("damps popular products by normalising with the degrees", () => {
    // P (popular) co-occurs with X, Y and Z; X and Y also co-occur once.
    const events = [
      event("a", "P", "view", 0), event("a", "X", "view", 0),
      event("b", "P", "view", 0), event("b", "Y", "view", 0),
      event("c", "P", "view", 0), event("c", "Z", "view", 0),
      event("d", "X", "view", 0), event("d", "Y", "view", 0),
    ];
    const { raw, normalised, degree } = behaviourEdges(events, { now: NOW });
    expect(degree.get("P")).toBeCloseTo(3, 12);
    expect(normalised.get("X")!.get("P")).toBeCloseTo(1 / Math.sqrt(2 * 3), 12);
    expect(normalised.get("X")!.get("Y")).toBeCloseTo(1 / Math.sqrt(2 * 2), 12);
    // Raw weights tie, but after normalisation X is closer to Y than to the popular P.
    expect(raw.get("X")!.get("P")).toBe(raw.get("X")!.get("Y"));
    expect(normalised.get("X")!.get("Y")!).toBeGreaterThan(normalised.get("X")!.get("P")!);
    // Symmetric.
    expect(normalised.get("P")!.get("X")).toBeCloseTo(normalised.get("X")!.get("P")!, 12);
  });
});

const unit = (values: number[]) => {
  const size = Math.hypot(...values);
  return Float64Array.from(values.map((v) => v / size));
};

describe("contentEdges", () => {
  it("keeps the top M neighbours above the threshold, best first", () => {
    const items = [
      { id: "a", vector: unit([1, 0, 0]) },
      { id: "b", vector: unit([0.9, 0.1, 0]) },
      { id: "c", vector: unit([0.5, 0.5, 0]) },
      { id: "d", vector: unit([0, 0, 1]) },
    ];
    const edges = contentEdges(items, { topM: 2, minSimilarity: 0.2 });
    expect([...edges.get("a")!.keys()]).toEqual(["b", "c"]);
    expect(edges.get("d")!.size).toBe(0);
  });

  it("compares only within a group when groups are given", () => {
    const edges = contentEdges([
      { id: "a", vector: unit([1, 0]), group: "lighting" },
      { id: "b", vector: unit([1, 0]), group: "rugs" },
    ]);
    expect(edges.get("a")!.size).toBe(0);
  });
});

describe("blend", () => {
  const behaviour = new Map([["hot", new Map([["x", 0.8]])], ["cold", new Map<string, number>()]]);
  const content = new Map([["hot", new Map([["y", 0.9]])], ["cold", new Map([["y", 0.9], ["z", 0.3]])]]);

  it("leans on behaviour for well-known products and on content for new ones", () => {
    const counts = new Map([["hot", 45], ["cold", 0]]);
    const blended = blend(behaviour, content, counts, { kappa: 5 });
    const alpha = 45 / 50;
    const hotX = alpha * 0.8;
    const hotY = (1 - alpha) * 0.9;
    expect(blended.get("hot")!.get("x")).toBeCloseTo(hotX / (hotX + hotY), 12);
    expect(blended.get("cold")!.get("y")).toBeCloseTo(0.9 / 1.2, 12);
  });

  it("produces probability rows: positive and summing to one, top K only", () => {
    const wide = new Map([["p", new Map(Array.from({ length: 80 }, (_, i) => [`n${i}`, 1 / (i + 1)] as [string, number]))]]);
    const blended = blend(wide, new Map(), new Map([["p", 100]]), { topK: 50 });
    const row = blended.get("p")!;
    expect(row.size).toBe(50);
    expect([...row.values()].reduce((sum, v) => sum + v, 0)).toBeCloseTo(1, 12);
    expect(row.has("n0")).toBe(true);
    expect(row.has("n79")).toBe(false);
  });
});

describe("scale", () => {
  it("builds edges for 2,000 sessions quickly", () => {
    const events: InteractionEvent[] = [];
    for (let s = 0; s < 2_000; s += 1) {
      for (let e = 0; e < 10; e += 1) events.push(event(`s${s}`, `p${(s * 7 + e * 13) % 500}`, e % 5 === 0 ? "cart" : "view", 10 - e));
    }
    const started = performance.now();
    const { normalised } = behaviourEdges(events, { now: NOW + DAY });
    expect(normalised.size).toBeGreaterThan(100);
    expect(performance.now() - started).toBeLessThan(2_000);
  });
});
