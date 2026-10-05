/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * E14: the capsule wardrobe optimiser against exhaustive search, greedy, the best-rated pieces and chance, on the shop's real clothes and shoes.
 */

import { mkdir, writeFile } from "node:fs/promises";

import postgres from "postgres";

import { buildCapsule, exhaustiveCapsule, greedyCapsule, capsuleScore, type CapsuleProblem, type CapsuleRole } from "@/lib/optimize/capsule";
import { outfitCompatibility, type Department } from "@/lib/optimize/outfit";
import { CAPSULE_SIZES, CAPSULE_THRESHOLD, createWardrobe, type WardrobeCandidate } from "@/lib/stylist/wardrobe";

/**
 * docs/adr/066, docs/report/evaluations/e14-capsule.md.
 *
 *   pnpm evals:capsule
 *
 * Instances: women's and men's small capsules (8 pieces), budgets from €300
 * to €1,000, and ten seeded draws of 8 candidates per role from each role's
 * 12 best rated (so exhaustive search is possible: up to 351,232 capsules
 * an instance). On each: the optimiser, its greedy start alone, the
 * best-rated pieces that fit the budget, and the mean of 20 random capsules
 * that fit it, against the exhaustive optimum. Then the same methods on the
 * full 12-a-role pools, where only the optimiser and the baselines run.
 */

type Item = WardrobeCandidate & { role: CapsuleRole };

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

/** The best-rated pieces of each role that fit together in the budget: per role in turn, the best rated still affordable. */
function bestRated(problem: CapsuleProblem<Item>): Item[] | null {
  const chosen: Item[] = [];
  let spent = 0;
  for (const [role, count] of Object.entries(problem.counts) as [CapsuleRole, number][]) {
    const pool = problem.candidates.filter((candidate) => candidate.role === role).sort((a, b) => b.affinity - a.affinity);
    for (let k = 0; k < count; k += 1) {
      const open = Object.entries(problem.counts).reduce((sum, [, n]) => sum + n, 0) - chosen.length - 1;
      const cheapest = Math.min(...problem.candidates.map((candidate) => candidate.priceCents));
      const pick = pool.find((candidate) => !chosen.includes(candidate) && spent + candidate.priceCents + open * cheapest <= problem.budgetCents);
      if (pick === undefined) return null;
      chosen.push(pick);
      spent += pick.priceCents;
    }
  }
  return chosen;
}

