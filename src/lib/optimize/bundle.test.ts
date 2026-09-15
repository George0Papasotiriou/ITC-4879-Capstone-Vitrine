/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Unit tests for the Budget Stylist optimiser against exhaustive and greedy baselines.
 */

import { describe, expect, it } from "vitest";

import {
  alternativesFor,
  bundleUtility,
  exhaustiveBundles,
  greedyBundle,
  optimizeBundles,
  type BundleProblem,
  type Candidate,
} from "@/lib/optimize/bundle";

/** Mulberry32: a small seeded generator, so every random instance is reproducible. */
function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Item = Candidate & { style: number };

/** A random instance: compatibility is a deterministic function of hidden style values. */
function instance(seed: number, { slots = 4, perSlot = 5, optionalShare = 0.25, budgetFactor = 0.6 } = {}): BundleProblem<Item> {
  const rng = random(seed);
  const slotList = Array.from({ length: slots }, (_, s) => ({
    id: `slot${s}`,
    required: rng() >= optionalShare,
    candidates: Array.from({ length: 1 + Math.floor(rng() * perSlot) }, (_, i) => ({
      id: `s${s}i${i}`,
      priceCents: 1000 + Math.floor(rng() * 50) * 1000,
      affinity: Math.round((rng() * 2 - 0.3) * 1000) / 1000,
      style: rng(),
    })),
  }));
  const typical = slotList.reduce((sum, slot) => sum + Math.max(...slot.candidates.map((c) => c.priceCents)), 0);
  return {
    slots: slotList,
    budgetCents: Math.round(typical * budgetFactor),
    lambda: Math.round(rng() * 150) / 100,
    compatibility: (x, y) => 1 - 2 * Math.abs(x.style - y.style),
  };
}

const orderedPicks = (problem: BundleProblem<Item>, picks: Record<string, Item | null>) => problem.slots.map((slot) => picks[slot.id] ?? null);

describe("optimizeBundles: correctness against exhaustive search", () => {
  it("finds the optimal bundle on 300 random small instances", () => {
    let checked = 0;
    for (let seed = 1; seed <= 300; seed += 1) {
      const problem = instance(seed);
      const truth = exhaustiveBundles(problem);
      const { bundles } = optimizeBundles(problem, { timeLimitMs: 10_000 });
      if (truth.length === 0) {
        expect(bundles, `seed ${seed}`).toEqual([]);
        continue;
      }
      checked += 1;
      expect(bundles[0]!.utility, `seed ${seed}`).toBeCloseTo(truth[0]!.utility, 9);
      expect(bundles[0]!.method).toBe("exact");
    }
    expect(checked).toBeGreaterThan(200);
  });

  it("finds the best bundle that differs in two slots, then the best that differs from both", () => {
    for (let seed = 1; seed <= 150; seed += 1) {
      const problem = instance(seed, { slots: 4, perSlot: 4 });
      const all = exhaustiveBundles(problem);
      const { bundles } = optimizeBundles(problem, { timeLimitMs: 10_000 });
      const differ = (a: (Item | null)[], b: (Item | null)[]) => a.filter((x, i) => (x?.id ?? null) !== (b[i]?.id ?? null)).length;

      // The reference: pick greedily from the exhaustive list under the same rule.
      const expected: (Item | null)[][] = [];
      for (const candidate of all) {
        if (expected.length === 3) break;
        if (expected.every((chosen) => differ(candidate.picks, chosen) >= 2)) expected.push(candidate.picks);
      }

      expect(bundles.length, `seed ${seed}`).toBe(expected.length);
      bundles.forEach((bundle, rank) => {
        expect(bundle.utility, `seed ${seed} rank ${rank}`).toBeCloseTo(bundleUtility(problem, expected[rank]!), 9);
      });
    }
  });
});

