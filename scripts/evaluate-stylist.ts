/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Evaluation E3: constraint satisfaction, optimality gap and utility of the Budget Stylist optimiser.
 */

/**
 * Evaluation E3: the Budget Stylist optimiser (docs/PLAN.md 2.6 A3, Phase 8).
 *
 *   pnpm evals:stylist            (starts the local database around the run)
 *
 * Four measurements, as the plan specifies:
 *
 *   1. Constraint satisfaction on 200 generated requests against the catalogue
 *      in the database: every bundle within budget, one product per required
 *      slot, right kinds, in stock, no avoided colour, within size limits.
 *      Must be 100%.
 *   2. Optimality gap against exhaustive search on 200 small synthetic
 *      instances (4 slots, up to 6 candidates): must be zero.
 *   3. Utility against the greedy baseline on 200 synthetic instances with
 *      K = 20 and 4 slots.
 *   4. Latency: p50 and p95 for all three bundles with K = 20 and 4 slots
 *      (plan: p95 ≤ 300 ms), and end to end through the database.
 *
 * Writes docs/report/evaluations/e3-stylist.md and .json. Deterministic: every
 * instance comes from a seeded generator, so a rerun measures the same problems.
 */

import { mkdir, writeFile } from "node:fs/promises";

import postgres from "postgres";

import { exhaustiveBundles, greedyBundle, optimizeBundles, type BundleProblem, type Candidate } from "@/lib/optimize/bundle";
import { TEMPLATE_IDS, TEMPLATES, fitsSize } from "@/lib/optimize/templates";
import { createRetrievers } from "@/lib/search/retrieve";
import { COLORS } from "@/lib/search/vocabulary";
import { createStylist } from "@/lib/stylist/stylist";

const OUT_DIR = "docs/report/evaluations";

function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Item = Candidate & { style: number; hue: number };

function synthetic(seed: number, perSlot: number, fixedSize: boolean): BundleProblem<Item> {
  const rng = random(seed);
  const slots = Array.from({ length: 4 }, (_, s) => ({
    id: `slot${s}`,
    required: s < 3 || rng() < 0.5,
    candidates: Array.from({ length: fixedSize ? perSlot : 1 + Math.floor(rng() * perSlot) }, (_, i) => ({
      id: `${s}-${i}`,
      priceCents: 2_000 + Math.floor(rng() * 80) * 1_000,
      affinity: 0.5 + rng(),
      style: rng(),
      hue: rng() * 360,
    })),
  }));
  const typical = slots.reduce((sum, slot) => sum + slot.candidates.reduce((a, c) => a + c.priceCents, 0) / slot.candidates.length, 0);
  return {
    slots,
    budgetCents: Math.round(typical * (0.6 + rng() * 0.8)),
    lambda: 0.35,
    compatibility: (x, y) => {
      const style = 1 - Math.abs(x.style - y.style);
      const difference = Math.abs(x.hue - y.hue) % 360;
      const hue = Math.min(difference, 360 - difference);
      const harmony = hue <= 30 ? 1 : hue >= 150 ? 0.8 : -0.5;
      return 0.6 * style + 0.4 * harmony;
    },
  };
}

const percentile = (values: number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
};
const round = (value: number, digits = 2) => Math.round(value * 10 ** digits) / 10 ** digits;

