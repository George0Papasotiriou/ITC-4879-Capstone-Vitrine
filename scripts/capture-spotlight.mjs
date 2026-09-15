/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Captures the Spotlight animation frame by frame for the capstone report.
 */

/**
 * Captures the Spotlight sequence frame by frame for the capstone report.
 *
 * The interaction is the thing that has to be demonstrated (complexity row 23,
 * student-designed animation), and a still of the finished state shows none of
 * it. This grabs the light in flight and on arrival.
 *
 * It captures a `highlight` command rather than a filter change: highlighting
 * alters no state, so the ring and caption stay up for the full hold and the
 * frames are reproducible. Scale factor is 1 because a retina capture takes
 * longer than the animation phase it is trying to catch.
 */
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = "docs/report/screenshots";
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  reducedMotion: "no-preference",
});

await page.goto(`${BASE}/en/design`, { waitUntil: "load" });
await page.waitForTimeout(800);

// Put the demo listing and the dock on screen together, so the light's whole
// path from dock to product is inside the frame.
await page.locator("#specimen").evaluate((element) => {
  element.scrollIntoView({ block: "start", behavior: "instant" });
  window.scrollBy(0, 260);
});
await page.waitForTimeout(500);

const button = page.locator("#specimen").getByRole("button", {
  name: "Point at one product",
});

// Fire without awaiting so the clock starts with the animation.
const started = Date.now();
void button.click({ noWaitAfter: true });

const frames = [
  { at: 300, name: "spotlight-1-light-in-flight" },
  { at: 900, name: "spotlight-2-arrived-with-caption" },
];

for (const frame of frames) {
  const remaining = frame.at - (Date.now() - started);
  if (remaining > 0) await page.waitForTimeout(remaining);
  await page.screenshot({ path: `${OUT}/${frame.name}.png` });
  console.log(`${OUT}/${frame.name}.png  (t=${Date.now() - started}ms)`);
}

// And the settled state, with the action recorded in the timeline.
await page.waitForTimeout(2500);
await page.screenshot({ path: `${OUT}/spotlight-3-timeline.png` });
console.log(`${OUT}/spotlight-3-timeline.png`);

await browser.close();