/** A random capsule that fits the budget (up to 200 tries), or null. */
function randomCapsule(problem: CapsuleProblem<Item>, next: () => number): Item[] | null {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const chosen: Item[] = [];
    for (const [role, count] of Object.entries(problem.counts) as [CapsuleRole, number][]) {
      const pool = problem.candidates.filter((candidate) => candidate.role === role);
      const shuffled = [...pool].sort(() => next() - 0.5);
      chosen.push(...shuffled.slice(0, count));
    }
    if (chosen.reduce((sum, piece) => sum + piece.priceCents, 0) <= problem.budgetCents) return chosen;
  }
  return null;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (url === undefined || url === "") throw new Error("DATABASE_URL is not set; run through `pnpm evals:capsule`.");
  const sql = postgres(url, { max: 4, onnotice: () => {} });
  const wardrobe = createWardrobe(sql);
  const score = (pieces: Item[] | null) => (pieces === null ? null : capsuleScore(pieces, { compatibility: outfitCompatibility, threshold: CAPSULE_THRESHOLD }).outfits);

  const small: { department: Department; budget: number; seed: number; exact: number; ours: number; greedy: number | null; rated: number | null; chance: number | null; oursMs: number; exactMs: number }[] = [];
  const full: { department: Department; budget: number; ours: number; greedy: number | null; rated: number | null; chance: number | null; oursMs: number; possible: number }[] = [];
  const budgets = [30000, 45000, 60000, 80000, 100000];

  for (const department of ["women", "men"] as Department[]) {
    const counts: Partial<Record<CapsuleRole, number>> = CAPSULE_SIZES.small[department];
    const roles = Object.keys(counts) as CapsuleRole[];
    const pool = await wardrobe.candidates(roles, department, "GR");
    const all: Item[] = roles.flatMap((role) => (pool[role] ?? []).map((candidate) => ({ ...candidate, role })));
    const possible = (counts.top ?? 0) * (counts.bottom ?? 0) * (counts.shoes ?? 0) + (counts.dress ?? 0) * (counts.shoes ?? 0);
    console.log(`${department}: ${all.length} candidates (${roles.map((role) => `${role} ${(pool[role] ?? []).length}`).join(", ")}); at most ${possible} outfits`);

    for (const budget of budgets) {
      // The full pools: no exhaustive search, only the methods.
      const problem: CapsuleProblem<Item> = { candidates: all, counts, budgetCents: budget, compatibility: outfitCompatibility, threshold: CAPSULE_THRESHOLD };
      let started = performance.now();
      const ours = buildCapsule(problem);
      const oursMs = performance.now() - started;
      if (ours !== null) {
        const next = random(budget);
        const draws = Array.from({ length: 20 }, () => score(randomCapsule(problem, next))).filter((value): value is number => value !== null);
        full.push({ department, budget, ours: ours.outfits, greedy: greedyCapsule(problem)?.outfits ?? null, rated: score(bestRated(problem)), chance: draws.length === 0 ? null : draws.reduce((a, b) => a + b, 0) / draws.length, oursMs, possible });
      }

      // Ten draws of 8 a role, small enough for exhaustive search.
      for (let seed = 1; seed <= 10; seed += 1) {
        const next = random(seed * 7919 + budget);
        const sample = roles.flatMap((role) => all.filter((candidate) => candidate.role === role).sort(() => next() - 0.5).slice(0, 8));
        const smallProblem: CapsuleProblem<Item> = { ...problem, candidates: sample };
        started = performance.now();
        const exact = exhaustiveCapsule(smallProblem);
        const exactMs = performance.now() - started;
        if (exact === null) continue;
        started = performance.now();
        const found = buildCapsule(smallProblem);
        const foundMs = performance.now() - started;
        const draws = Array.from({ length: 20 }, () => score(randomCapsule(smallProblem, next))).filter((value): value is number => value !== null);
        small.push({
          department,
          budget,
          seed,
          exact: exact.outfits,
          ours: found?.outfits ?? 0,
          greedy: greedyCapsule(smallProblem)?.outfits ?? null,
          rated: score(bestRated(smallProblem)),
          chance: draws.length === 0 ? null : draws.reduce((a, b) => a + b, 0) / draws.length,
          oursMs: foundMs,
          exactMs,
        });
      }
      console.log(`  €${budget / 100}: done`);
    }
  }
  await sql.end();

  const mean = (values: (number | null)[]) => {
    const kept = values.filter((value): value is number => value !== null);
    return kept.length === 0 ? null : kept.reduce((a, b) => a + b, 0) / kept.length;
  };
  const summary = {
    instances: small.length,
    exactRate: small.filter((row) => row.ours === row.exact).length / small.length,
    meanOutfits: { exact: mean(small.map((row) => row.exact)), ours: mean(small.map((row) => row.ours)), greedy: mean(small.map((row) => row.greedy)), bestRated: mean(small.map((row) => row.rated)), chance: mean(small.map((row) => row.chance)) },
    meanGap: mean(small.map((row) => row.exact - row.ours)),
    worstGap: Math.max(...small.map((row) => row.exact - row.ours)),
    medianMs: { ours: [...small.map((row) => row.oursMs)].sort((a, b) => a - b)[Math.floor(small.length / 2)], exact: [...small.map((row) => row.exactMs)].sort((a, b) => a - b)[Math.floor(small.length / 2)] },
  };
  console.log(JSON.stringify(summary, null, 2));
  console.log(full);
  await mkdir("docs/report/evaluations", { recursive: true });
  await writeFile("docs/report/evaluations/e14-capsule.json", `${JSON.stringify({ ranAt: new Date().toISOString(), threshold: CAPSULE_THRESHOLD, summary, full, small }, null, 2)}\n`);
  console.log("Written docs/report/evaluations/e14-capsule.json");
}

void main();
