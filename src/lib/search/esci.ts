/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Evaluation E1 on public data: Amazon's Shopping Queries Dataset (ESCI), its labels as grades and a fixed sample.
 */

import type { Grade } from "@/lib/search/metrics";

/**
 * docs/adr/036 (addendum). The shop's own graded queries (E1) are few and
 * judged by one person; ESCI (Reddy et al., 2022, Apache-2.0) gives thousands
 * of real Amazon queries, each with about twenty products that paid
 * annotators labelled:
 *
 *   E  exact       the product is what was asked for          → grade 3
 *   S  substitute  not it, but could stand in for it          → grade 2
 *   C  complement  goes with it (a case for the phone asked)  → grade 1
 *   I  irrelevant                                             → grade 0
 *
 * The grades reuse the shop's 0–3 scale (metrics.ts), so E and S count as
 * relevant (RELEVANT_FROM = 2) and the same NDCG, MRR and Recall code scores
 * both evaluations. ESCI's own paper weighs S and C far lower (0.1, 0.01);
 * the report says which scale it used.
 */
export const ESCI_GRADES: Readonly<Record<string, Grade>> = { E: 3, S: 2, C: 1, I: 0 };

export function esciGrade(label: string): Grade | null {
  return ESCI_GRADES[label.trim().toUpperCase()] ?? null;
}

/** A small, fast, seedable generator (mulberry32), so a sample is the same on every machine. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * `count` distinct items chosen at random but reproducibly: the items are put
 * in a fixed order first (sorted), then shuffled by Fisher–Yates with the
 * seeded generator, and the first `count` kept. The same ids and seed always
 * give the same sample, whatever order the file listed them in.
 */
export function seededSample<T extends string | number>(items: Iterable<T>, count: number, seed: number): T[] {
  const pool = [...new Set(items)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const random = mulberry32(seed);
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  return pool.slice(0, Math.max(0, count));
}
