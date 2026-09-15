/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Taste Graph construction: behavioural and content edges and their blend.
 */

/**
 * The Taste Graph (A2, docs/PLAN.md 2.6): building the graph.
 *
 * Nodes are products. Edges say "someone who is interested in this is likely
 * to be interested in that". They come from two sources, blended per product:
 *
 * 1. BEHAVIOUR. Two products looked at, carted or bought in the same shopping
 *    session are related, more strongly when the events are close in time,
 *    stronger events, and recent:
 *
 *      w_ij = Σ over event pairs (e_i, e_j) in one session, within the window,
 *               √(weight(e_i) · weight(e_j)) · exp(−|t_i − t_j| / τ) · decay(age)
 *
 *    weight(e)  view 1, dwell of 30 s or more 2, wishlist 2, search click 1.5,
 *               This-or-That choice 2, cart 3, purchase 6
 *    √(·)       the geometric mean: a view next to a purchase counts √6 ≈ 2.4,
 *               more than a view but less than two purchases
 *    τ          10 minutes: events a minute apart are strongly related, an hour
 *               apart barely
 *    decay      0.5^(age / 30 days): last month's behaviour counts half
 *
 *    Popular products co-occur with everything, so raw weights would recommend
 *    bestsellers to everyone. Normalising by the geometric mean of the two
 *    products' weighted degrees removes that bias (as in cosine similarity):
 *
 *      ŵ_ij = w_ij / √(deg(i) · deg(j)),   deg(i) = Σ_j w_ij
 *
 * 2. CONTENT. For products nobody has interacted with yet (cold start), the
 *    cosine similarity of their content vectors, top M per product.
 *
 * 3. BLEND. How much to trust behaviour depends on how much of it there is:
 *
 *      A_ij = α_i · ŵ_ij + (1 − α_i) · c_ij,   α_i = n_i / (n_i + κ)
 *
 *    with n_i the number of interactions with product i and κ = 5: a product
 *    with 5 interactions trusts behaviour and content equally, one with 50 is
 *    91% behaviour, a new one is all content.
 *
 * Each product keeps its top 50 blended neighbours, normalised to sum to 1, so
 * a row is a probability distribution: the transition matrix P of the random
 * walk in walk.ts.
 */

export type InteractionKind = "view" | "dwell" | "cart" | "purchase" | "wishlist" | "search_click" | "tot_choice";

export type InteractionEvent = {
  sessionId: string;
  productId: string;
  kind: InteractionKind;
  /** Milliseconds since the epoch. */
  at: number;
  dwellSeconds?: number | null;
};

/** Seconds on a page for a dwell to count as real interest rather than a bounce. */
export const ENGAGED_DWELL_SECONDS = 30;

export function eventWeight(kind: InteractionKind, dwellSeconds?: number | null): number {
  switch (kind) {
    case "view":
      return 1;
    case "dwell":
      return (dwellSeconds ?? 0) >= ENGAGED_DWELL_SECONDS ? 2 : 0.5;
    case "search_click":
      return 1.5;
    case "wishlist":
    case "tot_choice":
      return 2;
    case "cart":
      return 3;
    case "purchase":
      return 6;
  }
}

export type Neighbours = Map<string, Map<string, number>>;

export type BehaviourOptions = {
  now: number;
  /** Only events this close together in a session relate two products. */
  windowMs?: number;
  tauMs?: number;
  halfLifeMs?: number;
};

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

function addEdge(edges: Neighbours, a: string, b: string, weight: number): void {
  let row = edges.get(a);
  if (row === undefined) {
    row = new Map();
    edges.set(a, row);
  }
  row.set(b, (row.get(b) ?? 0) + weight);
}

