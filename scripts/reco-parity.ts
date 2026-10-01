/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * E2 parity: the shop's Taste Graph run on a small shared fixture, so the Python port can be checked against it.
 */

/**
 * docs/adr/050.
 *
 *   pnpm exec tsx scripts/reco-parity.ts
 *
 * Reads research/reco_otto/tests/fixtures/parity-events.json (sessions in
 * OTTO's format), builds the Taste Graph with the shop's own code
 * (src/lib/reco/graph.ts and walk.ts) exactly as production does, walks it
 * from three sessions' histories, and writes every edge and every walk score
 * to parity-expected.json beside it. research/reco_otto/tests/test_parity.py
 * computes the same in Python and requires the same numbers. Run this again
 * whenever the shop's Taste Graph changes, and the Python test says whether
 * the port still matches.
 */

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { behaviourEdges, blend, type InteractionEvent, type InteractionKind } from "@/lib/reco/graph";
import { randomWalkWithRestart, seedVector } from "@/lib/reco/walk";

const FIXTURES = path.join("research", "reco_otto", "tests", "fixtures");
const KIND: Record<string, InteractionKind> = { clicks: "view", carts: "cart", orders: "purchase" };

type Session = { session: number; events: { aid: number; ts: number; type: "clicks" | "carts" | "orders" }[] };

async function main(): Promise<void> {
  const fixture = JSON.parse(await readFile(path.join(FIXTURES, "parity-events.json"), "utf8")) as { sessions: Session[]; walks: number[] };
  const events: InteractionEvent[] = fixture.sessions.flatMap((session) =>
    session.events.map((event) => ({ sessionId: String(session.session), productId: String(event.aid), kind: KIND[event.type]!, at: event.ts * 1000 })),
  );
  const now = Math.max(...events.map((event) => event.at));
  const { normalised, counts } = behaviourEdges(events, { now });
  const transitions = blend(normalised, new Map(), counts, { topK: 50 });

  const walks = fixture.walks.map((sessionId) => {
    const session = fixture.sessions.find((entry) => entry.session === sessionId)!;
    const history = session.events.map((event) => ({ productId: String(event.aid), kind: KIND[event.type]!, at: event.ts * 1000 }));
    const seeds = seedVector(history, { now: Math.max(...history.map((event) => event.at)) });
    const scores = randomWalkWithRestart(transitions, seeds);
    return { session: sessionId, seeds: Object.fromEntries(seeds), scores: Object.fromEntries(scores) };
  });

  const out = {
    note: "Written by scripts/reco-parity.ts from the shop's own Taste Graph; checked by research/reco_otto/tests/test_parity.py.",
    normalised: Object.fromEntries([...normalised].map(([aid, row]) => [aid, Object.fromEntries(row)])),
    // Rows as [neighbour, probability] pairs: a JavaScript object would list numeric keys in numeric order and lose the ranking.
    transitions: Object.fromEntries([...transitions].map(([aid, row]) => [aid, [...row]])),
    walks,
  };
  await writeFile(path.join(FIXTURES, "parity-expected.json"), `${JSON.stringify(out, null, 1)}\n`);
  console.log(`Wrote ${path.join(FIXTURES, "parity-expected.json")}: ${normalised.size} items, ${walks.length} walks.`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
