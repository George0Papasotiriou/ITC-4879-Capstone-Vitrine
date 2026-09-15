/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Simulates synthetic shopper sessions from personas.
 */

import type { ProductFeatures } from "@/lib/reco/content-vector";
import type { InteractionKind } from "@/lib/reco/graph";

/**
 * Simulated shoppers (Phase 8, step 4): behaviour for the Taste Graph to learn
 * from before real shoppers arrive. SYNTHETIC — every generated row is marked
 * `synthetic = true`, excluded from the E2 evaluation, and removable at once.
 *
 * A persona is a taste: preferred categories, colours and materials, and a
 * price level. A session starts from a product the persona likes and wanders,
 * at each step picking the next product with probability proportional to
 * exp(β · appeal), where appeal is how well a product matches the persona plus
 * a bonus for staying near the previous product. So sessions are coherent the
 * way real ones are — someone furnishing a warm reading corner looks at wooden
 * side tables after an oak chair — which is exactly the structure the
 * behavioural edges should recover.
 *
 * Deterministic for a given seed, so the simulated graph is reproducible.
 */

export type Persona = {
  id: string;
  categories: readonly string[];
  colors: readonly string[];
  materials: readonly string[];
  /** Typical spend per item in euros; appeal falls off on a log scale away from it. */
  priceEuros: number;
};

export const PERSONAS: readonly Persona[] = [
  { id: "warm-minimal", categories: ["tables", "lighting", "seating"], colors: ["white", "beige", "brown"], materials: ["wood", "oak", "linen", "ceramic"], priceEuros: 150 },
  { id: "dark-industrial", categories: ["lighting", "seating", "tables"], colors: ["black", "grey", "silver"], materials: ["metal", "glass", "leather"], priceEuros: 250 },
  { id: "classic-comfort", categories: ["seating", "rugs", "bedroom"], colors: ["brown", "red", "beige", "gold"], materials: ["leather", "velvet", "wool", "wood"], priceEuros: 600 },
  { id: "bright-eclectic", categories: ["accents", "wall-decor", "lighting", "rugs"], colors: ["blue", "green", "yellow", "pink", "orange"], materials: ["ceramic", "glass", "cotton"], priceEuros: 90 },
];

export type SimProduct = ProductFeatures & { id: string };

export type SimulatedEvent = {
  actorId: string;
  sessionId: string;
  productId: string;
  kind: InteractionKind;
  dwellSeconds: number | null;
  at: number;
};

export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function appeal(persona: Persona, product: SimProduct): number {
  const overlap = (wanted: readonly string[], have: readonly string[]) => (have.some((value) => wanted.includes(value)) ? 1 : 0);
  const priceDistance = Math.abs(Math.log10(Math.max(1, product.priceCents / 100)) - Math.log10(persona.priceEuros));
  return (
    1.5 * (persona.categories.includes(product.category) ? 1 : 0) +
    1.0 * overlap(persona.colors, product.colors) +
    1.0 * overlap(persona.materials, product.materials) -
    1.2 * priceDistance
  );
}

function similarity(a: SimProduct, b: SimProduct): number {
  const shared = (x: readonly string[], y: readonly string[]) => x.filter((value) => y.includes(value)).length;
  return (a.category === b.category ? 0.6 : 0) + 0.3 * shared(a.colors, b.colors) + 0.3 * shared(a.materials, b.materials) + (a.kind === b.kind ? -0.4 : 0);
}

function pick<T>(items: readonly T[], weights: readonly number[], random: () => number): T {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let threshold = random() * total;
  for (let i = 0; i < items.length; i += 1) {
    threshold -= weights[i]!;
    if (threshold <= 0) return items[i]!;
  }
  return items[items.length - 1]!;
}

export type SimulationOptions = {
  sessions: number;
  seed?: number;
  now: number;
  /** Spread sessions over this many days before `now`. */
  days?: number;
  beta?: number;
};

export function simulateSessions(products: readonly SimProduct[], options: SimulationOptions): SimulatedEvent[] {
  if (products.length < 2) return [];
  const random = seededRandom(options.seed ?? 20_260_913);
  const beta = options.beta ?? 1.6;
  const days = options.days ?? 30;
  const events: SimulatedEvent[] = [];
  const shoppers = Math.max(1, Math.round(options.sessions / 3));

  for (let s = 0; s < options.sessions; s += 1) {
    const persona = PERSONAS[Math.floor(random() * PERSONAS.length)]!;
    const actorId = `sim-${persona.id}-${Math.floor(random() * shoppers)}`;
    const sessionId = `sim-session-${s}`;
    let at = options.now - Math.floor(random() * days * 24 * 3_600_000);
    const length = 3 + Math.floor(random() * 8);

    const appeals = products.map((product) => appeal(persona, product));
    let current = pick(products, appeals.map((value) => Math.exp(beta * value)), random);
    const visited = new Set<string>();

    for (let step = 0; step < length; step += 1) {
      visited.add(current.id);
      const personaAppeal = appeals[products.indexOf(current)]!;
      const dwell = Math.round(8 + random() * 40 + 25 * Math.max(0, personaAppeal));
      events.push({ actorId, sessionId, productId: current.id, kind: "view", dwellSeconds: null, at });
      events.push({ actorId, sessionId, productId: current.id, kind: "dwell", dwellSeconds: dwell, at: at + dwell * 1_000 });
      at += (dwell + 5 + Math.floor(random() * 60)) * 1_000;

      if (personaAppeal > 1.5 && random() < 0.2) {
        events.push({ actorId, sessionId, productId: current.id, kind: "cart", dwellSeconds: null, at });
        at += 10_000;
        if (random() < 0.3) {
          events.push({ actorId, sessionId, productId: current.id, kind: "purchase", dwellSeconds: null, at });
          at += 60_000;
        }
      }

      const candidates = products.filter((product) => !visited.has(product.id));
      if (candidates.length === 0) break;
      const from = current;
      current = pick(
        candidates,
        candidates.map((product) => Math.exp(beta * (appeals[products.indexOf(product)]! + similarity(from, product)))),
        random,
      );
    }
  }
  return events;
}
