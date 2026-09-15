/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Budget Stylist optimiser: best product bundles within a budget with pairwise compatibility.
 */

/**
 * The Budget Stylist optimiser (A3, docs/PLAN.md 2.6).
 *
 * THE PROBLEM. A template has slots — a reading corner needs a chair, a lamp,
 * a side table and perhaps a rug — and each slot has a short list of candidate
 * products. Choose at most one product per slot (exactly one for a required
 * slot) to maximise
 *
 *   U(x) = Σ_s a(x_s)  +  λ · Σ_{s<t} b(x_s, x_t)
 *
 * subject to  Σ_s price(x_s) ≤ B.
 *
 *   a(x)     how good a product is on its own: relevance, taste fit, rating
 *   b(x, y)  how well two products go together: style and colour harmony
 *   λ        how much going together matters against being good on one's own
 *   B        the budget
 *
 * Without the pairwise term this is the multiple-choice knapsack problem, which
 * is already NP-hard; the pairwise term makes it a quadratic one. But the
 * instances are small — four slots of 15 to 25 candidates is at most 25⁴ ≈ 390,000
 * bundles — so an exact method with good pruning answers in milliseconds.
 *
 * BRANCH AND BOUND. Build a bundle slot by slot, as a depth-first search. At
 * every partial bundle compute an upper bound on the utility of any completion:
 *
 *   bound = U(chosen so far)
 *         + Σ_{t open}           max a over t's options
 *         + λ · Σ_{s chosen, t open}  max over t's options of b(x_s, ·)
 *         + λ · Σ_{t<u both open}     max b over every pair of their options
 *
 * Each term is maximised on its own, so no completion can beat the bound (it is
 * admissible). If the bound does not exceed the best complete bundle found so
 * far, the whole subtree is skipped. A second prune: if the price so far plus
 * the cheapest option of every open slot exceeds the budget, no completion is
 * affordable.
 *
 * Search order decides how early good bundles are found, and therefore how
 * much gets pruned. Slots are visited fewest candidates first (a small branching
 * factor near the root). Within a slot, options are tried in order of optimistic
 * contribution, a(x) + λ · Σ_t max b(x, ·), so the first complete bundle is
 * usually already good.
 *
 * THREE DIFFERENT BUNDLES. A shopper wants choices, not three variations of one
 * sofa. The second bundle is the best bundle that differs from the first in at
 * least two slots, and the third the best that differs from both — each found by
 * its own exact search with that constraint, which also prunes: a partial
 * bundle that cannot reach two differences in the slots still open is abandoned.
 *
 * TIME LIMIT. If an exact search runs past its time budget (250 ms by default),
 * it stops and a beam search finishes that rank: it keeps the W most promising
 * partial bundles by bound at each slot. Beam search is fast but not guaranteed
 * optimal, and the result says which method produced each bundle.
 *
 * The language model never chooses. It turns a request into a template, a
 * budget and constraints, and explains the result; this function chooses.
 */

export type Candidate = {
  id: string;
  priceCents: number;
  /** a(x): individual score. Any real number; higher is better. */
  affinity: number;
};

export type Slot<C extends Candidate = Candidate> = {
  id: string;
  /** A required slot must be filled; an optional slot may stay empty. */
  required: boolean;
  candidates: readonly C[];
};

export type BundleProblem<C extends Candidate = Candidate> = {
  slots: readonly Slot<C>[];
  budgetCents: number;
  /** λ ≥ 0: weight of pairwise compatibility. */
  lambda: number;
  /** b(x, y): symmetric compatibility of two candidates from different slots. */
  compatibility: (first: C, second: C) => number;
};

export type BundleOptions = {
  /** How many diverse bundles to return. */
  count?: number;
  /** Minimum number of slots in which any two returned bundles differ. */
  minDifferentSlots?: number;
  /** Per-rank time budget for the exact search before falling back to beam search. */
  timeLimitMs?: number;
  beamWidth?: number;
  /** For tests and evaluation: a clock other than performance.now. */
  now?: () => number;
};

export type Bundle<C extends Candidate = Candidate> = {
  /** Slot id → chosen candidate, or null for an optional slot left empty. */
  picks: Record<string, C | null>;
  priceCents: number;
  utility: number;
  /** The two parts of the utility, for explanations. */
  individual: number;
  pairwise: number;
  method: "exact" | "beam";
};

