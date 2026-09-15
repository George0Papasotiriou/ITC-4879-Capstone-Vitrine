/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Personalised random walk with restart over the Taste Graph.
 */

import { eventWeight, type InteractionKind, type Neighbours } from "@/lib/reco/graph";

/**
 * The Taste Graph (A2): personalising with a random walk with restart.
 *
 * Imagine a shopper wandering the graph: at each step they either follow an
 * edge from where they are, with probability given by the edge weights, or —
 * with probability c — jump back to one of the products they actually looked
 * at recently. The long-run share of time spent at each product is its score.
 * Products close to many of the shopper's recent products, through strong
 * edges, score highest; the restart keeps the walk from drifting to whatever
 * is central in the graph as a whole. This is Personalized PageRank (Haveliwala
 * 2002), also called random walk with restart (Tong et al. 2006), the idea
 * behind Pinterest's Pixie (Eksombatchai et al. 2018).
 *
 * As a fixed-point iteration over the score vector r:
 *
 *   r ← (1 − c) · Pᵀ r + c · s
 *
 *   P  the row-normalised transition matrix (graph.ts, top-50 neighbours)
 *   s  the seed vector: the shopper's recent products, weighted by event type
 *      and recency, summing to 1
 *   c  the restart probability, 0.3
 *
 * Pᵀ r spreads each product's mass along its outgoing edges. Products with no
 * outgoing edges ("dangling") would leak mass out of the walk, so their mass is
 * returned to the seeds, which keeps r a probability distribution.
 *
 * Only a few iterations are needed. Each iteration reaches one hop further, and
 * the contribution of hop k shrinks as (1 − c)^k: after four iterations the
 * fifth hop could add at most 0.7⁵ ≈ 17% of the mass, spread thin. The plan's
 * three to five iterations over precomputed lists keeps a recommendation to a
 * few milliseconds.
 */

export const RESTART_PROBABILITY = 0.3;
export const WALK_ITERATIONS = 4;

export type SeedEvent = { productId: string; kind: InteractionKind; at: number; dwellSeconds?: number | null };

/**
 * The seed vector: s_i ∝ Σ over the shopper's events on i of
 * weight(event) · 0.5^(age / half-life), normalised to sum to 1. With a
 * three-day half-life, what someone looked at this evening outweighs what
 * they browsed last week, without forgetting it.
 */
export function seedVector(events: readonly SeedEvent[], { now, halfLifeMs = 3 * 24 * 3_600_000 }: { now: number; halfLifeMs?: number }): Map<string, number> {
  const seeds = new Map<string, number>();
  for (const event of events) {
    const age = Math.max(0, now - event.at);
    const weight = eventWeight(event.kind, event.dwellSeconds) * 0.5 ** (age / halfLifeMs);
    seeds.set(event.productId, (seeds.get(event.productId) ?? 0) + weight);
  }
  const total = [...seeds.values()].reduce((sum, value) => sum + value, 0);
  if (total > 0) for (const [id, value] of seeds) seeds.set(id, value / total);
  return seeds;
}

export function randomWalkWithRestart(
  transitions: Neighbours,
  seeds: ReadonlyMap<string, number>,
  { restart = RESTART_PROBABILITY, iterations = WALK_ITERATIONS }: { restart?: number; iterations?: number } = {},
): Map<string, number> {
  if (!(restart > 0 && restart <= 1)) throw new RangeError("restart must be in (0, 1]");
  let scores = new Map(seeds);

  for (let step = 0; step < iterations; step += 1) {
    const next = new Map<string, number>();
    let dangling = 0;
    for (const [node, mass] of scores) {
      const row = transitions.get(node);
      if (row === undefined || row.size === 0) {
        dangling += mass;
        continue;
      }
      if (restart === 1) continue;
      for (const [neighbour, probability] of row) {
        next.set(neighbour, (next.get(neighbour) ?? 0) + (1 - restart) * mass * probability);
      }
    }
    // Restart mass, plus the walk's share of dangling mass, returns to the seeds.
    const toSeeds = restart + (1 - restart) * dangling;
    for (const [seed, weight] of seeds) next.set(seed, (next.get(seed) ?? 0) + toSeeds * weight);
    scores = next;
  }
  return scores;
}

/**
 * Why a product was recommended: the seed with the strongest path to it,
 * one hop (s_i · P_ij) or two (s_i · P_ik · P_kj), whichever is stronger.
 */
export function strongestSeed(transitions: Neighbours, seeds: ReadonlyMap<string, number>, target: string): string | null {
  let best: string | null = null;
  let bestStrength = 0;
  for (const [seed, weight] of seeds) {
    const row = transitions.get(seed);
    if (row === undefined) continue;
    let strength = weight * (row.get(target) ?? 0);
    for (const [middle, first] of row) {
      const second = transitions.get(middle)?.get(target) ?? 0;
      strength = Math.max(strength, weight * first * second);
    }
    if (strength > bestStrength) {
      bestStrength = strength;
      best = seed;
    }
  }
  return best;
}
