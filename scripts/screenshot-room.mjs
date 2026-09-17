/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Captures the room placement flow for the report: both measuring methods, on desktop and mobile.
 */

/**
 * The room page's screenshots cannot come from `scripts/screenshot.mjs`,
 * because every interesting state is several presses in: a method chosen, a
 * room measured, a piece placed. This walks the flow with the drawn sample room
 * (no photograph of anyone's home in the report) and writes the same
 * docs/report/screenshots files the rest of the report uses.
 *
 *   node scripts/screenshot-room.mjs
 */
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = "docs/report/screenshots";
const SOFA = "canova-3-seater-maxi-b07g2h3l4l";

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
];

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();

for (const viewport of VIEWPORTS) {
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  const shot = async (name) => {
    await page.waitForTimeout(600);
    const file = `${OUT}/room-${name}-${viewport.name}.png`;
    await page.screenshot({ path: file, fullPage: true });
    console.log(file);
  };

  await page.goto(`${BASE}/en/room?product=${SOFA}`, { waitUntil: "load" });
  await page.waitForTimeout(1200);
  await shot("methods");

  // Paper-free: choose the method, measure the sample room, then place the sofa.
  await page.locator('[data-agent-id="room:method-depth"]').check();
  await page.getByRole("button", { name: "Try the sample room" }).click();
  await page.locator('[data-agent-id="room:scan"]').getByText("Floor found").waitFor({ timeout: 30_000 });
  await shot("no-paper-floor");
  await page.getByRole("button", { name: "Place it" }).click();
  await page.getByRole("heading", { name: "Move it into place" }).waitFor();
  await shot("no-paper-placed");

  // The sheet method, for the same room, from the same photo.
  await page.getByRole("button", { name: "Back to the floor" }).click();
  await page.getByRole("button", { name: "Use a sheet of paper instead" }).click();
  await page.getByRole("heading", { name: "Mark the four corners of the sheet" }).waitFor();
  await shot("paper-corners");

  await context.close();
}

await browser.close();
