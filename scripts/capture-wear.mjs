/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Captures the screens of Phase 9 and Phase 7 that only exist after someone has used them.
 */

/**
 * The Fitting Room's result, Snap to shop's answer, the 3D dialog and a spoken
 * turn are all states a page reaches only by being used, so the report's
 * screenshots have to be taken by driving it:
 *
 *   node scripts/capture-wear.mjs
 *
 * Local stack only (`pnpm local:start`), and it uses the same drawn fixtures as
 * the end-to-end tests: nobody's photograph is in the repository.
 */
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = "docs/report/screenshots";
const PERSON = "tests/e2e/fixtures/person.webp";
const SCENE = "tests/e2e/fixtures/room-scene.webp";
const LAMP = "/en/p/faux-wood-table-lamp-b07mbfd87n";

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
];

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();

/** One shot per viewport, each in its own context so nothing is carried over. */
async function shot(name, drive) {
  for (const viewport of VIEWPORTS) {
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: 2 });
    const page = await context.newPage();
    await page.addInitScript(() => {
      window.vitrineVoiceScripted = true;
    });
    await drive(page);
    const file = `${OUT}/${name}-${viewport.name}.png`;
    await page.screenshot({ path: file, fullPage: true });
    console.log(file);
    await context.close();
  }
}

await shot("fitting-room-result", async (page) => {
  await page.goto(`${BASE}/en/fitting-room`, { waitUntil: "load" });
  await page.locator('[data-agent-id="fitting:consent"]').check();
  await page.locator('[data-agent-id="fitting:file"]').setInputFiles(PERSON);
  await page.locator('[data-agent-id="fitting:photo"]').waitFor({ timeout: 30_000 });
  await page.locator('[data-agent-id^="action:try-on:"]').first().click();
  await page.locator('[data-agent-id="fitting:result:done"]').waitFor({ timeout: 60_000 });
  await page.waitForTimeout(600);
});

await shot("snap-results", async (page) => {
  await page.goto(`${BASE}/en/snap`, { waitUntil: "load" });
  await page.locator('[data-agent-id="snap:consent"]').check();
  await page.locator('[data-agent-id="snap:file"]').setInputFiles(SCENE);
  await page.locator('[data-agent-id="snap:results"]').waitFor({ timeout: 45_000 });
  await page.waitForTimeout(600);
});

await shot("model-viewer", async (page) => {
  await page.goto(`${BASE}${LAMP}?view=model`, { waitUntil: "load" });
  await page.locator('[data-agent-id="model:viewer"]').waitFor({ timeout: 45_000 });
  // The first frame of a 3D view takes a moment after the element appears.
  await page.waitForTimeout(2_500);
});

await shot("concierge-voice", async (page) => {
  await page.goto(`${BASE}/en`, { waitUntil: "load" });
  await page.locator("html[data-concierge-ready]").waitFor({ timeout: 30_000 });
  await page.locator('[data-agent-id="nav:concierge-panel"]:visible, [data-agent-id="nav:concierge"]:visible').first().click();
  await page.locator('[data-agent-id="voice:start"]').click();
  await page.locator('[data-agent-id="voice:state"]').filter({ hasText: "Listening" }).waitFor({ timeout: 30_000 });
  await page.evaluate(() => window.vitrineVoice?.hear("show me green rugs"));
  await page.locator('[data-agent-id="concierge:message:assistant"]').first().waitFor({ timeout: 45_000 });
  await page.waitForTimeout(800);
});

await browser.close();
