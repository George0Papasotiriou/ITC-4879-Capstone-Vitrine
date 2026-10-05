/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The capsule wardrobe: a few pieces, within a budget, chosen so they make the most outfits together.
 */

/**
 * docs/adr/066 — a student-designed optimiser.
 *
 * THE PROBLEM. A capsule is a small wardrobe whose pieces all go together:
 * with 3 tops, 2 bottoms and 2 pairs of shoes, up to 3 × 2 × 2 = 12
 * outfits. Given candidates for each role, how many of each role to take and
 * a budget, choose the pieces that make the MOST good outfits. An outfit is
 * good when every two of its pieces go together: compatibility(a, b) ≥ τ
 * (outfit.ts). Women's capsules may also count a dress with a pair of shoes
 * as an outfit.
 *
 *   maximise  F(S) = #good outfits(S) + ε·(mean compatibility within S)
 *   subject to  |S ∩ role| = count(role) for every role,  Σ price(S) ≤ budget
 *
 * The small ε term breaks ties between capsules with as many outfits,
 * towards the one whose pieces go together best.
 *
 * WHY NOT THE STYLIST'S SEARCH. A3 (bundle.ts) picks one piece per slot and
 * scores pairs; here a role holds several pieces and the score counts
 * triples, so adding a piece can add many outfits at once or none (the
 * objective is not submodular: two bottoms that go with nothing alone may
 * together make six outfits). Exhaustive search is exact but explodes: 12
 * candidates per role with 3/2/2 to choose is 220 × 66 × 66 ≈ 958,000
 * capsules.
 *
 * THE ALGORITHM.
 * 1. Greedy construction: start empty and add, role by role in turn, the
 *    affordable piece with the largest gain in F per euro (a piece's gain
 *    counted with the others already chosen, plus how well it goes with
 *    them, so the first picks are not blind), keeping enough budget to fill
 *    the remaining places with their cheapest candidates.
 * 2. Local search by swaps: repeatedly take the best single swap (one chosen
 *    piece for an unchosen one of the same role) that keeps the budget and
 *    raises F; when no single swap helps, the best double swap (two pieces
 *    exchanged at once), which is how a pair that only works together gets
 *    in; until neither helps.
 * 3. Restarts: the greedy start is forced to begin with each of the
 *    best-connected few pieces of every role in turn, and the best result
 *    kept, because swaps can only reach capsules near where they began.
 *
 * Unit tests check it against exhaustive search on small instances; E14
 * measures its gap on the real catalogue.
 */

export type CapsuleRole = "top" | "bottom" | "dress" | "shoes";

export type CapsuleCandidate = { id: string; role: CapsuleRole; priceCents: number };

export type CapsuleProblem<C extends CapsuleCandidate> = {
  candidates: readonly C[];
  /** How many of each role to take. */
  counts: Partial<Record<CapsuleRole, number>>;
  budgetCents: number;
  /** Symmetric: how well two pieces go together. */
  compatibility: (first: C, second: C) => number;
  /** τ: two pieces go together when their compatibility reaches it. */
  threshold: number;
};

export type Capsule<C extends CapsuleCandidate> = { pieces: C[]; outfits: number; score: number; priceCents: number };

const TIE_BREAK = 0.01;

/** The outfits a set of pieces makes, and the mean compatibility of its pairs. */
export function capsuleScore<C extends CapsuleCandidate>(pieces: readonly C[], problem: Pick<CapsuleProblem<C>, "compatibility" | "threshold">): { outfits: number; meanCompatibility: number; score: number } {
  const by = (role: CapsuleRole) => pieces.filter((piece) => piece.role === role);
  const ok = (a: C, b: C) => problem.compatibility(a, b) >= problem.threshold;
  let outfits = 0;
  for (const top of by("top")) for (const bottom of by("bottom")) if (ok(top, bottom)) for (const shoes of by("shoes")) if (ok(top, shoes) && ok(bottom, shoes)) outfits += 1;
  for (const dress of by("dress")) for (const shoes of by("shoes")) if (ok(dress, shoes)) outfits += 1;
  let total = 0;
  let pairs = 0;
  for (let i = 0; i < pieces.length; i += 1) {
    for (let j = i + 1; j < pieces.length; j += 1) {
      total += problem.compatibility(pieces[i]!, pieces[j]!);
      pairs += 1;
    }
  }
  const meanCompatibility = pairs === 0 ? 0 : total / pairs;
  return { outfits, meanCompatibility, score: outfits + TIE_BREAK * meanCompatibility };
}

