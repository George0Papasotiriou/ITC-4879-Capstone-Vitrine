/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Unit tests for the random walk, recommendations and This-or-That.
 */

import { describe, expect, it } from "vitest";

import type { Neighbours } from "@/lib/reco/graph";
import { recommend } from "@/lib/reco/recommend";
import { nextPair, orthonormalBasis, preferenceScore, preferenceVector } from "@/lib/reco/this-or-that";
import { randomWalkWithRestart, seedVector, strongestSeed } from "@/lib/reco/walk";

const graph = (rows: Record<string, Record<string, number>>): Neighbours =>
  new Map(Object.entries(rows).map(([id, row]) => [id, new Map(Object.entries(row))]));

const total = (scores: Map<string, number>) => [...scores.values()].reduce((sum, v) => sum + v, 0);

describe("seedVector", () => {
  const now = Date.UTC(2026, 8, 13);
  it("sums to one and weights purchases above views", () => {
    const seeds = seedVector([
      { productId: "a", kind: "view", at: now },
      { productId: "b", kind: "purchase", at: now },
    ], { now });
    expect(total(seeds)).toBeCloseTo(1, 12);
    expect(seeds.get("b")).toBeCloseTo(6 / 7, 12);
  });

  it("halves the weight of an event per half-life", () => {
    const seeds = seedVector([
      { productId: "old", kind: "view", at: now - 3 * 24 * 3_600_000 },
      { productId: "new", kind: "view", at: now },
    ], { now });
    expect(seeds.get("new")! / seeds.get("old")!).toBeCloseTo(2, 12);
  });

  it("is empty for no events", () => {
    expect(seedVector([], { now }).size).toBe(0);
  });
});

describe("randomWalkWithRestart", () => {
  it("matches the iteration worked by hand on two nodes", () => {
    const P = graph({ A: { B: 1 }, B: { A: 1 } });
    const seeds = new Map([["A", 1]]);
    const one = randomWalkWithRestart(P, seeds, { restart: 0.3, iterations: 1 });
    expect(one.get("B")).toBeCloseTo(0.7, 12);
    expect(one.get("A")).toBeCloseTo(0.3, 12);
    const two = randomWalkWithRestart(P, seeds, { restart: 0.3, iterations: 2 });
    expect(two.get("A")).toBeCloseTo(0.79, 12);
    expect(two.get("B")).toBeCloseTo(0.21, 12);
  });

  it("conserves probability mass, including mass that reaches a dead end", () => {
    const P = graph({ A: { B: 0.5, C: 0.5 }, B: { D: 1 }, C: {} });
    const seeds = new Map([["A", 0.6], ["B", 0.4]]);
    for (let iterations = 1; iterations <= 6; iterations += 1) {
      expect(total(randomWalkWithRestart(P, seeds, { iterations }))).toBeCloseTo(1, 12);
    }
  });

  it("scores nearer products higher", () => {
    const P = graph({ A: { B: 1 }, B: { C: 1 }, C: { D: 1 }, D: { A: 1 } });
    const scores = randomWalkWithRestart(P, new Map([["A", 1]]), { iterations: 5 });
    expect(scores.get("B")!).toBeGreaterThan(scores.get("C")!);
    expect(scores.get("C")!).toBeGreaterThan(scores.get("D") ?? 0);
  });

  it("with restart 1 never leaves the seeds", () => {
    const P = graph({ A: { B: 1 } });
    expect([...randomWalkWithRestart(P, new Map([["A", 1]]), { restart: 1 })]).toEqual([["A", 1]]);
    expect(() => randomWalkWithRestart(P, new Map(), { restart: 0 })).toThrow(RangeError);
  });
});

describe("strongestSeed", () => {
  it("credits the seed with the strongest one- or two-hop path", () => {
    const P = graph({ lamp: { table: 0.9, rug: 0.1 }, sofa: { rug: 0.2, cushion: 0.8 }, cushion: { rug: 1 } });
    const seeds = new Map([["lamp", 0.5], ["sofa", 0.5]]);
    expect(strongestSeed(P, seeds, "table")).toBe("lamp");
    // sofa → cushion → rug (0.8) beats lamp → rug (0.1) and sofa → rug (0.2).
    expect(strongestSeed(P, seeds, "rug")).toBe("sofa");
    expect(strongestSeed(P, seeds, "unrelated")).toBeNull();
  });
});

