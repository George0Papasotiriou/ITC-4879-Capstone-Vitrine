/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * End-to-end tests for the AR Mirror: a camera that never leaves the device, a face tracked, pieces drawn where they belong, and the real face model loading.
 */

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * docs/adr/065. The test machine has no camera, so the page's camera is a
 * canvas stream (getUserMedia replaced before the page loads, as the voice
 * tests replace the microphone). Most tests also replace the landmarker with
 * the scripted face (window.vitrineMirrorScripted), whose pose the test
 * sets; one test runs the real model to prove its files, hash and runtime
 * load under the page's security policy.
 */

test.describe.configure({ timeout: 120_000 });

const EARRINGS = "sterling-silver-6mm-polished-bead-stud-post-earrings-b00074cgs8";
const HAT = "men-s-wool-cashmere-ribbed-reversible-hat-b013r3phtu";
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/** A camera made of a canvas, and (unless `real`) a scripted face looking at it. */
async function fakeCamera(page: Page, { real = false, deny = false } = {}) {
  await page.addInitScript(
    ({ real, deny }) => {
      const w = window as unknown as { vitrineMirrorScripted?: boolean; vitrineMirrorFace?: unknown };
      if (!real) {
        w.vitrineMirrorScripted = true;
        w.vitrineMirrorFace = { yaw: 0, pitch: 0, roll: 0, distanceMm: 550, size: 1 };
      }
      navigator.mediaDevices.getUserMedia = async () => {
        if (deny) throw new DOMException("Permission denied", "NotAllowedError");
        const canvas = document.createElement("canvas");
        canvas.width = 1280;
        canvas.height = 720;
        const context = canvas.getContext("2d")!;
        let tick = 0;
        const paint = () => {
          context.fillStyle = "#8a8f99";
          context.fillRect(0, 0, 1280, 720);
          context.fillStyle = "#d9b99b";
          context.fillRect(560 + (tick % 2), 200, 160, 220);
          tick += 1;
          requestAnimationFrame(paint);
        };
        paint();
        return canvas.captureStream(30);
      };
    },
    { real, deny },
  );
}

async function open(page: Page, piece: string) {
  await expect(async () => {
    await page.goto(`/en/mirror?piece=${piece}`, { waitUntil: "domcontentloaded" });
    await page.locator("html[data-concierge-ready]").waitFor({ timeout: 15_000 });
  }).toPass({ timeout: 50_000 });
}

const stage = (page: Page) => page.locator('[data-agent-id="mirror:stage"]');

test("@smoke the mirror tracks a face and wears earrings at both ears, losing the far one as the head turns", async ({ page }) => {
  await fakeCamera(page);
  await open(page, EARRINGS);
  // The promises come first, and the camera only starts when asked.
  await expect(page.locator('[data-agent-id="mirror:intro"]')).toContainText("Nothing is recorded, sent or kept by the shop.");
  const results = await new AxeBuilder({ page }).include('[data-agent-id="mirror:page"]').withTags(TAGS).analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);

  await page.locator('[data-agent-id="mirror:start"]').click();
  await expect(stage(page)).toHaveAttribute("data-mirror-tracking", "tracking");
  await expect(page.locator('[data-agent-id="mirror:status"]')).toHaveText("Tracking your face");
  await expect(stage(page)).toHaveAttribute("data-mirror-drawn", "2");
  await expect(stage(page)).toHaveAttribute("data-mirror-scale", "1.00");
  await expect(page.locator('[data-agent-id="mirror:size-note"]')).toContainText("Drawn 6 mm long, as its listing says.");

  // Turned well away, the far earlobe is behind the face.
  await page.evaluate(() => {
    (window as unknown as { vitrineMirrorFace: { yaw: number } }).vitrineMirrorFace.yaw = 55;
  });
  await expect(stage(page)).toHaveAttribute("data-mirror-drawn", "1");
  await expect(stage(page)).toHaveAttribute("data-mirror-yaw", /^5[0-9]$/);

  // A picture is saved to the shopper's own downloads, never sent.
  const download = page.waitForEvent("download");
  await page.locator('[data-agent-id="mirror:save"]').click();
  expect((await download).suggestedFilename()).toBe(`vitrine-mirror-${EARRINGS}.png`);

  await page.locator('[data-agent-id="mirror:stop"]').click();
  await expect(page.locator('[data-agent-id="mirror:room"]')).toHaveAttribute("data-mirror-phase", "intro");
});

test("a hat is drawn on the head, and pieces can be changed while the mirror runs", async ({ page }) => {
  await fakeCamera(page);
  await open(page, EARRINGS);
  await page.locator('[data-agent-id="mirror:start"]').click();
  await expect(stage(page)).toHaveAttribute("data-mirror-drawn", "2");
  await page.locator('[data-agent-id="mirror:filter:HAT"]').click();
  await page.locator(`[data-agent-id="mirror:piece:${HAT}"]`).click();
  await expect(stage(page)).toHaveAttribute("data-mirror-drawn", "1");
  await expect(page.locator('[data-agent-id="mirror:size-note"]')).toContainText("Sized to your head.");
});

test("a refused camera is explained, and the mirror can be tried again", async ({ page }) => {
  await fakeCamera(page, { deny: true });
  await open(page, EARRINGS);
  await page.locator('[data-agent-id="mirror:start"]').click();
  await expect(page.locator('[data-agent-id="mirror:problem"]')).toContainText("The camera was not allowed.");
  await expect(page.locator('[data-agent-id="mirror:start"]')).toHaveText("Try again");
});

test("the real face model loads from the shop's own files and looks for a face", async ({ page }) => {
  const external: string[] = [];
  page.on("request", (request) => {
    if (!request.url().startsWith(new URL(page.url() || "http://localhost").origin) && !request.url().startsWith("data:") && !request.url().startsWith("blob:")) external.push(request.url());
  });
  await fakeCamera(page, { real: true });
  await open(page, EARRINGS);
  external.length = 0;
  await page.locator('[data-agent-id="mirror:start"]').click();
  // Downloaded, checked against its hash and started: the canvas has no face, so it keeps looking.
  await expect(page.locator('[data-agent-id="mirror:room"]')).toHaveAttribute("data-mirror-phase", "live", { timeout: 60_000 });
  await expect(page.locator('[data-agent-id="mirror:status"]')).toHaveText("Looking for your face…");
  await expect(page.locator('[data-agent-id="mirror:problem"]')).toHaveCount(0);
  // Nothing about the camera or the model went to anyone else.
  expect(external).toEqual([]);
});

test("a pair of earrings offers the live mirror from its page", async ({ page }) => {
  await expect(async () => {
    await page.goto(`/en/p/${EARRINGS}`, { waitUntil: "domcontentloaded" });
    await page.locator("html[data-concierge-ready]").waitFor({ timeout: 15_000 });
  }).toPass({ timeout: 50_000 });
  await page.getByRole("link", { name: "Try it on live in the Mirror" }).click();
  await expect(page).toHaveURL(new RegExp(`/en/mirror\\?piece=${EARRINGS}$`));
  await expect(page.locator(`[data-agent-id="mirror:piece:${EARRINGS}"]`)).toHaveAttribute("aria-pressed", "true");
});