describe("optimizeBundles: constraints always hold", () => {
  it("never exceeds the budget, fills every required slot, and keeps bundles two slots apart", () => {
    for (let seed = 1000; seed < 1200; seed += 1) {
      const problem = instance(seed, { slots: 5, perSlot: 12, budgetFactor: 0.3 + (seed % 7) / 10 });
      const { bundles } = optimizeBundles(problem);
      for (const bundle of bundles) {
        expect(bundle.priceCents).toBeLessThanOrEqual(problem.budgetCents);
        const picks = orderedPicks(problem, bundle.picks);
        expect(picks.reduce((sum, pick) => sum + (pick?.priceCents ?? 0), 0)).toBe(bundle.priceCents);
        problem.slots.forEach((slot, s) => {
          if (slot.required) expect(picks[s], `seed ${seed} slot ${slot.id}`).not.toBeNull();
          if (picks[s] !== null) expect(slot.candidates).toContain(picks[s]);
        });
        expect(bundle.utility).toBeCloseTo(bundleUtility(problem, picks), 9);
        expect(bundle.utility).toBeCloseTo(bundle.individual + problem.lambda * bundle.pairwise, 9);
      }
      for (let i = 0; i < bundles.length; i += 1) {
        for (let j = i + 1; j < bundles.length; j += 1) {
          const a = orderedPicks(problem, bundles[i]!.picks);
          const b = orderedPicks(problem, bundles[j]!.picks);
          expect(a.filter((x, k) => (x?.id ?? null) !== (b[k]?.id ?? null)).length).toBeGreaterThanOrEqual(2);
        }
      }
      // Ranked best first.
      for (let i = 1; i < bundles.length; i += 1) expect(bundles[i]!.utility).toBeLessThanOrEqual(bundles[i - 1]!.utility + 1e-9);
    }
  });

  it("returns nothing when a required slot has no candidates or nothing is affordable", () => {
    const empty = instance(7);
    expect(optimizeBundles({ ...empty, slots: [...empty.slots, { id: "x", required: true, candidates: [] }] }).bundles).toEqual([]);
    const tooPoor = instance(8);
    const withRequired = { ...tooPoor, slots: tooPoor.slots.map((slot) => ({ ...slot, required: true })), budgetCents: 500 };
    expect(optimizeBundles(withRequired).bundles).toEqual([]);
  });

  it("leaves an optional slot empty when every option would lower the utility", () => {
    const chair = { id: "chair", priceCents: 10_000, affinity: 1, style: 0 };
    const clashingRug = { id: "rug", priceCents: 1_000, affinity: 0.1, style: 1 };
    const problem: BundleProblem<Item> = {
      slots: [
        { id: "chair", required: true, candidates: [chair] },
        { id: "rug", required: false, candidates: [clashingRug] },
      ],
      budgetCents: 100_000,
      lambda: 1,
      compatibility: (x, y) => 1 - 2 * Math.abs(x.style - y.style),
    };
    const [best] = optimizeBundles(problem).bundles;
    expect(best!.picks).toEqual({ chair, rug: null });
  });

  it("rejects a negative lambda or a non-integer budget", () => {
    expect(() => optimizeBundles({ ...instance(3), lambda: -1 })).toThrow(RangeError);
    expect(() => optimizeBundles({ ...instance(3), budgetCents: 10.5 })).toThrow(RangeError);
  });
});

describe("optimizeBundles: how compatibility changes the answer", () => {
  const sofa = (id: string, affinity: number, style: number) => ({ id, priceCents: 50_000, affinity, style });
  const rug = (id: string, affinity: number, style: number) => ({ id, priceCents: 10_000, affinity, style });
  const problem = (lambda: number): BundleProblem<Item> => ({
    slots: [
      { id: "sofa", required: true, candidates: [sofa("modern", 1.0, 0.0), sofa("classic", 0.9, 1.0)] },
      { id: "rug", required: true, candidates: [rug("persian", 1.0, 1.0), rug("jute", 0.2, 0.0)] },
    ],
    budgetCents: 100_000,
    lambda,
    compatibility: (x, y) => 1 - 2 * Math.abs(x.style - y.style),
  });

  it("with λ = 0 picks the individually best pieces even if they clash", () => {
    const [best] = optimizeBundles(problem(0)).bundles;
    expect([best!.picks.sofa!.id, best!.picks.rug!.id]).toEqual(["modern", "persian"]);
  });

  it("with λ = 1 trades a little individual score for pieces that go together", () => {
    const [best] = optimizeBundles(problem(1)).bundles;
    expect([best!.picks.sofa!.id, best!.picks.rug!.id]).toEqual(["classic", "persian"]);
  });
});

