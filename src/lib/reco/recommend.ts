/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Turns graph walk scores into a diversified, category-balanced recommendation shelf.
 */

import type { Neighbours } from "@/lib/reco/graph";
import { randomWalkWithRestart, strongestSeed } from "@/lib/reco/walk";
import { diversify } from "@/lib/search/rerank";

/**
 * The Taste Graph (A2): from walk scores to a shelf of recommendations.
 *
 * Post-processing, in order, as the plan lists it:
 *
 *   1. Remove what should not be recommended: the seeds themselves (the
 *      shopper has just seen them), products already bought, unavailable ones.
 *   2. Diversify with Maximal Marginal Relevance (the same function search uses,
 *      src/lib/search/rerank.ts), so near-identical products do not fill a row.
 *   3. Balance categories: no category takes more than `maxCategoryShare` of the
 *      shelf while others have candidates, so a shopper who looked at three lamps
 *      is shown a lamp, a side table and a rug rather than eight lamps.
 *   4. Explain each result by its strongest seed: "Because you viewed …".
 */

export type Recommendation = { productId: string; score: number; because: string | null };

export type RecommendOptions = {
  exclude?: ReadonlySet<string>;
  categoryOf: (productId: string) => string | undefined;
  similarity: (a: string, b: string) => number;
  limit?: number;
  maxCategoryShare?: number;
  restart?: number;
  iterations?: number;
};

export function recommend(transitions: Neighbours, seeds: ReadonlyMap<string, number>, options: RecommendOptions): Recommendation[] {
  const limit = options.limit ?? 8;
  const maxShare = options.maxCategoryShare ?? 0.5;
  const exclude = options.exclude ?? new Set<string>();

  const scores = randomWalkWithRestart(transitions, seeds, { restart: options.restart, iterations: options.iterations });
  const ranked = [...scores]
    .filter(([id, score]) => score > 0 && !seeds.has(id) && !exclude.has(id) && options.categoryOf(id) !== undefined)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([id, score]) => ({ id, score }));

  const diverse = diversify(ranked, (a, b) => options.similarity(a.id, b.id), { depth: Math.max(limit * 3, 24) });

  const categoriesAvailable = new Set(diverse.map((item) => options.categoryOf(item.id)));
  const cap = categoriesAvailable.size > 1 ? Math.max(1, Math.floor(limit * maxShare)) : limit;
  const perCategory = new Map<string, number>();
  const shelf: { id: string; score: number }[] = [];
  const overflow: { id: string; score: number }[] = [];
  for (const item of diverse) {
    const category = options.categoryOf(item.id)!;
    if ((perCategory.get(category) ?? 0) < cap) {
      shelf.push(item);
      perCategory.set(category, (perCategory.get(category) ?? 0) + 1);
    } else {
      overflow.push(item);
    }
    if (shelf.length === limit) break;
  }
  // Only if balance leaves the shelf short does a category exceed its share.
  for (const item of overflow) {
    if (shelf.length === limit) break;
    shelf.push(item);
  }

  return shelf.map((item) => ({ productId: item.id, score: item.score, because: strongestSeed(transitions, seeds, item.id) }));
}
