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
 *   node scripts/screenshot.mjs --sign-in admin@vitrine.test /en/admin/ai
 *
 * With --sign-in it signs in first with a demo account (the password local
 * accounts share, .local/demo-password), which is how staff pages are
 * captured. Local stack only: those accounts exist nowhere else.
 */
import { chromium } from "@playwright/test";
import { mkdir, readFile } from "node:fs/promises";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = "docs/report/screenshots";

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
];

const args = process.argv.slice(2);
const signInIndex = args.indexOf("--sign-in");
const signInAs = signInIndex === -1 ? null : args[signInIndex + 1];
const routes = signInIndex === -1 ? args : args.filter((_, index) => index !== signInIndex && index !== signInIndex + 1);

/** Signs a page in with the local demo password, and waits for the account page. */
async function signIn(page, email) {
  const password = (await readFile(".local/demo-password", "utf8")).trim();
  await page.goto(`${BASE}/en/account/sign-in`, { waitUntil: "load" });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(/\/en\/account$/, { timeout: 30_000 });
}
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
    if (signInAs !== null) await signIn(page, signInAs);
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
