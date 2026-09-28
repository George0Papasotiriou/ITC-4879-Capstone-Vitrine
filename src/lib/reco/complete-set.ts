/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * "Complete the set": pieces that go with what is in the cart, from the Taste Graph's neighbour lists.
 */

/**
 * docs/adr/034. The cart is a set being built, so what it needs is what goes
 * *with* its pieces, not more of the same: a second armchair is a substitute
 * for the first, a lamp beside it is a complement. The Taste Graph already
 * stores, per product, its behaviour neighbours (bought or browsed together)
 * and its content neighbours (most alike in category, colour, material, brand
 * and price). From those lists this keeps only pieces from a category the
 * cart does not have yet, so a neighbour can only ever complete the set.
 *
 * Fairness between the cart's pieces. Candidates are taken in turns, one per
 * cart piece per round (round-robin), best-ranked first within each piece's
 * list, so a cart with a sofa and a rug is completed for both rather than
 * filled with what goes with the sofa alone. Behaviour neighbours come before
 * content neighbours in each list, because "people bought these together" is
 * direct evidence of going together, while "looks alike" is a proxy.
 *
 * Every suggestion carries the cart piece it was found from, which is the
 * reason shown to the shopper ("Goes with the oak sideboard") — the real
 * link in the graph, never an invented one.
 */

export type Neighbour = { neighborId: string; kind: "behavior" | "content"; rank: number };

export type SetSuggestion = { productId: string; anchorId: string; source: "behavior" | "content" };

export function completeTheSet(input: {
  /** The cart's products, in cart order. */
  anchors: readonly string[];
  /** Each cart product's stored neighbours (any order; sorted here). Only in-stock, active pieces. */
  neighbours: ReadonlyMap<string, readonly Neighbour[]>;
  categoryOf: (productId: string) => string | undefined;
  limit?: number;
}): SetSuggestion[] {
  const { anchors, neighbours, categoryOf, limit = 4 } = input;
  const cart = new Set(anchors);
  const cartCategories = new Set(anchors.map(categoryOf).filter((category): category is string => category !== undefined));

  // Each anchor's candidates, behaviour first, then by rank, complements only.
  const queues = anchors.map((anchorId) =>
    [...(neighbours.get(anchorId) ?? [])]
      .sort((a, b) => (a.kind === b.kind ? a.rank - b.rank : a.kind === "behavior" ? -1 : 1))
      .filter((candidate) => {
        const category = categoryOf(candidate.neighborId);
        return !cart.has(candidate.neighborId) && category !== undefined && !cartCategories.has(category);
      })
      .map((candidate) => ({ productId: candidate.neighborId, anchorId, source: candidate.kind })),
  );

  const chosen: SetSuggestion[] = [];
  const seen = new Set<string>();
  // One category per suggestion, too: two lamps would be the substitutes this avoids.
  const chosenCategories = new Set<string>();
  const cursors = queues.map(() => 0);
  let progressed = true;
  while (chosen.length < limit && progressed) {
    progressed = false;
    for (let index = 0; index < queues.length && chosen.length < limit; index += 1) {
      const queue = queues[index]!;
      while (cursors[index]! < queue.length) {
        const candidate = queue[cursors[index]!]!;
        cursors[index]! += 1;
        const category = categoryOf(candidate.productId)!;
        if (seen.has(candidate.productId) || chosenCategories.has(category)) continue;
        seen.add(candidate.productId);
        chosenCategories.add(category);
        chosen.push(candidate);
        progressed = true;
        break;
      }
    }
  }
  return chosen;
}