async function main(): Promise<void> {
  const out = (line = "") => process.stdout.write(`${line}\n`);

  // 2. Optimality gap on small instances.
  let gapInstances = 0;
  let gapFailures = 0;
  let maxGap = 0;
  for (let seed = 1; seed <= 200; seed += 1) {
    const problem = synthetic(seed, 6, false);
    const truth = exhaustiveBundles(problem)[0];
    const best = optimizeBundles(problem, { timeLimitMs: 60_000 }).bundles[0];
    if (truth === undefined) {
      if (best !== undefined) gapFailures += 1;
      continue;
    }
    gapInstances += 1;
    const gap = best === undefined ? Number.POSITIVE_INFINITY : truth.utility - best.utility;
    maxGap = Math.max(maxGap, gap);
    if (gap > 1e-9) gapFailures += 1;
  }
  out(`optimality: ${gapInstances} feasible instances, ${gapFailures} with a gap, max gap ${maxGap}`);

  // 3 and 4. Greedy baseline and latency at K = 20.
  const latencies: number[] = [];
  const improvements: number[] = [];
  let greedyInfeasible = 0;
  let beamFallbacks = 0;
  for (let seed = 10_001; seed <= 10_200; seed += 1) {
    const problem = synthetic(seed, 20, true);
    const result = optimizeBundles(problem);
    latencies.push(result.stats.elapsedMs);
    if (!result.stats.exact) beamFallbacks += 1;
    const best = result.bundles[0];
    const greedy = greedyBundle(problem);
    if (best === undefined) continue;
    if (greedy === null) {
      greedyInfeasible += 1;
      continue;
    }
    improvements.push((best.utility - greedy.utility) / Math.abs(greedy.utility));
  }
  const meanImprovement = improvements.reduce((a, b) => a + b, 0) / Math.max(1, improvements.length);
  out(`K=20 latency p50 ${round(percentile(latencies, 0.5))} ms, p95 ${round(percentile(latencies, 0.95))} ms; beam fallbacks ${beamFallbacks}`);
  out(`greedy: optimiser utility ${round(meanImprovement * 100, 1)}% higher on average; greedy found nothing on ${greedyInfeasible}`);

  // 1. Constraint satisfaction against the catalogue.
  const url = process.env.DATABASE_URL;
  if (url === undefined || url === "") throw new Error("DATABASE_URL is not set; run through `pnpm evals:stylist`.");
  const sql = postgres(url, { max: 4, onnotice: () => {} });
  const stylist = createStylist(sql, createRetrievers(sql));
  const productRows = await sql<{ id: string; kind: string; colors: string[]; dims_cm: { w: number; d: number; h: number } | null; price_cents: number; stock: number }[]>`
    SELECT p.id, p.kind, p.colors, p.dims_cm, p.price_cents,
           COALESCE((SELECT sum(v.stock) FROM product_variants v WHERE v.product_id = p.id), 0)::int AS stock
    FROM products p WHERE p.status = 'active'
  `;
  const products = new Map(productRows.map((row) => [row.id, row]));
  const colorIds = Object.keys(COLORS);

  let requests = 0;
  let withBundles = 0;
  let bundlesChecked = 0;
  const violations: string[] = [];
  const endToEnd: number[] = [];
  const rng = random(424_242);
  for (let i = 0; i < 200; i += 1) {
    const template = TEMPLATE_IDS[Math.floor(rng() * TEMPLATE_IDS.length)]!;
    const request = {
      template,
      budgetCents: (200 + Math.floor(rng() * 60) * 100) * 100,
      avoidColors: rng() < 0.5 ? [colorIds[Math.floor(rng() * colorIds.length)]!] : [],
      maxWidthCm: rng() < 0.3 ? 40 + Math.floor(rng() * 200) : undefined,
      query: rng() < 0.3 ? ["modern", "wood", "leather", "glass", "φωτιστικό", "kanapes"][Math.floor(rng() * 6)] : undefined,
    };
    requests += 1;
    const started = performance.now();
    const result = await stylist.build(request);
    endToEnd.push(performance.now() - started);
    if (result.bundles.length > 0) withBundles += 1;

    for (const bundle of result.bundles) {
      bundlesChecked += 1;
      const fail = (reason: string) => violations.push(`request ${i} (${template}): ${reason}`);
      if (bundle.totalCents > request.budgetCents) fail(`over budget ${bundle.totalCents} > ${request.budgetCents}`);
      for (const slot of TEMPLATES[template].slots) {
        const pick = bundle.picks.find((candidate) => candidate.slotId === slot.id);
        if (pick === undefined) {
          if (slot.required) fail(`required slot ${slot.id} empty`);
          continue;
        }
        const product = products.get(pick.productId);
        if (product === undefined) {
          fail(`unknown product ${pick.productId}`);
          continue;
        }
        if (!slot.kinds.includes(product.kind)) fail(`${slot.id} has kind ${product.kind}`);
        if (pick.unitPriceCents !== product.price_cents) fail(`${slot.id} price differs from the database`);
        if (pick.lineTotalCents !== product.price_cents * slot.quantity) fail(`${slot.id} line total wrong`);
        if (product.stock < slot.quantity) fail(`${slot.id} not enough stock`);
        if (product.colors.some((color) => request.avoidColors.includes(color))) fail(`${slot.id} in an avoided colour`);
        if (!fitsSize(product.dims_cm, [slot.size, request.maxWidthCm === undefined ? undefined : { maxWidthCm: request.maxWidthCm }])) {
          fail(`${slot.id} outside size limits`);
        }
      }
    }
  }
  await sql.end();
  const satisfaction = bundlesChecked === 0 ? 1 : 1 - new Set(violations.map((line) => line.split(":")[0])).size / Math.max(1, withBundles);
  out(`catalogue: ${requests} requests, ${withBundles} with bundles, ${bundlesChecked} bundles checked, ${violations.length} violations`);
  out(`end to end p50 ${round(percentile(endToEnd, 0.5))} ms, p95 ${round(percentile(endToEnd, 0.95))} ms`);

  const report = {
    generatedAt: new Date().toISOString(),
    optimality: { instances: gapInstances, withGap: gapFailures, maxGap },
    greedy: { instances: improvements.length, meanRelativeImprovement: meanImprovement, greedyInfeasible },
    latencyK20: { instances: latencies.length, p50Ms: percentile(latencies, 0.5), p95Ms: percentile(latencies, 0.95), maxMs: Math.max(...latencies), beamFallbacks },
    catalogue: { requests, withBundles, bundlesChecked, violations, satisfaction, endToEndP50Ms: percentile(endToEnd, 0.5), endToEndP95Ms: percentile(endToEnd, 0.95), products: products.size },
  };

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(`${OUT_DIR}/e3-stylist.json`, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(
    `${OUT_DIR}/e3-stylist.md`,
    `# E3: Budget Stylist optimiser

Generated ${report.generatedAt} by \`scripts/evaluate-stylist.ts\` on this machine
(${products.size} active products in the local database). Every instance comes
from a seeded generator, so a rerun measures the same problems.

| Measure | Plan target | Result |
|---|---|---|
| Constraint satisfaction, ${requests} catalogue requests (${bundlesChecked} bundles) | 100% | ${round(satisfaction * 100, 1)}% (${violations.length} violations) |
| Optimality gap vs exhaustive search, ${gapInstances} small instances | 0 | ${gapFailures === 0 ? "0 on every instance" : `${gapFailures} instances with a gap (max ${maxGap})`} |
| Utility vs greedy baseline, ${improvements.length} instances, K = 20, 4 slots | higher | ${round(meanImprovement * 100, 1)}% higher on average; greedy found no feasible bundle on ${greedyInfeasible} |
| Latency, three bundles, K = 20, 4 slots | p95 ≤ 300 ms | p50 ${round(percentile(latencies, 0.5))} ms, p95 ${round(percentile(latencies, 0.95))} ms, max ${round(Math.max(...latencies))} ms |
| Beam-search fallbacks at K = 20 | — | ${beamFallbacks} of ${latencies.length} |
| End to end through the database, catalogue requests | — | p50 ${round(percentile(endToEnd, 0.5))} ms, p95 ${round(percentile(endToEnd, 0.95))} ms |

## Method

- **Optimality.** Instances with four slots of one to six candidates, one optional
  slot half of the time, budgets between 60% and 140% of a typical bundle. The
  best bundle from branch and bound is compared with the best from enumerating
  every feasible bundle.
- **Greedy baseline.** Fills slots in order with the individually best affordable
  candidate that leaves room for the cheapest option of every later slot, and
  ignores compatibility. Relative improvement is (U_optimiser − U_greedy) / |U_greedy|.
- **Synthetic compatibility.** Style similarity from a hidden style value and
  colour harmony from a hidden hue, weighted 0.6 and 0.4 as in production, λ = 0.35.
- **Catalogue requests.** Random templates, budgets from €200 to €6,100, an avoided
  colour half of the time, a width limit 30% of the time, and look words (English,
  Greek, Greeklish) 30% of the time. Each returned bundle is checked against the
  database independently of the optimiser.

## Limits

- The local catalogue is the ${products.size}-product specimen until the full import runs,
  so many catalogue requests (bedroom, gift set) correctly return no bundle; they
  still count towards latency.
- Latency is measured on a development machine with PostgreSQL in WebAssembly;
  the production figure comes from the deployed build.
${violations.length > 0 ? `\n## Violations\n\n${violations.map((line) => `- ${line}`).join("\n")}\n` : ""}`,
  );
  out(`wrote ${OUT_DIR}/e3-stylist.md`);
  if (violations.length > 0 || gapFailures > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exitCode = 1;
});