describe("recommend", () => {
  const category: Record<string, string> = { l1: "lighting", l2: "lighting", l3: "lighting", l4: "lighting", t1: "tables", r1: "rugs", seen: "lighting", bought: "tables" };
  const P = graph({
    seen: { l1: 0.3, l2: 0.25, l3: 0.2, l4: 0.1, t1: 0.1, bought: 0.05 },
    l1: { t1: 1 },
    t1: { r1: 1 },
  });
  const options = {
    categoryOf: (id: string) => category[id],
    similarity: (a: string, b: string) => (category[a] === category[b] ? 0.1 : 0),
    exclude: new Set(["bought"]),
  };

  it("never recommends the seeds or excluded products, and explains each result", () => {
    const shelf = recommend(P, new Map([["seen", 1]]), { ...options, limit: 4 });
    const ids = shelf.map((item) => item.productId);
    expect(ids).not.toContain("seen");
    expect(ids).not.toContain("bought");
    expect(shelf.every((item) => item.because === "seen")).toBe(true);
  });

  it("balances categories when other categories have candidates", () => {
    const shelf = recommend(P, new Map([["seen", 1]]), { ...options, limit: 4, maxCategoryShare: 0.5 });
    const lighting = shelf.filter((item) => category[item.productId] === "lighting").length;
    expect(lighting).toBeLessThanOrEqual(2);
    expect(shelf.map((item) => item.productId)).toEqual(expect.arrayContaining(["t1", "r1"]));
  });

  it("fills the shelf past the category cap rather than leaving it short", () => {
    const onlyLighting = graph({ seen: { l1: 0.4, l2: 0.3, l3: 0.3 } });
    const shelf = recommend(onlyLighting, new Map([["seen", 1]]), { ...options, limit: 3 });
    expect(shelf).toHaveLength(3);
  });

  it("returns nothing for a shopper with no seeds", () => {
    expect(recommend(P, new Map(), options)).toEqual([]);
  });
});

describe("This-or-That", () => {
  function rng(seed: number) {
    let state = seed;
    return () => {
      state = (state * 1_103_515_245 + 12_345) % 2 ** 31;
      return state / 2 ** 31;
    };
  }

  it("builds the preference as chosen minus rejected", () => {
    const p = preferenceVector([Float64Array.of(1, 0)], [Float64Array.of(0, 1)], 2);
    expect([...p]).toEqual([1, -1]);
    expect(preferenceScore(p, Float64Array.of(1, 0))).toBeCloseTo((1 / Math.SQRT2 + 1) / 2, 12);
    expect(preferenceScore(new Float64Array(2), Float64Array.of(1, 0))).toBe(0.5);
  });

  it("builds an orthonormal basis and skips dependent vectors", () => {
    const basis = orthonormalBasis([Float64Array.of(1, 1, 0), Float64Array.of(2, 2, 0), Float64Array.of(1, 0, 0)]);
    expect(basis).toHaveLength(2);
    const dot = (a: Float64Array, b: Float64Array) => a.reduce((sum, v, i) => sum + v * b[i]!, 0);
    expect(dot(basis[0]!, basis[0]!)).toBeCloseTo(1, 12);
    expect(dot(basis[0]!, basis[1]!)).toBeCloseTo(0, 12);
  });

  it("asks along a direction not yet covered", () => {
    const candidates = [
      { id: "x+", vector: Float64Array.of(1, 0) },
      { id: "x-", vector: Float64Array.of(-1, 0) },
      { id: "y+", vector: Float64Array.of(0, 1) },
      { id: "y-", vector: Float64Array.of(0, -1) },
    ];
    // Having asked along x, the next question should be along y.
    const pair = nextPair(candidates, Float64Array.of(1, 0), [Float64Array.of(2, 0)], new Set(["x+", "x-"]));
    expect(pair!.sort()).toEqual(["y+", "y-"]);
  });

  it("learns a hidden taste from a handful of choices", () => {
    const random = rng(11);
    const dims = 8;
    const candidates = Array.from({ length: 48 }, (_, i) => ({ id: `p${i}`, vector: Float64Array.from({ length: dims }, () => random() - 0.5) }));
    const hidden = Float64Array.from({ length: dims }, (_, i) => (i < 2 ? 1 : 0));
    const taste = (v: Float64Array) => v[0]! + v[1]!;
    const asked: Float64Array[] = [];

    const chosen: Float64Array[] = [];
    const rejected: Float64Array[] = [];
    const shown = new Set<string>();
    for (let round = 0; round < 8; round += 1) {
      const p = chosen.length === 0 ? new Float64Array(dims) : preferenceVector(chosen, rejected, dims);
      const pair = nextPair(candidates, p, asked, shown)!;
      expect(pair[0]).not.toBe(pair[1]);
      for (const id of pair) {
        expect(shown.has(id)).toBe(false);
        shown.add(id);
      }
      const [a, b] = pair.map((id) => candidates.find((candidate) => candidate.id === id)!.vector) as [Float64Array, Float64Array];
      asked.push(a.map((v, k) => v - b[k]!));
      if (taste(a) >= taste(b)) {
        chosen.push(a);
        rejected.push(b);
      } else {
        chosen.push(b);
        rejected.push(a);
      }
    }

    const learned = preferenceVector(chosen, rejected, dims);
    const cosine = [...learned].reduce((sum, v, i) => sum + v * hidden[i]!, 0) / (Math.hypot(...learned) * Math.hypot(...hidden));
    expect(cosine).toBeGreaterThan(0.6);
  });

  it("stops when fewer than two unseen products remain", () => {
    expect(nextPair([{ id: "a", vector: Float64Array.of(1) }], Float64Array.of(0), [], new Set())).toBeNull();
  });
});