export type BundleResult<C extends Candidate = Candidate> = {
  bundles: Bundle<C>[];
  stats: { nodes: number; pruned: number; elapsedMs: number; exact: boolean };
};

const EPSILON = 1e-9;

/** Internal: a slot's options, with "leave empty" as an option for optional slots. */
type Option<C> = { candidate: C | null; affinity: number; price: number };

type Prepared<C extends Candidate> = {
  /** Slots in search order; `original[k]` is the index into problem.slots. */
  order: number[];
  options: Option<C>[][];
  /** b between option i of slot s and option j of slot t (search-order indices). */
  pair: Float64Array[][];
  maxAffinity: number[];
  minPrice: number[];
  /** Max over all option pairs of b, per slot pair (s < t). */
  maxPair: number[][];
};

function prepare<C extends Candidate>(problem: BundleProblem<C>): Prepared<C> {
  const slotCount = problem.slots.length;
  const optionsBySlot: Option<C>[][] = problem.slots.map((slot) => {
    const options: Option<C>[] = slot.candidates.map((candidate) => ({
      candidate,
      affinity: candidate.affinity,
      price: candidate.priceCents,
    }));
    if (!slot.required) options.push({ candidate: null, affinity: 0, price: 0 });
    return options;
  });

  // Fewest options first; ties keep the template's order.
  const order = [...Array(slotCount).keys()].sort(
    (a, b) => optionsBySlot[a]!.length - optionsBySlot[b]!.length || a - b,
  );
  const options = order.map((index) => optionsBySlot[index]!);

  const compat = (x: Option<C>, y: Option<C>) =>
    x.candidate === null || y.candidate === null ? 0 : problem.compatibility(x.candidate, y.candidate);

  const pair: Float64Array[][] = [];
  const maxPair: number[][] = [];
  for (let s = 0; s < slotCount; s += 1) {
    pair.push([]);
    maxPair.push([]);
    for (let t = 0; t < slotCount; t += 1) {
      const rows = options[s]!.length;
      const cols = options[t]!.length;
      const matrix = new Float64Array(rows * cols);
      let max = Number.NEGATIVE_INFINITY;
      if (s !== t) {
        for (let i = 0; i < rows; i += 1) {
          for (let j = 0; j < cols; j += 1) {
            const value = s < t ? compat(options[s]![i]!, options[t]![j]!) : pair[t]![s]![j * rows + i]!;
            matrix[i * cols + j] = value;
            if (value > max) max = value;
          }
        }
      }
      pair[s]!.push(matrix);
      maxPair[s]!.push(s === t ? 0 : max);
    }
  }

  // Within a slot, most promising options first.
  for (let s = 0; s < slotCount; s += 1) {
    const cols = (t: number) => options[t]!.length;
    const optimistic = options[s]!.map((option, i) => {
      let bonus = 0;
      for (let t = 0; t < slotCount; t += 1) {
        if (t === s) continue;
        let best = Number.NEGATIVE_INFINITY;
        for (let j = 0; j < cols(t); j += 1) best = Math.max(best, pair[s]![t]![i * cols(t) + j]!);
        bonus += best;
      }
      return { i, score: option.affinity + problem.lambda * bonus };
    });
    const permutation = optimistic.sort((a, b) => b.score - a.score || a.i - b.i).map((entry) => entry.i);
    reorderSlot(options, pair, s, permutation);
  }

  return {
    order,
    options,
    pair,
    maxAffinity: options.map((slot) => Math.max(...slot.map((option) => option.affinity))),
    minPrice: options.map((slot) => Math.min(...slot.map((option) => option.price))),
    maxPair,
  };
}

