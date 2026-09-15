/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Taste Graph command line: simulate synthetic shopper sessions and rebuild the recommendation graph.
 */

/**
 * Taste Graph commands (docs/PLAN.md Phase 8).
 *
 *   pnpm reco simulate [--sessions 1500] [--seed N] [--dry-run] [--if-empty]
 *       Generate SYNTHETIC shopper sessions from personas (src/lib/reco/simulate.ts),
 *       replacing earlier synthetic rows, then rebuild the graph. Real
 *       interactions are never touched. --if-empty skips the simulation when
 *       any interaction already exists (used by `pnpm db:setup` on deploy).
 *
 *   pnpm reco rebuild [--if-empty]
 *       Rebuild item_neighbors and popularity from the interactions table. In
 *       production this is the worker's nightly `rebuild-taste-graph` job.
 *       --if-empty skips the rebuild when neighbour lists already exist (the
 *       local stack runs this on start, so a new database recommends at once).
 *
 *   pnpm reco clear-synthetic
 *       Delete every synthetic interaction and rebuild.
 *
 * Runs through scripts/local.mjs, which provides the local database. No paid
 * service is involved.
 */

import { parseArgs } from "node:util";

import postgres from "postgres";
import { uuidv7 } from "uuidv7";

import { simulateSessions, type SimProduct } from "@/lib/reco/simulate";
import { createTasteGraph } from "@/lib/reco/store";

const out = (line = "") => process.stdout.write(`${line}\n`);

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const { values } = parseArgs({
    args: rest,
    options: {
      sessions: { type: "string", default: "1500" },
      seed: { type: "string", default: "20260913" },
      "dry-run": { type: "boolean", default: false },
      "if-empty": { type: "boolean", default: false },
    },
  });

  const url = process.env.DATABASE_URL;
  if (url === undefined || url === "") throw new Error("DATABASE_URL is not set; run through `pnpm reco`.");
  const sql = postgres(url, { max: 4, onnotice: () => {} });
  const graph = createTasteGraph(sql);

  try {
    if (command === "simulate") {
      // --if-empty makes this safe to run on every deploy: an existing history,
      // synthetic or real, is never replaced.
      if (values["if-empty"]) {
        const [row] = await sql<{ present: boolean }[]>`SELECT EXISTS (SELECT 1 FROM interactions) AS present`;
        if (row?.present === true) {
          out("[reco] interactions present; simulation skipped");
          return;
        }
      }
      const products = await sql<(Omit<SimProduct, "priceCents"> & { price_cents: number })[]>`
        SELECT p.id, p.kind, c.slug AS category, b.name AS brand, p.colors, p.materials, p.attributes, p.price_cents
        FROM products p JOIN categories c ON c.id = p.category_id LEFT JOIN brands b ON b.id = p.brand_id
        WHERE p.status = 'active'
      `;
      const catalogue: SimProduct[] = products.map(({ price_cents, ...row }) => ({ ...row, priceCents: price_cents }));
      const events = simulateSessions(catalogue, { sessions: Number(values.sessions), seed: Number(values.seed), now: Date.now() });
      out(`simulated ${values.sessions} sessions over ${catalogue.length} products: ${events.length} events (synthetic)`);
      if (values["dry-run"]) {
        out("--dry-run: nothing written.");
        return;
      }
      await sql.begin(async (tx) => {
        const removed = await tx`DELETE FROM interactions WHERE synthetic RETURNING id`;
        out(`removed ${removed.length} earlier synthetic events`);
        const rows = events.map((event) => ({
          id: uuidv7(),
          actor_id: event.actorId,
          session_id: event.sessionId,
          product_id: event.productId,
          kind: event.kind,
          dwell_seconds: event.dwellSeconds,
          synthetic: true,
          occurred_at: new Date(event.at).toISOString(),
        }));
        for (let start = 0; start < rows.length; start += 1_000) {
          await tx`INSERT INTO interactions ${tx(rows.slice(start, start + 1_000), "id", "actor_id", "session_id", "product_id", "kind", "dwell_seconds", "synthetic", "occurred_at")}`;
        }
      });
    } else if (command === "clear-synthetic") {
      const removed = await sql`DELETE FROM interactions WHERE synthetic RETURNING id`;
      out(`removed ${removed.length} synthetic events`);
    } else if (command === "rebuild" && values["if-empty"]) {
      const [row] = await sql<{ present: boolean }[]>`SELECT EXISTS (SELECT 1 FROM item_neighbors) AS present`;
      if (row?.present === true) {
        out("[reco] neighbour lists present; rebuild skipped");
        return;
      }
    } else if (command !== "rebuild") {
      out("Usage: pnpm reco <simulate|rebuild|clear-synthetic> [--sessions N] [--seed N] [--dry-run]");
      process.exitCode = 1;
      return;
    }

    const stats = await graph.rebuild();
    out(`rebuilt the Taste Graph: ${stats.events} events, ${stats.behaviourProducts} products with behaviour, ${stats.neighbourRows} neighbour rows in ${stats.elapsedMs} ms`);
  } finally {
    await sql.end();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`[reco] ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exitCode = 1;
});