describe("baselines and helpers", () => {
  it("never beats the optimiser, and the optimiser beats it on some instances", () => {
    let strictlyBetter = 0;
    for (let seed = 1; seed <= 200; seed += 1) {
      const problem = instance(seed, { slots: 4, perSlot: 8 });
      const greedy = greedyBundle(problem);
      const [best] = optimizeBundles(problem).bundles;
      if (greedy === null || best === undefined) continue;
      expect(greedy.priceCents).toBeLessThanOrEqual(problem.budgetCents);
      expect(greedy.utility).toBeLessThanOrEqual(best.utility + 1e-9);
      if (best.utility > greedy.utility + 1e-6) strictlyBetter += 1;
    }
    expect(strictlyBetter).toBeGreaterThan(20);
  });

  it("lists affordable swaps for one slot, best first, never the current piece", () => {
    const problem = instance(42, { slots: 3, perSlot: 6, budgetFactor: 1 });
    const [best] = optimizeBundles(problem).bundles;
    const slotId = problem.slots.find((slot) => slot.candidates.length > 1)!.id;
    const swaps = alternativesFor(problem, best!, slotId);
    expect(swaps.length).toBeGreaterThan(0);
    for (const swap of swaps) {
      expect(swap.candidate.id).not.toBe(best!.picks[slotId]?.id);
      expect(swap.priceCents).toBeLessThanOrEqual(problem.budgetCents);
      expect(swap.utility).toBeLessThanOrEqual(best!.utility + 1e-9);
    }
    for (let i = 1; i < swaps.length; i += 1) expect(swaps[i]!.utility).toBeLessThanOrEqual(swaps[i - 1]!.utility);
  });
});

describe("performance", () => {
  it("solves four slots of twenty candidates exactly within the plan's latency budget", () => {
    const times: number[] = [];
    for (let seed = 5000; seed < 5040; seed += 1) {
      const rng = random(seed);
      const problem: BundleProblem<Item> = {
        slots: Array.from({ length: 4 }, (_, s) => ({
          id: `slot${s}`,
          required: true,
          candidates: Array.from({ length: 20 }, (_, i) => ({
            id: `${s}-${i}`,
            priceCents: 5_000 + Math.floor(rng() * 60) * 1_000,
            affinity: rng(),
            style: rng(),
          })),
        })),
        budgetCents: 120_000,
        lambda: 0.5,
        compatibility: (x, y) => 1 - 2 * Math.abs(x.style - y.style),
      };
      const { stats, bundles } = optimizeBundles(problem, { timeLimitMs: 5_000 });
      expect(stats.exact).toBe(true);
      expect(bundles.length).toBeGreaterThan(0);
      times.push(stats.elapsedMs);
    }
    times.sort((a, b) => a - b);
    const p95 = times[Math.floor(times.length * 0.95)]!;
    // Plan: p95 ≤ 300 ms with K = 20 and 4 slots, for all three bundles.
    expect(p95).toBeLessThan(300);
  });

  it("falls back to beam search when the time budget runs out, and says so", () => {
    let clock = 0;
    const problem = instance(99, { slots: 5, perSlot: 12, budgetFactor: 1 });
    const result = optimizeBundles(problem, { timeLimitMs: 1, now: () => (clock += 5) });
    expect(result.stats.exact).toBe(false);
    expect(result.bundles.length).toBeGreaterThan(0);
    for (const bundle of result.bundles) {
      expect(bundle.method).toBe("beam");
      expect(bundle.priceCents).toBeLessThanOrEqual(problem.budgetCents);
    }
  });
});