/** Applies a permutation to one slot's options and to every pairwise matrix that touches it. */
function reorderSlot<C>(options: Option<C>[][], pair: Float64Array[][], s: number, permutation: number[]): void {
  const rows = options[s]!.length;
  options[s] = permutation.map((i) => options[s]![i]!);
  for (let t = 0; t < options.length; t += 1) {
    if (t === s) continue;
    const cols = options[t]!.length;
    const forward = pair[s]![t]!;
    const reordered = new Float64Array(rows * cols);
    for (let newI = 0; newI < rows; newI += 1) {
      const oldI = permutation[newI]!;
      for (let j = 0; j < cols; j += 1) reordered[newI * cols + j] = forward[oldI * cols + j]!;
    }
    pair[s]![t] = reordered;
    const backward = new Float64Array(cols * rows);
    for (let j = 0; j < cols; j += 1) {
      for (let newI = 0; newI < rows; newI += 1) backward[j * rows + newI] = reordered[newI * cols + j]!;
    }
    pair[t]![s] = backward;
  }
}

function differences(choice: readonly number[], other: readonly number[], upTo: number): number {
  let count = 0;
  for (let k = 0; k < upTo; k += 1) if (choice[k] !== other[k]) count += 1;
  return count;
}

type SearchState = {
  prepared: Prepared<Candidate>;
  lambda: number;
  budget: number;
  avoid: readonly number[][];
  minDifferent: number;
};

/** The admissible upper bound on any completion of a partial choice (depth slots fixed). */
function upperBound(state: SearchState, choice: readonly number[], depth: number, utility: number): number {
  const { prepared, lambda } = state;
  const slots = prepared.options.length;
  let bound = utility;
  for (let t = depth; t < slots; t += 1) {
    bound += prepared.maxAffinity[t]!;
    const cols = prepared.options[t]!.length;
    for (let s = 0; s < depth; s += 1) {
      const row = choice[s]!;
      let best = Number.NEGATIVE_INFINITY;
      const matrix = prepared.pair[s]![t]!;
      for (let j = 0; j < cols; j += 1) best = Math.max(best, matrix[row * cols + j]!);
      bound += lambda * best;
    }
    for (let u = t + 1; u < slots; u += 1) bound += lambda * prepared.maxPair[t]![u]!;
  }
  return bound;
}

function gain(state: SearchState, choice: readonly number[], depth: number, option: number): number {
  const { prepared, lambda } = state;
  let value = prepared.options[depth]![option]!.affinity;
  const cols = prepared.options[depth]!.length;
  for (let s = 0; s < depth; s += 1) value += lambda * prepared.pair[s]![depth]![choice[s]! * cols + option]!;
  return value;
}

function remainingMinPrice(prepared: Prepared<Candidate>, from: number): number {
  let total = 0;
  for (let t = from; t < prepared.options.length; t += 1) total += prepared.minPrice[t]!;
  return total;
}

/** Can a partial choice still differ enough from every bundle it must avoid? */
function canStillDiffer(state: SearchState, choice: readonly number[], depth: number): boolean {
  const open = state.prepared.options.length - depth;
  return state.avoid.every((other) => differences(choice, other, depth) + open >= state.minDifferent);
}

type Found = { choice: number[]; utility: number };

function exactSearch(state: SearchState, deadline: number, now: () => number, counters: { nodes: number; pruned: number }): Found | "timeout" | null {
  const slots = state.prepared.options.length;
  const choice = new Array<number>(slots).fill(-1);
  let best: Found | null = null;
  let timedOut = false;
  let visited = 0;

  const visit = (depth: number, utility: number, price: number): void => {
    if (timedOut) return;
    counters.nodes += 1;
    visited += 1;
    // The clock is read on the first node and every 256 after: often enough to
    // stop within a fraction of a millisecond, rarely enough to cost nothing.
    if ((visited & 255) === 1 && now() > deadline) {
      timedOut = true;
      return;
    }

    if (depth === slots) {
      if (state.avoid.some((other) => differences(choice, other, slots) < state.minDifferent)) return;
      if (best === null || utility > best.utility + EPSILON) best = { choice: [...choice], utility };
      return;
    }

    if (price + remainingMinPrice(state.prepared, depth) > state.budget) {
      counters.pruned += 1;
      return;
    }
    if (!canStillDiffer(state, choice, depth)) {
      counters.pruned += 1;
      return;
    }
    if (best !== null && upperBound(state, choice, depth, utility) <= best.utility + EPSILON) {
      counters.pruned += 1;
      return;
    }

    const options = state.prepared.options[depth]!;
    for (let i = 0; i < options.length; i += 1) {
      const nextPrice = price + options[i]!.price;
      if (nextPrice > state.budget) continue;
      choice[depth] = i;
      visit(depth + 1, utility + gain(state, choice, depth, i), nextPrice);
      choice[depth] = -1;
      if (timedOut) return;
    }
  };

  visit(0, 0, 0);
  if (timedOut) return "timeout";
  return best;
}

