/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Product affinity and pairwise compatibility scores for the Budget Stylist.
 */

import { paletteHarmony } from "@/lib/optimize/color";
import { dot } from "@/lib/reco/content-vector";

/**
 * The two scores the Budget Stylist optimises (A3, docs/PLAN.md 2.6).
 *
 *   a(x) = w_rel · relevance + w_taste · taste + w_rating · rating
 *
 *     relevance  0–1: how well the product answers the request's words (1 when
 *                the request has none, so every candidate starts level)
 *     taste      0–1: Taste Graph affinity for this shopper (0 until A2 knows them)
 *     rating     0–1: Bayesian average rating rescaled from 1–5 stars
 *
 *   b(x, y) = w_style · style(x, y) + w_colour · harmony(x, y)
 *
 *     style      cosine of the two style vectors, 0–1 (content-vector.ts; the
 *                product embeddings replace these when they exist)
 *     harmony    colour harmony in CIELAB, −1 to 1 (color.ts)
 *
 * With the default weights b lies in [−0.4, 1]: agreement in style can never
 * be fully cancelled by a mild colour clash, but a loud clash between unrelated
 * pieces is a real penalty.
 */

export type StylistCandidate = {
  id: string;
  priceCents: number;
  affinity: number;
  styleVector: Float64Array;
  colors: readonly string[];
};

export const AFFINITY_WEIGHTS = { relevance: 1, taste: 0.8, rating: 0.5 };
export const COMPATIBILITY_WEIGHTS = { style: 0.6, colour: 0.4 };
/** λ: starting value, tuned in evaluation E3. */
export const DEFAULT_LAMBDA = 0.35;

export function affinity(parts: { relevance: number; taste: number; rating: number }): number {
  const clamp = (value: number) => Math.min(1, Math.max(0, value));
  return (
    AFFINITY_WEIGHTS.relevance * clamp(parts.relevance) +
    AFFINITY_WEIGHTS.taste * clamp(parts.taste) +
    AFFINITY_WEIGHTS.rating * clamp(parts.rating)
  );
}

export function compatibility(first: StylistCandidate, second: StylistCandidate): number {
  const style = Math.max(0, dot(first.styleVector, second.styleVector));
  return COMPATIBILITY_WEIGHTS.style * style + COMPATIBILITY_WEIGHTS.colour * paletteHarmony(first.colors, second.colors);
}

export type PairNote = { first: string; second: string; style: number; harmony: number };

/** The strongest pairing in a bundle, for "why these go together". */
export function strongestPair(picks: readonly StylistCandidate[]): PairNote | null {
  let best: PairNote | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < picks.length; i += 1) {
    for (let j = i + 1; j < picks.length; j += 1) {
      const score = compatibility(picks[i]!, picks[j]!);
      if (score > bestScore) {
        bestScore = score;
        best = {
          first: picks[i]!.id,
          second: picks[j]!.id,
          style: Math.max(0, dot(picks[i]!.styleVector, picks[j]!.styleVector)),
          harmony: paletteHarmony(picks[i]!.colors, picks[j]!.colors),
        };
      }
    }
  }
  return best;
}
