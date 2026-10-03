/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Ranking quality for evaluation E1: NDCG@k, MRR and recall@k from graded judgements.
 */

/**
 * Evaluation E1 (docs/PLAN.md Part 2, docs/adr/036). A person grades how well
 * a product answers a query, on the four-point scale the ESCI shopping-queries
 * benchmark uses:
 *
 *   3 exact       the product is what was asked for
 *   2 substitute  not quite, but a reasonable answer
 *   1 complement  related, but not an answer (a lamp shade for "lamp")
 *   0 irrelevant
 *
 * From those grades, for one ranked list of product ids:
 *
 *   DCG@k   = Σ_{i=1..k} (2^rel_i − 1) / log2(i + 1)
 *             Gains grow exponentially with the grade, so one exact answer is
 *             worth more than several complements; the log discount says a
 *             result further down the page is less likely to be seen.
 *   NDCG@k  = DCG@k / IDCG@k, where IDCG@k is the DCG of the best possible
 *             order of every judged product for the query. 1 is perfect, 0 is
 *             nothing useful. Dividing by the ideal makes queries with many
 *             good answers and queries with one comparable.
 *   RR      = 1 / (rank of the first product graded 2 or 3); 0 if none is in
 *             the list. Its mean over queries is MRR: how far down the first
 *             real answer is.
 *   Recall@k = (products graded 2 or 3 in the top k) / (all products graded 2
 *             or 3 for the query): how much of what should be found was.
 *
 * A product in the list that nobody has judged counts as grade 0 — the usual
 * and conservative convention (it can only lower a score), and the reason the
 * labelling page pools every system's top results before anyone judges.
 */

export type Grade = 0 | 1 | 2 | 3;
export const GRADES: readonly Grade[] = [0, 1, 2, 3];
/** Grades that count as an answer for MRR and recall. */
export const RELEVANT_FROM: Grade = 2;

export type Judgements = ReadonlyMap<string, Grade>;

const gain = (grade: number) => 2 ** grade - 1;
const discount = (position: number) => Math.log2(position + 2);

export function dcg(grades: readonly number[], k: number): number {
  let total = 0;
  for (let position = 0; position < Math.min(k, grades.length); position += 1) total += gain(grades[position]!) / discount(position);
  return total;
}

/** NDCG@k of a ranking; null when nothing judged for the query is relevant at all (the ideal is 0). */
export function ndcg(ranking: readonly string[], judgements: Judgements, k = 10): number | null {
  const grades = ranking.map((id) => judgements.get(id) ?? 0);
  const ideal = dcg([...judgements.values()].sort((a, b) => b - a), k);
  return ideal === 0 ? null : dcg(grades, k) / ideal;
}

export function reciprocalRank(ranking: readonly string[], judgements: Judgements): number {
  const first = ranking.findIndex((id) => (judgements.get(id) ?? 0) >= RELEVANT_FROM);
  return first < 0 ? 0 : 1 / (first + 1);
}

/** Recall@k; null when the query has no relevant product judged. */
export function recallAt(ranking: readonly string[], judgements: Judgements, k = 10): number | null {
  const relevant = [...judgements].filter(([, grade]) => grade >= RELEVANT_FROM).map(([id]) => id);
  if (relevant.length === 0) return null;
  const top = new Set(ranking.slice(0, k));
  return relevant.filter((id) => top.has(id)).length / relevant.length;
}

export type SystemScore = { system: string; queries: number; ndcg10: number; mrr: number; recall10: number };

/**
 * One system's scores over many queries: the mean of each measure over the
 * queries where it is defined (a query with nothing relevant judged tells
 * nothing about ranking, so it is left out rather than scored 0).
 */
export function scoreSystem(system: string, runs: readonly { ranking: readonly string[]; judgements: Judgements }[], k = 10): SystemScore {
  const ndcgs: number[] = [];
  const rrs: number[] = [];
  const recalls: number[] = [];
  for (const run of runs) {
    const value = ndcg(run.ranking, run.judgements, k);
    if (value === null) continue;
    ndcgs.push(value);
    rrs.push(reciprocalRank(run.ranking, run.judgements));
    recalls.push(recallAt(run.ranking, run.judgements, k) ?? 0);
  }
  const mean = (values: number[]) => (values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length);
  return { system, queries: ndcgs.length, ndcg10: mean(ndcgs), mrr: mean(rrs), recall10: mean(recalls) };
}

/**
 * Each query's NDCG@k and reciprocal rank under one system, in query order,
 * with null where the query's ideal is 0 (left out of means, as above): the
 * paired comparison needs the same queries on both sides.
 */
export function perQuery(runs: readonly { ranking: readonly string[]; judgements: Judgements }[], k = 10): { ndcg: (number | null)[]; rr: (number | null)[] } {
  const ndcgs = runs.map((run) => ndcg(run.ranking, run.judgements, k));
  return { ndcg: ndcgs, rr: runs.map((run, index) => (ndcgs[index] === null ? null : reciprocalRank(run.ranking, run.judgements))) };
}

/**
 * The difference between two systems on the same queries, a − b, with a 95%
 * interval from the paired bootstrap: the queries are resampled with
 * replacement 1,000 times (a seeded generator, so a rerun gives the same
 * interval) and both systems are scored on each resample together, so what
 * varies between queries — some are simply harder — cancels out. Queries
 * either system leaves undefined are left out of both.
 */
export function pairedBootstrap(a: readonly (number | null)[], b: readonly (number | null)[], repeats = 1000, seed = 57): { mean: number; low: number; high: number; queries: number } {
  const differences: number[] = [];
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    if (a[index] != null && b[index] != null) differences.push(a[index]! - b[index]!);
  }
  const n = differences.length;
  if (n === 0) return { mean: 0, low: 0, high: 0, queries: 0 };
  let state = seed >>> 0;
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
  const means: number[] = [];
  for (let repeat = 0; repeat < repeats; repeat += 1) {
    let sum = 0;
    for (let draw = 0; draw < n; draw += 1) sum += differences[Math.floor(next() * n)]!;
    means.push(sum / n);
  }
  means.sort((x, y) => x - y);
  const at = (share: number) => means[Math.min(repeats - 1, Math.max(0, Math.round(share * (repeats - 1))))]!;
  return { mean: differences.reduce((sum, value) => sum + value, 0) / n, low: at(0.025), high: at(0.975), queries: n };
}

/**
 * The products a person is asked to judge for a query: every system's top k,
 * merged in turns so the first few are the ones any system would show first
 * (pooling, as TREC does), without repeats, leaving out what is judged.
 */
export function judgingPool(rankings: readonly (readonly string[])[], judged: ReadonlySet<string>, k = 10): string[] {
  const pool: string[] = [];
  const seen = new Set<string>();
  for (let position = 0; position < k; position += 1) {
    for (const ranking of rankings) {
      const id = ranking[position];
      if (id === undefined || seen.has(id)) continue;
      seen.add(id);
      if (!judged.has(id)) pool.push(id);
    }
  }
  return pool;
}