function beamSearch(state: SearchState, width: number): Found | null {
  const slots = state.prepared.options.length;
  type Partial = { choice: number[]; utility: number; price: number; bound: number };
  let beam: Partial[] = [{ choice: [], utility: 0, price: 0, bound: Number.POSITIVE_INFINITY }];

  for (let depth = 0; depth < slots; depth += 1) {
    const next: Partial[] = [];
    for (const partial of beam) {
      const options = state.prepared.options[depth]!;
      for (let i = 0; i < options.length; i += 1) {
        const price = partial.price + options[i]!.price;
        if (price + remainingMinPrice(state.prepared, depth + 1) > state.budget) continue;
        const choice = [...partial.choice, i];
        if (!canStillDiffer(state, choice, depth + 1)) continue;
        const utility = partial.utility + gain(state, choice, depth, i);
        next.push({ choice, utility, price, bound: upperBound(state, choice, depth + 1, utility) });
      }
    }
    next.sort((a, b) => b.bound - a.bound || b.utility - a.utility);
    beam = next.slice(0, width);
    if (beam.length === 0) return null;
  }

  const complete = beam
    .filter((partial) => state.avoid.every((other) => differences(partial.choice, other, slots) >= state.minDifferent))
    .sort((a, b) => b.utility - a.utility);
  return complete[0] === undefined ? null : { choice: complete[0].choice, utility: complete[0].utility };
}

function toBundle<C extends Candidate>(problem: BundleProblem<C>, prepared: Prepared<C>, found: Found, method: Bundle["method"]): Bundle<C> {
  const picks: Record<string, C | null> = {};
  let priceCents = 0;
  let individual = 0;
  found.choice.forEach((optionIndex, k) => {
    const option = prepared.options[k]![optionIndex]!;
    picks[problem.slots[prepared.order[k]!]!.id] = option.candidate;
    priceCents += option.price;
    individual += option.affinity;
  });
  return {
    picks,
    priceCents,
    utility: found.utility,
    individual,
    pairwise: problem.lambda === 0 ? 0 : (found.utility - individual) / problem.lambda,
    method,
  };
}

export function optimizeBundles<C extends Candidate>(problem: BundleProblem<C>, options: BundleOptions = {}): BundleResult<C> {
  const count = options.count ?? 3;
  const minDifferent = options.minDifferentSlots ?? 2;
  const timeLimitMs = options.timeLimitMs ?? 250;
  const beamWidth = options.beamWidth ?? 64;
  const now = options.now ?? (() => performance.now());

  if (!(problem.lambda >= 0)) throw new RangeError("lambda must be ≥ 0");
  if (!Number.isInteger(problem.budgetCents) || problem.budgetCents < 0) throw new RangeError("budgetCents must be a non-negative integer");

  const started = now();
  const counters = { nodes: 0, pruned: 0 };
  const result: BundleResult<C> = { bundles: [], stats: { nodes: 0, pruned: 0, elapsedMs: 0, exact: true } };

  if (problem.slots.length === 0 || problem.slots.some((slot) => slot.required && slot.candidates.length === 0)) {
    result.stats.elapsedMs = now() - started;
    return result;
  }

  const prepared = prepare(problem);
  const found: number[][] = [];

  for (let rank = 0; rank < count; rank += 1) {
    const state: SearchState = {
      prepared: prepared as unknown as Prepared<Candidate>,
      lambda: problem.lambda,
      budget: problem.budgetCents,
      // Diversity only means something between returned bundles.
      avoid: found,
      minDifferent: Math.min(minDifferent, prepared.options.length),
    };

    let outcome = exactSearch(state, now() + timeLimitMs, now, counters);
    let method: Bundle["method"] = "exact";
    if (outcome === "timeout") {
      outcome = beamSearch(state, beamWidth);
      method = "beam";
      result.stats.exact = false;
    }
    if (outcome === null) break;

    found.push(outcome.choice);
    result.bundles.push(toBundle(problem, prepared, outcome, method));
  }

  result.stats = { ...result.stats, nodes: counters.nodes, pruned: counters.pruned, elapsedMs: now() - started };
  return result;
}

