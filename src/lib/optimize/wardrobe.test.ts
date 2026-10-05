/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Tests for the outfit builder: completing a look around one piece, formality, and the capsule wardrobe against exhaustive search.
 */

import { describe, expect, it } from "vitest";

import { buildCapsule, capsuleScore, exhaustiveCapsule, type CapsuleCandidate, type CapsuleRole } from "@/lib/optimize/capsule";
import { departmentOf } from "@/lib/stylist/wardrobe";
import { completeLook, formality, GO_TOGETHER, outfitCompatibility, rolesToComplete, roleOf, type OutfitCandidate, type OutfitRole } from "@/lib/optimize/outfit";

/** A repeatable random number generator (linear congruential). */
function random(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

describe("an outfit's roles", () => {
  it("names each piece's role and what completes a look around it", () => {
    expect(roleOf("SHIRT")).toBe("top");
    expect(roleOf("SANDAL")).toBe("shoes");
    expect(roleOf("SOFA")).toBeNull();
    expect(rolesToComplete("top", "women").filter((entry) => entry.required).map((entry) => entry.role)).toEqual(["bottom", "shoes"]);
    expect(rolesToComplete("dress", "women").filter((entry) => entry.required).map((entry) => entry.role)).toEqual(["shoes"]);
    expect(rolesToComplete("shoes", "men").filter((entry) => entry.required).map((entry) => entry.role)).toEqual(["top", "bottom"]);
    expect(rolesToComplete("accessory", "women").filter((entry) => entry.required).map((entry) => entry.role)).toEqual(["dress", "shoes"]);
  });

  it("reads formality from the kind and the title's words", () => {
    expect(formality("SHOES", "Men's Leather Formal Lace-Up Shoes")).toBeGreaterThan(formality("SHOES", "Men's Trainers"));
    expect(formality("TOP", "Short Sleeve Pocket Tee")).toBeLessThan(formality("SHIRT", "Silk Blouse"));
    expect(formality("COAT", "Wool Coat Tailored Formal Leather Silk")).toBeLessThanOrEqual(1);
  });
});

const piece = (id: string, role: OutfitRole, priceCents: number, colors: string[], formal: number): OutfitCandidate => ({
  id,
  role,
  priceCents,
  affinity: 1,
  styleVector: new Float64Array([1, 0, 0]),
  colors,
  formality: formal,
});

describe("completing a look", () => {
  it("keeps the piece in every look, fills the required roles within the budget, and prefers matching formality", () => {
    const anchor = piece("tee", "top", 3000, ["white"], 0.3);
    const looks = completeLook({
      anchor,
      roles: [
        { role: "bottom", required: true },
        { role: "shoes", required: true },
      ],
      candidates: {
        bottom: [piece("jeans", "bottom", 5000, ["blue"], 0.25), piece("suit-trousers", "bottom", 9000, ["navy"], 0.9)],
        shoes: [piece("trainers", "shoes", 6000, ["white"], 0.2), piece("oxfords", "shoes", 12000, ["black"], 0.9)],
      },
      budgetCents: 14000,
    });
    expect(looks.length).toBeGreaterThan(0);
    const best = looks[0]!;
    expect(best.picks["anchor:top"]?.id).toBe("tee");
    expect(best.picks.bottom?.id).toBe("jeans");
    expect(best.picks.shoes?.id).toBe("trainers");
    expect(best.priceCents - anchor.priceCents).toBeLessThanOrEqual(14000);
    expect(outfitCompatibility(anchor, piece("x", "shoes", 1, ["white"], 0.3))).toBeGreaterThan(outfitCompatibility(anchor, piece("y", "shoes", 1, ["white"], 1)));
  });

  it("adds an optional extra only when it goes with the piece, however affordable", () => {
    const anchor = piece("dress", "dress", 9000, ["black"], 0.6);
    const shoes = piece("heels", "shoes", 6000, ["black"], 0.7);
    const clashing = { ...piece("daypack", "bag", 3000, ["orange"], 0), styleVector: new Float64Array([0, 1, 0]) };
    const matching = piece("clutch", "bag", 4000, ["black"], 0.65);
    expect(outfitCompatibility(anchor, clashing)).toBeLessThan(GO_TOGETHER);
    expect(outfitCompatibility(anchor, matching)).toBeGreaterThanOrEqual(GO_TOGETHER);
    const roles = [
      { role: "shoes" as const, required: true },
      { role: "bag" as const, required: false },
    ];
    const alone = completeLook({ anchor, roles, candidates: { shoes: [shoes], bag: [clashing] }, budgetCents: 30000 });
    expect(alone[0]!.picks.bag ?? null).toBeNull();
    expect(alone[0]!.picks.shoes?.id).toBe("heels");
    const both = completeLook({ anchor, roles, candidates: { shoes: [shoes], bag: [clashing, matching] }, budgetCents: 30000 });
    expect(both.every((look) => look.picks.bag?.id !== "daypack")).toBe(true);
    expect(both[0]!.picks.bag?.id).toBe("clutch");
  });

  it("knows who a piece is for from its label, its title, or a heel's cut", () => {
    expect(departmentOf({ attributes: { department: "men" }, title_en: "Pocket Tee" })).toBe("men");
    expect(departmentOf({ attributes: {}, title_en: "Men's Baylee Sandal" })).toBe("men");
    expect(departmentOf({ attributes: {}, title_en: "Wedge Close Toe Canvas Espadrille" })).toBe("women");
    expect(departmentOf({ attributes: {}, title_en: "Casual Daypack" })).toBeNull();
  });

  it("finds no look when a required role has nothing to offer", () => {
    expect(completeLook({ anchor: piece("tee", "top", 3000, ["white"], 0.3), roles: [{ role: "bottom", required: true }], candidates: {}, budgetCents: 10000 })).toEqual([]);
  });
});

type Toy = CapsuleCandidate & { key: number };

/** A random capsule instance: candidates per role, a symmetric compatibility table and a budget. */
function instance(seed: number, perRole: number, roles: CapsuleRole[]) {
  const next = random(seed);
  const candidates: Toy[] = [];
  for (const role of roles) for (let i = 0; i < perRole; i += 1) candidates.push({ id: `${role}-${i}`, role, priceCents: 1000 + Math.round(next() * 9000), key: candidates.length });
  const table = candidates.map(() => candidates.map(() => 0));
  for (let i = 0; i < candidates.length; i += 1) {
    for (let j = i + 1; j < candidates.length; j += 1) {
      const value = next();
      table[i]![j] = value;
      table[j]![i] = value;
    }
  }
  const compatibility = (a: Toy, b: Toy) => table[a.key]![b.key]!;
  return { candidates, compatibility, next };
}

describe("the capsule wardrobe", () => {
  it("counts outfits whose every two pieces go together, and dresses with shoes", () => {
    const pieces: Toy[] = [
      { id: "t1", role: "top", priceCents: 1, key: 0 },
      { id: "t2", role: "top", priceCents: 1, key: 1 },
      { id: "b1", role: "bottom", priceCents: 1, key: 2 },
      { id: "s1", role: "shoes", priceCents: 1, key: 3 },
      { id: "d1", role: "dress", priceCents: 1, key: 4 },
    ];
    // Everything goes together except the second top with the shoes.
    const compatibility = (a: Toy, b: Toy) => ((a.id === "t2" && b.id === "s1") || (a.id === "s1" && b.id === "t2") ? 0 : 1);
    expect(capsuleScore(pieces, { compatibility, threshold: 0.5 }).outfits).toBe(2); // t1·b1·s1 and d1·s1
  });

  it("fills exactly the counts, keeps the budget, and finds the exhaustive optimum on small instances", () => {
    let exact = 0;
    let total = 0;
    for (let seed = 1; seed <= 40; seed += 1) {
      const { candidates, compatibility, next } = instance(seed, 6, ["top", "bottom", "shoes"]);
      const problem = { candidates, counts: { top: 3, bottom: 2, shoes: 2 }, budgetCents: 25000 + Math.round(next() * 30000), compatibility, threshold: 0.35 };
      const truth = exhaustiveCapsule(problem);
      const found = buildCapsule(problem);
      if (truth === null) {
        expect(found).toBeNull();
        continue;
      }
      total += 1;
      expect(found).not.toBeNull();
      expect(found!.priceCents).toBeLessThanOrEqual(problem.budgetCents);
      expect(found!.pieces.filter((p) => p.role === "top")).toHaveLength(3);
      expect(found!.pieces.filter((p) => p.role === "shoes")).toHaveLength(2);
      expect(found!.outfits).toBeLessThanOrEqual(truth.outfits);
      if (found!.outfits === truth.outfits) exact += 1;
    }
    // Local search reaches the optimum's number of outfits nearly always; E14 reports the rate on the real catalogue.
    expect(exact / total).toBeGreaterThanOrEqual(0.9);
  });

  it("says when the counts cannot be filled within the budget", () => {
    const { candidates, compatibility } = instance(7, 4, ["top", "bottom", "shoes"]);
    expect(buildCapsule({ candidates, counts: { top: 2, bottom: 2, shoes: 2 }, budgetCents: 1000, compatibility, threshold: 0.3 })).toBeNull();
  });
});
