/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Unit tests for synthetic shopper session simulation.
 */

import { describe, expect, it } from "vitest";

import { behaviourEdges } from "@/lib/reco/graph";
import { appeal, PERSONAS, simulateSessions, type SimProduct } from "@/lib/reco/simulate";

const product = (id: string, category: string, colors: string[], materials: string[], euros: number): SimProduct => ({
  id,
  category,
  kind: category.toUpperCase(),
  colors,
  materials,
  brand: null,
  attributes: {},
  priceCents: euros * 100,
});

const catalogue: SimProduct[] = [
  product("oak-table", "tables", ["brown"], ["oak", "wood"], 140),
  product("linen-lamp", "lighting", ["white"], ["linen"], 120),
  product("beige-chair", "seating", ["beige"], ["wood"], 180),
  product("black-pendant", "lighting", ["black"], ["metal"], 240),
  product("steel-stool", "seating", ["grey"], ["metal"], 220),
  product("glass-table", "tables", ["silver"], ["glass", "metal"], 300),
  product("velvet-sofa", "seating", ["red"], ["velvet"], 900),
  product("wool-rug", "rugs", ["brown"], ["wool"], 500),
];

const NOW = Date.UTC(2026, 8, 13);

describe("simulateSessions", () => {
  it("is deterministic for a seed and marks sessions with synthetic ids", () => {
    const a = simulateSessions(catalogue, { sessions: 40, now: NOW, seed: 1 });
    const b = simulateSessions(catalogue, { sessions: 40, now: NOW, seed: 1 });
    expect(a).toEqual(b);
    expect(a.every((event) => event.actorId.startsWith("sim-") && event.sessionId.startsWith("sim-session-"))).toBe(true);
  });

  it("keeps every event inside the simulated period and in time order within a session", () => {
    const events = simulateSessions(catalogue, { sessions: 60, now: NOW, days: 30 });
    for (const event of events) expect(event.at).toBeLessThanOrEqual(NOW + 3_600_000);
    const bySession = new Map<string, number[]>();
    for (const event of events) bySession.set(event.sessionId, [...(bySession.get(event.sessionId) ?? []), event.at]);
    for (const times of bySession.values()) expect(times).toEqual([...times].sort((x, y) => x - y));
  });

  it("produces behaviour the graph can learn: products a persona likes end up connected", () => {
    const events = simulateSessions(catalogue, { sessions: 800, now: NOW, seed: 7 });
    const { normalised } = behaviourEdges(
      events.map((event) => ({ ...event })),
      { now: NOW },
    );
    const warm = normalised.get("oak-table")!;
    // The warm-minimal persona browses oak, linen and beige pieces together; the industrial one does not.
    expect(warm.get("linen-lamp") ?? 0).toBeGreaterThan(warm.get("black-pendant") ?? 0);
    const industrial = normalised.get("black-pendant")!;
    expect(industrial.get("steel-stool") ?? 0).toBeGreaterThan(industrial.get("linen-lamp") ?? 0);
  });

  it("includes carts and purchases, fewer than views", () => {
    const events = simulateSessions(catalogue, { sessions: 400, now: NOW });
    const count = (kind: string) => events.filter((event) => event.kind === kind).length;
    expect(count("cart")).toBeGreaterThan(0);
    expect(count("purchase")).toBeGreaterThan(0);
    expect(count("purchase")).toBeLessThan(count("cart"));
    expect(count("cart")).toBeLessThan(count("view"));
  });

  it("scores a persona's own style above a clashing one", () => {
    const warm = PERSONAS.find((persona) => persona.id === "warm-minimal")!;
    expect(appeal(warm, catalogue[0]!)).toBeGreaterThan(appeal(warm, catalogue[3]!));
  });
});
