/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Checking an AI judge against a person: a balanced blind sample, and how far the two agree.
 */

import type { Grade } from "@/lib/search/metrics";

/**
 * docs/adr/049. E1's relevance grades come from an AI judge — a language
 * model grading each (query, product) pair 0–3 on the same rubric a person
 * uses at /admin/labeling, from the product's facts alone. That is a published
 * method (Thomas et al., SIGIR 2024; Faggioli et al., ICTIR 2023), but a
 * judge's grades are only as good as their agreement with people, so a person
 * grades a sample blind and the agreement is reported beside the scores.
 *
 * THE SAMPLE. Stratified by the judge's grade — as many 0s, 1s, 2s and 3s as
 * there are — because a random sample of a pool that is mostly 0s would say
 * little about the 3s, which matter most for NDCG. Drawn with a seeded
 * shuffle, so the same pool always gives the same sample.
 *
 * THE AGREEMENT. Exact agreement is the share graded the same. Grades are
 * ordered, so being one apart is a smaller disagreement than three apart:
 * Cohen's quadratically weighted kappa counts each disagreement by the square
 * of its distance and compares the total with what two independent judges
 * with the same habits would produce by chance:
 *
 *   κ_w = 1 − Σ w_ij O_ij / Σ w_ij E_ij,     w_ij = (i − j)² / (k − 1)²
 *
 * O is the table of observed pairs (judge grade i, person grade j), E the
 * table expected from the two sets of grades alone (row total × column total
 * / n), and k = 4 grades. κ_w = 1 is perfect agreement, 0 no better than
 * chance; 0.61–0.80 is usually read as substantial, above 0.80 almost perfect.
 */

export type JudgedPair = { query: string; locale: "en" | "el"; slug: string; grade: Grade };

/** mulberry32: a small seeded generator, so a sample can be drawn again exactly. */
function generator(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** A Fisher–Yates shuffle with the seeded generator. */
function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [copy[index], copy[other]] = [copy[other]!, copy[index]!];
  }
  return copy;
}

/**
 * `size` pairs, as even across the four grades as the pool allows: each grade
 * gets size/4, and what a scarce grade cannot fill goes to the others in turn.
 * The input order does not matter: pairs are sorted before the shuffle.
 */
export function checkSample(pairs: readonly JudgedPair[], size = 40, seed = 4949): JudgedPair[] {
  const random = generator(seed);
  const key = (pair: JudgedPair) => `${pair.locale}|${pair.query}|${pair.slug}`;
  const byGrade = ([0, 1, 2, 3] as const).map((grade) =>
    shuffled(
      pairs.filter((pair) => pair.grade === grade).sort((a, b) => key(a).localeCompare(key(b))),
      random,
    ),
  );
  const target = Math.min(size, pairs.length);
  const taken = [0, 0, 0, 0];
  let total = 0;
  // Round-robin over the grades: one from each in turn, skipping a grade that has run out.
  while (total < target) {
    let progressed = false;
    for (let grade = 0; grade < 4 && total < target; grade += 1) {
      if (taken[grade]! < byGrade[grade]!.length) {
        taken[grade]! += 1;
        total += 1;
        progressed = true;
      }
    }
    if (!progressed) break;
  }
  const sample = byGrade.flatMap((list, grade) => list.slice(0, taken[grade]));
  // Shown in a shuffled order, so the grades do not come in runs a person could notice.
  return shuffled(sample, random);
}

export type Agreement = { n: number; exact: number; withinOne: number; kappa: number | null; table: number[][] };

/** Agreement between the judge's grades and a person's on the same pairs (see above). */
export function agreement(pairs: readonly { judge: Grade; person: Grade }[]): Agreement {
  const k = 4;
  const table = Array.from({ length: k }, () => Array.from({ length: k }, () => 0));
  for (const pair of pairs) table[pair.judge]![pair.person]! += 1;
  const n = pairs.length;
  if (n === 0) return { n, exact: 0, withinOne: 0, kappa: null, table };
  const exact = pairs.filter((pair) => pair.judge === pair.person).length / n;
  const withinOne = pairs.filter((pair) => Math.abs(pair.judge - pair.person) <= 1).length / n;
  const rows = table.map((row) => row.reduce((sum, value) => sum + value, 0));
  const columns = Array.from({ length: k }, (_, j) => table.reduce((sum, row) => sum + row[j]!, 0));
  let observed = 0;
  let expected = 0;
  for (let i = 0; i < k; i += 1) {
    for (let j = 0; j < k; j += 1) {
      const weight = (i - j) ** 2 / (k - 1) ** 2;
      observed += weight * table[i]![j]!;
      expected += (weight * rows[i]! * columns[j]!) / n;
    }
  }
  // Both judges gave a single grade throughout: kappa is undefined, not 1 or 0.
  const kappa = expected === 0 ? null : 1 - observed / expected;
  return { n, exact, withinOne, kappa, table };
}