/* -------------------------------------------------------------------------- */
/* Reference methods, for tests and evaluation E3                              */
/* -------------------------------------------------------------------------- */

export function bundleUtility<C extends Candidate>(problem: BundleProblem<C>, picks: readonly (C | null)[]): number {
  let utility = 0;
  for (let s = 0; s < picks.length; s += 1) {
    const x = picks[s];
    if (x == null) continue;
    utility += x.affinity;
    for (let t = s + 1; t < picks.length; t += 1) {
      const y = picks[t];
      if (y != null) utility += problem.lambda * problem.compatibility(x, y);
    }
  }
  return utility;
}

/**
 * Every feasible bundle, best first. Exponential: for small instances only,
 * where it is the ground truth the optimiser is checked against.
 */
export function exhaustiveBundles<C extends Candidate>(problem: BundleProblem<C>): { picks: (C | null)[]; utility: number; priceCents: number }[] {
  const all: { picks: (C | null)[]; utility: number; priceCents: number }[] = [];
  const picks: (C | null)[] = [];
  const walk = (s: number, price: number) => {
    if (price > problem.budgetCents) return;
    if (s === problem.slots.length) {
      all.push({ picks: [...picks], utility: bundleUtility(problem, picks), priceCents: price });
      return;
    }
    const slot = problem.slots[s]!;
    for (const candidate of slot.candidates) {
      picks.push(candidate);
      walk(s + 1, price + candidate.priceCents);
      picks.pop();
    }
    if (!slot.required) {
      picks.push(null);
      walk(s + 1, price);
      picks.pop();
    }
  };
  walk(0, 0);
  return all.sort((a, b) => b.utility - a.utility);
}

/**
 * The greedy baseline for evaluation E3: fill slots in template order with the
 * best individual candidate that still leaves enough budget for the cheapest
 * option of every slot after it. Ignores compatibility entirely.
 */
export function greedyBundle<C extends Candidate>(problem: BundleProblem<C>): { picks: (C | null)[]; utility: number; priceCents: number } | null {
  const picks: (C | null)[] = [];
  let price = 0;
  const cheapest = problem.slots.map((slot) => (slot.required ? Math.min(...slot.candidates.map((c) => c.priceCents)) : 0));
  for (let s = 0; s < problem.slots.length; s += 1) {
    const reserve = cheapest.slice(s + 1).reduce((sum, value) => sum + value, 0);
    const slot = problem.slots[s]!;
    const affordable = [...slot.candidates]
      .filter((candidate) => price + candidate.priceCents + reserve <= problem.budgetCents)
      .sort((a, b) => b.affinity - a.affinity);
    const pick = affordable[0] ?? null;
    if (pick === null && slot.required) return null;
    if (pick !== null && !slot.required && pick.affinity <= 0) {
      picks.push(null);
      continue;
    }
    picks.push(pick);
    price += pick?.priceCents ?? 0;
  }
  return { picks, utility: bundleUtility(problem, picks), priceCents: price };
}

/**
 * "Swap one piece": the best replacements for one slot of a bundle, keeping the
 * other pieces, within the budget, ordered by the utility of the whole bundle.
 */
export function alternativesFor<C extends Candidate>(
  problem: BundleProblem<C>,
  bundle: Bundle<C>,
  slotId: string,
  limit = 5,
): { candidate: C; utility: number; priceCents: number }[] {
  const slotIndex = problem.slots.findIndex((slot) => slot.id === slotId);
  if (slotIndex === -1) return [];
  const current = problem.slots.map((slot) => bundle.picks[slot.id] ?? null);
  const priceWithout = bundle.priceCents - (current[slotIndex]?.priceCents ?? 0);

  return problem.slots[slotIndex]!.candidates
    .filter((candidate) => candidate.id !== current[slotIndex]?.id && priceWithout + candidate.priceCents <= problem.budgetCents)
    .map((candidate) => {
      const picks = [...current];
      picks[slotIndex] = candidate;
      return { candidate, utility: bundleUtility(problem, picks), priceCents: priceWithout + candidate.priceCents };
    })
    .sort((a, b) => b.utility - a.utility)
    .slice(0, limit);
}