const priceOf = <C extends CapsuleCandidate>(pieces: readonly C[]) => pieces.reduce((sum, piece) => sum + piece.priceCents, 0);

/** The cheapest way to fill the places still open, so a greedy pick never spends what the rest needs. */
function reserveFor<C extends CapsuleCandidate>(problem: CapsuleProblem<C>, chosen: readonly C[], exclude: ReadonlySet<string>): number {
  let reserve = 0;
  for (const [role, count] of Object.entries(problem.counts) as [CapsuleRole, number][]) {
    const open = count - chosen.filter((piece) => piece.role === role).length;
    if (open <= 0) continue;
    const prices = problem.candidates
      .filter((candidate) => candidate.role === role && !exclude.has(candidate.id))
      .map((candidate) => candidate.priceCents)
      .sort((a, b) => a - b);
    if (prices.length < open) return Number.POSITIVE_INFINITY;
    reserve += prices.slice(0, open).reduce((sum, price) => sum + price, 0);
  }
  return reserve;
}

/** 1. The greedy start, optionally forced to begin with one piece. Null when the counts cannot be filled within the budget. */
function greedy<C extends CapsuleCandidate>(problem: CapsuleProblem<C>, first: C | null): C[] | null {
  const chosen: C[] = first === null ? [] : [first];
  const used = new Set(chosen.map((piece) => piece.id));
  const roles = (Object.entries(problem.counts) as [CapsuleRole, number][]).filter(([, count]) => count > 0);
  for (;;) {
    const open = roles.filter(([role, count]) => chosen.filter((piece) => piece.role === role).length < count);
    if (open.length === 0) return chosen;
    // Fill the role with the most places left first, so roles grow together and outfits can form.
    const [role] = open.reduce((best, entry) => (entry[1] - chosen.filter((p) => p.role === entry[0]).length > best[1] - chosen.filter((p) => p.role === best[0]).length ? entry : best));
    const base = capsuleScore(chosen, problem).score;
    let best: C | null = null;
    let bestValue = Number.NEGATIVE_INFINITY;
    for (const candidate of problem.candidates) {
      if (candidate.role !== role || used.has(candidate.id)) continue;
      const next = [...chosen, candidate];
      const reserve = reserveFor(problem, next, new Set([...used, candidate.id]));
      if (priceOf(next) + reserve > problem.budgetCents) continue;
      // Gain in outfits, plus how well it goes with what is chosen (outfits need all roles before they count).
      const withIt = capsuleScore(next, problem);
      const fit = chosen.length === 0 ? 0 : chosen.reduce((sum, piece) => sum + problem.compatibility(piece, candidate), 0) / chosen.length;
      const value = (withIt.score - base + 0.1 * fit + 1e-6) / Math.max(candidate.priceCents, 1);
      if (value > bestValue) {
        bestValue = value;
        best = candidate;
      }
    }
    if (best === null) return null;
    chosen.push(best);
    used.add(best.id);
  }
}

/** 2. Best-improvement swaps within each role, single and then double, keeping the budget, until none helps. */
function improve<C extends CapsuleCandidate>(problem: CapsuleProblem<C>, start: C[]): C[] {
  let current = start;
  let currentScore = capsuleScore(current, problem).score;
  const replacements = (index: number, used: ReadonlySet<string>) => problem.candidates.filter((candidate) => candidate.role === current[index]!.role && !used.has(candidate.id));
  for (let round = 0; round < 500; round += 1) {
    const used = new Set(current.map((piece) => piece.id));
    let bestSwap: C[] | null = null;
    let bestScore = currentScore;
    const consider = (next: C[]) => {
      if (priceOf(next) > problem.budgetCents) return;
      const score = capsuleScore(next, problem).score;
      if (score > bestScore + 1e-12) {
        bestScore = score;
        bestSwap = next;
      }
    };
    for (let i = 0; i < current.length; i += 1) for (const candidate of replacements(i, used)) consider(current.map((piece, k) => (k === i ? candidate : piece)));
    if (bestSwap === null) {
      // No single swap helps: try two at once.
      for (let i = 0; i < current.length; i += 1) {
        for (let j = i + 1; j < current.length; j += 1) {
          for (const first of replacements(i, used)) {
            for (const second of replacements(j, used)) {
              if (first.id === second.id) continue;
              consider(current.map((piece, k) => (k === i ? first : k === j ? second : piece)));
            }
          }
        }
      }
    }
    if (bestSwap === null) break;
    current = bestSwap;
    currentScore = bestScore;
  }
  return current;
}

