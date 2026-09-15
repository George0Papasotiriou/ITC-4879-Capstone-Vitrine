/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Runs Lighthouse against a local production build and fails when a page misses the performance budgets.
 */

/**
 * Lighthouse, run against a local production build (docs/PLAN.md 2.10, E7).
 *
 *   pnpm build && pnpm local:start --port 3100      (in another terminal)
 *   node scripts/lighthouse.mjs /en /el /en/c/lighting
 *
 * Lighthouse's own launcher fails to start Chrome from this Windows shell
 * ("spawn UNKNOWN"), so the browser is launched by Playwright — which works
 * here — with a remote-debugging port, and Lighthouse attaches to it.
 *
 * Budgets are the plan's: Performance >= 90 and Accessibility >= 95 on mobile.
 * The script exits non-zero if any page misses one, so it can gate a check.
 *
 * Local numbers are indicative, not final: they measure this machine, with no
 * CDN and no network latency. The plan's acceptance is on the deployed build.
 */
import { chromium } from "@playwright/test";
import lighthouse from "lighthouse";
import { mkdir, writeFile } from "node:fs/promises";

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const PORT = 9223;
const BUDGET = { performance: 90, accessibility: 95 };

const routes = process.argv.slice(2);
if (routes.length === 0) {
  console.error("Usage: node scripts/lighthouse.mjs <route> [route...]");
  process.exit(1);
}

const browser = await chromium.launch({
  args: [`--remote-debugging-port=${PORT}`],
});

await mkdir("docs/report/lighthouse", { recursive: true });
let failed = false;

try {
  for (const route of routes) {
    const url = `${BASE}${route}`;
    const result = await lighthouse(url, {
      port: PORT,
      output: "json",
      logLevel: "error",
      onlyCategories: ["performance", "accessibility", "best-practices", "seo"],
      formFactor: "mobile",
      screenEmulation: { mobile: true, width: 412, height: 823, deviceScaleFactor: 1.75, disabled: false },
    });

    if (result === undefined) throw new Error(`Lighthouse returned nothing for ${url}`);

    // A run that fails internally reports every category as null, which would
    // otherwise print as a score of 0 and look like a catastrophic regression.
    if (result.lhr.runtimeError !== undefined) {
      console.log(`ERR   ${route.padEnd(18)} Lighthouse failed: ${result.lhr.runtimeError.code} — rerun`);
      failed = true;
      continue;
    }

    const { categories, audits } = result.lhr;
    const score = (key) => Math.round((categories[key]?.score ?? 0) * 100);

    const perf = score("performance");
    const a11y = score("accessibility");
    const missed = perf < BUDGET.performance || a11y < BUDGET.accessibility;
    failed ||= missed;

    console.log(
      `${missed ? "MISS" : "ok  "}  ${route.padEnd(18)} ` +
        `perf ${perf}  a11y ${a11y}  best ${score("best-practices")}  seo ${score("seo")}  ` +
        `LCP ${audits["largest-contentful-paint"]?.displayValue}  ` +
        `CLS ${audits["cumulative-layout-shift"]?.displayValue}  ` +
        `TBT ${audits["total-blocking-time"]?.displayValue}`,
    );

    // Query strings become part of the name; characters Windows forbids in file names are replaced.
    const slug = route.replace(/^\//, "").replace(/[/?&=]/g, "-") || "root";
    await writeFile(`docs/report/lighthouse/${slug}-mobile.json`, result.report);
  }
} finally {
  await browser.close();
}

process.exit(failed ? 1 : 0);
