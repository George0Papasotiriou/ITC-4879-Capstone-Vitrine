/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Captures the Concierge handing a guest over to a person: the approval card, and the contact form it opens.
 */

/**
 *   node scripts/capture-handover.mjs
 *
 * Local stack only (`pnpm local:start`); demo mode, so no key and no cost.
 * Two screenshots per viewport: the card that shows the summary before
 * anything is sent, and the contact form with that summary written in.
 */
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = "docs/report/screenshots";
const REQUEST = "My lamp arrived with a cracked base, I want to talk to a person";

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
];

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();

for (const viewport of VIEWPORTS) {
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await page.goto(`${BASE}/en`, { waitUntil: "load" });
  await page.locator("html[data-concierge-ready]").waitFor({ timeout: 30_000 });
  await page.locator('[data-agent-id="nav:concierge-panel"]:visible, [data-agent-id="nav:concierge"]:visible').first().click();
  await page.locator('[data-agent-id="concierge:input"]').fill(REQUEST);
  await page.locator('[data-agent-id="concierge:send"]').click();
  const card = page.locator('[data-agent-id="concierge:approval:hand_to_person"]');
  await card.waitFor({ timeout: 45_000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/concierge-handover-approval-${viewport.name}.png` });
  console.log(`${OUT}/concierge-handover-approval-${viewport.name}.png`);

  await card.locator('[data-agent-id="concierge:approve"]').click();
  await page.waitForURL(/\/en\/contact$/, { timeout: 45_000 });
  await page.locator('[data-agent-id="support:from-concierge"]').waitFor({ timeout: 15_000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/contact-from-concierge-${viewport.name}.png`, fullPage: true });
  console.log(`${OUT}/contact-from-concierge-${viewport.name}.png`);
  await context.close();
}

await browser.close();
