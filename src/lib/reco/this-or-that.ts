/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * This-or-That cold start: preference vector and next-pair selection.
 */

/**
 * This-or-That (A2, cold start): learning a new shopper's taste from choices.
 *
 * Someone with no history is shown pairs of products and picks the one they
 * prefer. Each choice is a comparison, and the preference is a direction in
 * content-vector space:
 *
 *   p = mean(chosen vectors) − mean(rejected vectors)
 *
 * p points from what they turned down towards what they picked. A product's
 * preference score is its cosine with p, rescaled from [−1, 1] to [0, 1]; these
 * scores seed recommendations until real behaviour exists.
 *
 * WHICH PAIR NEXT. A choice between a and b answers one question: is the
 * shopper's taste closer to a or to b, that is, which side of the difference
 * d = a − b it lies on. Two questions along the same direction repeat each
 * other, so each new pair should ask along a direction no earlier pair has
 * covered, and one the current p cannot already answer:
 *
 *   residual(d)   the part of d orthogonal to every earlier difference
 *                 (Gram–Schmidt against an orthonormal basis of them)
 *   predictable   |cos(p, d)|: near 1 when p already knows the answer
 *
 *   next pair = argmax over unseen pairs of ‖residual(d)‖ · (1 − predictable)
 *
 * This is a small instance of optimal experimental design: spreading the
 * queries over independent directions is what lets a handful of answers pin
 * down a direction in many dimensions.
 *
 * MEASURED, before choosing this design. Simulated shoppers with a hidden taste
 * direction in 8 dimensions, 48 random products, 200 shoppers each, measuring
 * the cosine between the learned p and the hidden taste:
 *
 *   choices   random pairs   first design*   orthogonal pairs (this)
 *      6         0.616          0.617            0.682
 *      8         0.669          0.690            0.770
 *     12         0.735          0.776            0.842
 *
 *   * the first design picked the two products furthest apart along the main
 *     axis of remaining variation; it was barely better than random and was
 *     replaced. Test: src/lib/reco/walk.test.ts, "learns a hidden taste".
 *
 * Cost: all pairs of the candidate pool, O(n² · dims · answers). The pool is
 * kept to about 40 products chosen upstream, a few thousand pairs.
 */

export type Vector = Float64Array;

function dot(a: Vector, b: Vector): number {
  let total = 0;
  for (let i = 0; i < a.length; i += 1) total += a[i]! * b[i]!;
  return total;
}

function norm(a: Vector): number {
  return Math.sqrt(dot(a, a));
}

export function preferenceVector(chosen: readonly Vector[], rejected: readonly Vector[], length: number): Vector {
  const p = new Float64Array(length);
  for (const v of chosen) for (let i = 0; i < length; i += 1) p[i]! += v[i]! / chosen.length;
  for (const v of rejected) for (let i = 0; i < length; i += 1) p[i]! -= v[i]! / rejected.length;
  return p;
}

/** Cosine with p, mapped to [0, 1]; 0.5 for everything when p is zero. */
export function preferenceScore(p: Vector, x: Vector): number {
  const denominator = norm(p) * norm(x);
  return denominator === 0 ? 0.5 : (dot(p, x) / denominator + 1) / 2;
}

/** An orthonormal basis for the span of the given vectors (Gram–Schmidt). */
export function orthonormalBasis(vectors: readonly Vector[]): Vector[] {
  const basis: Vector[] = [];
  for (const vector of vectors) {
    const residual = Float64Array.from(vector);
    for (const b of basis) {
      const projection = dot(residual, b);
      for (let i = 0; i < residual.length; i += 1) residual[i]! -= projection * b[i]!;
    }
    const size = norm(residual);
    if (size > 1e-9) basis.push(residual.map((value) => value / size));
  }
  return basis;
}

export type PairCandidate = { id: string; vector: Vector };

/**
 * @param asked  the difference vectors (a − b) of every pair already shown
 */
export function nextPair(candidates: readonly PairCandidate[], p: Vector, asked: readonly Vector[], shown: ReadonlySet<string>): [string, string] | null {
  const pool = candidates.filter((candidate) => !shown.has(candidate.id));
  if (pool.length < 2) return null;

  const basis = orthonormalBasis(asked);
  const pNorm = norm(p);
  let best: [string, string] | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (let i = 0; i < pool.length; i += 1) {
    for (let j = i + 1; j < pool.length; j += 1) {
      const a = pool[i]!.vector;
      const b = pool[j]!.vector;
      const difference = a.map((value, k) => value - b[k]!);
      const differenceNorm = norm(difference);
      if (differenceNorm === 0) continue;

      const residual = Float64Array.from(difference);
      for (const direction of basis) {
        const projection = dot(residual, direction);
        for (let k = 0; k < residual.length; k += 1) residual[k]! -= projection * direction[k]!;
      }
      const predictable = pNorm === 0 ? 0 : Math.abs(dot(p, difference)) / (pNorm * differenceNorm);
      const score = norm(residual) * (1 - predictable);
      if (score > bestScore + 1e-12) {
        bestScore = score;
        best = [pool[i]!.id, pool[j]!.id];
      }
    }
  }
  return best;
}