export type CapsuleOptions = { restarts?: number };

/**
 * The same problem with every pair's compatibility worked out once: the
 * search asks for the same pairs many thousands of times, and a style
 * vector's dot product is not free.
 */
function withRememberedPairs<C extends CapsuleCandidate>(problem: CapsuleProblem<C>): CapsuleProblem<C> {
  const index = new Map(problem.candidates.map((candidate, k) => [candidate.id, k]));
  const n = problem.candidates.length;
  const table = new Float64Array(n * n).fill(Number.NaN);
  return {
    ...problem,
    compatibility: (first, second) => {
      const a = index.get(first.id);
      const b = index.get(second.id);
      if (a === undefined || b === undefined) return problem.compatibility(first, second);
      const cell = a * n + b;
      if (Number.isNaN(table[cell]!)) {
        const value = problem.compatibility(first, second);
        table[cell] = value;
        table[b * n + a] = value;
      }
      return table[cell]!;
    },
  };
}

/** 1–3: the capsule with the most good outfits found; null when the counts cannot be filled within the budget. */
export function buildCapsule<C extends CapsuleCandidate>(original: CapsuleProblem<C>, { restarts = 6 }: CapsuleOptions = {}): Capsule<C> | null {
  const problem = withRememberedPairs(original);
  const starts: (C | null)[] = [null];
  // Forced first pieces: the best-connected candidates of every role (each one's total compatibility with all others).
  for (const [role, count] of Object.entries(problem.counts) as [CapsuleRole, number][]) {
    if (count <= 0) continue;
    const connected = problem.candidates
      .filter((candidate) => candidate.role === role)
      .map((candidate) => ({ candidate, total: problem.candidates.reduce((sum, other) => sum + (other === candidate ? 0 : problem.compatibility(candidate, other)), 0) }))
      .sort((a, b) => b.total - a.total)
      .slice(0, restarts);
    starts.push(...connected.map((entry) => entry.candidate));
  }
  let best: Capsule<C> | null = null;
  for (const first of starts) {
    if (first !== null && first.priceCents > problem.budgetCents) continue;
    const start = greedy(problem, first);
    if (start === null) continue;
    const pieces = improve(problem, start);
    const { outfits, score } = capsuleScore(pieces, problem);
    if (best === null || score > best.score + 1e-12) best = { pieces, outfits, score, priceCents: priceOf(pieces) };
  }
  return best;
}

/** Exhaustive search, for the tests and for E14 on small pools: every way to fill the counts within the budget. */
export function exhaustiveCapsule<C extends CapsuleCandidate>(problem: CapsuleProblem<C>): Capsule<C> | null {
  const roles = (Object.entries(problem.counts) as [CapsuleRole, number][]).filter(([, count]) => count > 0);
  const choices = roles.map(([role, count]) => combinations(problem.candidates.filter((candidate) => candidate.role === role), count));
  let best: Capsule<C> | null = null;
  const walk = (index: number, chosen: C[], spent: number) => {
    if (spent > problem.budgetCents) return;
    if (index === choices.length) {
      const { outfits, score } = capsuleScore(chosen, problem);
      if (best === null || score > best.score + 1e-12) best = { pieces: [...chosen], outfits, score, priceCents: spent };
      return;
    }
    for (const group of choices[index]!) walk(index + 1, [...chosen, ...group], spent + priceOf(group));
  };
  walk(0, [], 0);
  return best;
}

function combinations<T>(items: readonly T[], k: number): T[][] {
  const out: T[][] = [];
  const pick = (start: number, chosen: T[]) => {
    if (chosen.length === k) {
      out.push([...chosen]);
      return;
    }
    for (let i = start; i <= items.length - (k - chosen.length); i += 1) pick(i + 1, [...chosen, items[i]!]);
  };
  pick(0, []);
  return out;
}

/** The greedy start alone, without swaps or restarts: E14's comparison for what the local search adds. */
export function greedyCapsule<C extends CapsuleCandidate>(problem: CapsuleProblem<C>): Capsule<C> | null {
  const pieces = greedy(problem, null);
  if (pieces === null) return null;
  const { outfits, score } = capsuleScore(pieces, problem);
  return { pieces, outfits, score, priceCents: priceOf(pieces) };
}