/** Raw and normalised behavioural edges, and interaction counts per product. */
export function behaviourEdges(events: readonly InteractionEvent[], options: BehaviourOptions) {
  const windowMs = options.windowMs ?? 30 * MINUTE;
  const tauMs = options.tauMs ?? 10 * MINUTE;
  const halfLifeMs = options.halfLifeMs ?? 30 * DAY;

  const counts = new Map<string, number>();
  const sessions = new Map<string, InteractionEvent[]>();
  for (const event of events) {
    counts.set(event.productId, (counts.get(event.productId) ?? 0) + 1);
    const list = sessions.get(event.sessionId) ?? [];
    list.push(event);
    sessions.set(event.sessionId, list);
  }

  const raw: Neighbours = new Map();
  for (const list of sessions.values()) {
    list.sort((a, b) => a.at - b.at);
    // Two pointers: for each event, only later events inside the window.
    for (let i = 0; i < list.length; i += 1) {
      const first = list[i]!;
      const firstWeight = eventWeight(first.kind, first.dwellSeconds);
      for (let j = i + 1; j < list.length; j += 1) {
        const second = list[j]!;
        const gap = second.at - first.at;
        if (gap > windowMs) break;
        if (second.productId === first.productId) continue;
        const age = Math.max(0, options.now - second.at);
        const weight =
          Math.sqrt(firstWeight * eventWeight(second.kind, second.dwellSeconds)) *
          Math.exp(-gap / tauMs) *
          0.5 ** (age / halfLifeMs);
        addEdge(raw, first.productId, second.productId, weight);
        addEdge(raw, second.productId, first.productId, weight);
      }
    }
  }

  const degree = new Map<string, number>();
  for (const [product, row] of raw) {
    let total = 0;
    for (const weight of row.values()) total += weight;
    degree.set(product, total);
  }

  const normalised: Neighbours = new Map();
  for (const [product, row] of raw) {
    const normRow = new Map<string, number>();
    for (const [neighbour, weight] of row) {
      normRow.set(neighbour, weight / Math.sqrt(degree.get(product)! * degree.get(neighbour)!));
    }
    normalised.set(product, normRow);
  }

  return { raw, normalised, counts, degree };
}

export type ContentItem = { id: string; vector: Float64Array; group?: string };

/**
 * Top-M content neighbours by cosine similarity (vectors must be unit length).
 *
 * All pairs is O(n²); with `group` set (the category), only products in the
 * same group are compared, which is where the similarity weighting puts almost
 * all of the mass anyway, and keeps a 5,000-product catalogue to seconds.
 */
export function contentEdges(items: readonly ContentItem[], { topM = 20, minSimilarity = 0.2 } = {}): Neighbours {
  const groups = new Map<string, ContentItem[]>();
  for (const item of items) {
    const key = item.group ?? "";
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  }

  const edges: Neighbours = new Map();
  for (const list of groups.values()) {
    for (const item of list) {
      const scored: [string, number][] = [];
      for (const other of list) {
        if (other.id === item.id) continue;
        let similarity = 0;
        for (let k = 0; k < item.vector.length; k += 1) similarity += item.vector[k]! * other.vector[k]!;
        if (similarity >= minSimilarity) scored.push([other.id, similarity]);
      }
      scored.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
      edges.set(item.id, new Map(scored.slice(0, topM)));
    }
  }
  return edges;
}

export type BlendOptions = { kappa?: number; topK?: number };

/**
 * A_ij = α_i · ŵ_ij + (1 − α_i) · c_ij, top K per product, rows normalised to 1.
 */
export function blend(behaviour: Neighbours, content: Neighbours, counts: ReadonlyMap<string, number>, options: BlendOptions = {}): Neighbours {
  const kappa = options.kappa ?? 5;
  const topK = options.topK ?? 50;
  const products = new Set([...behaviour.keys(), ...content.keys()]);

  const blended: Neighbours = new Map();
  for (const product of products) {
    const n = counts.get(product) ?? 0;
    const alpha = n / (n + kappa);
    const scores = new Map<string, number>();
    for (const [neighbour, weight] of behaviour.get(product) ?? []) scores.set(neighbour, alpha * weight);
    for (const [neighbour, similarity] of content.get(product) ?? []) {
      scores.set(neighbour, (scores.get(neighbour) ?? 0) + (1 - alpha) * similarity);
    }
    const top = [...scores].filter(([, score]) => score > 0).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, topK);
    const total = top.reduce((sum, [, score]) => sum + score, 0);
    if (total > 0) blended.set(product, new Map(top.map(([neighbour, score]) => [neighbour, score / total])));
  }
  return blended;
}
