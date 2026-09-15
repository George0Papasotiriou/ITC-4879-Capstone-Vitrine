/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Captures full-page desktop and mobile screenshots of the given routes for the report.
 */

/**
 * Captures the pages named on the command line at the two viewports the
 * capstone report uses (docs/PLAN.md, /log step 6): 1440x900 desktop and
 * 390x844 mobile. Full-page, so a design review sees the whole thing.
 *
 *   node scripts/screenshot.mjs /design /
 */
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = "docs/report/screenshots";

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
];

const routes = process.argv.slice(2);
if (routes.length === 0) {
  console.error("Usage: node scripts/screenshot.mjs <route> [route...]");
  process.exit(1);
}

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();

for (const route of routes) {
  // Query strings become part of the name; characters Windows forbids in file names are replaced.
  const slug = route === "/" ? "home" : route.replace(/^\//, "").replace(/[/?&=%]/g, "-");

  for (const viewport of VIEWPORTS) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    // Not `networkidle`: Next prefetches every Link in the viewport, so the
    // network never goes quiet on a listing page.
    await page.goto(`${BASE}${route}`, { waitUntil: "load" });
    // Let the window-light sweep finish so it is not caught mid-flight.
    await page.waitForTimeout(1600);

    const file = `${OUT}/${slug}-${viewport.name}.png`;
    await page.screenshot({ path: file, fullPage: true });
    console.log(`${file}`);
    await context.close();
  }
}

await browser.close();
