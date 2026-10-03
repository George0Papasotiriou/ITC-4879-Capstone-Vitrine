/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * End-to-end tests for the room planner's 3D: a piece with a scan turns; a piece with only a photograph mirrors.
 */

import { expect, test, type Page } from "@playwright/test";

import { sampleRoomGeometry, SAMPLE_WIDTH } from "../../src/components/room/sample-room";

/**
 * docs/adr/052. "Only the shadow rotates" (George, 2026-10-03): the planner
 * stood a photograph up in the room. A piece with its own scan is now drawn as
 * the scan, with the camera the sheet gave, and turning it turns the piece.
 * The test catalogue's Angela coffee table carries a model for this
 * (scripts/e2e-scan.ts); the Canova sofa has only photographs, and mirrors.
 */

const SCANNED = "angela-modern-turned-leg-wood-shelf-storage-coffee-b07dbft2yg";
const PHOTO_ONLY = "canova-3-seater-maxi-b07g2h3l4l";

const stage = (page: Page) => page.locator('canvas[data-agent-id="room:stage"]');

async function placeInSampleRoom(page: Page, slug: string) {
  await page.goto(`/en/room?product=${slug}`, { waitUntil: "domcontentloaded" });
  const sample = page.getByRole("button", { name: "Try the sample room" });
  await expect(async () => {
    await sample.click();
    await expect(stage(page)).toBeVisible({ timeout: 1_000 });
  }).toPass();
  await stage(page).scrollIntoViewIfNeeded();
  const box = (await stage(page).boundingBox())!;
  const scale = box.width / SAMPLE_WIDTH;
  for (const [index, [x, y]] of sampleRoomGeometry().sheetImage.entries()) {
    await page.mouse.click(box.x + x * scale, box.y + y * scale);
    await expect(page.getByText(`${index + 1} of 4 corners marked`)).toBeVisible();
  }
  await page.getByRole("button", { name: "Place it" }).click();
  await expect(page.getByRole("heading", { name: "Move it into place" })).toBeVisible();
}

/** The picture on the stage, as the shopper would save it. */
const picture = (page: Page) => stage(page).evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL("image/png"));

test("@smoke a piece with its own 3D scan is drawn as the scan, and turning it turns the piece", async ({ page }) => {
  await placeInSampleRoom(page, SCANNED);
  await expect(page.locator('[data-agent-id="room:scan-note"]')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-agent-id="room:mirror"]')).toHaveCount(0);

  // The scan is in the picture: it is not the photograph and its shadow alone.
  await page.waitForTimeout(400);
  const before = await picture(page);
  await page.locator('[data-agent-id="room:rotate-right"]').click();
  await page.locator('[data-agent-id="room:rotate-right"]').click();
  await page.waitForTimeout(400);
  const turned = await picture(page);
  expect(turned).not.toBe(before);

  // The keyboard turns it the other way, back to where it started.
  await stage(page).focus();
  await page.keyboard.press("Shift+R");
  await page.keyboard.press("Shift+R");
  await page.waitForTimeout(400);
  expect(await picture(page)).toBe(before);
});

test("a piece with only a photograph says so, and mirrors instead of turning", async ({ page }) => {
  await placeInSampleRoom(page, PHOTO_ONLY);
  await expect(page.locator('[data-agent-id="room:photo-note"]')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('[data-agent-id="room:rotate-right"]')).toHaveCount(0);

  const mirror = page.locator('[data-agent-id="room:mirror"]');
  await expect(mirror).toHaveAttribute("aria-pressed", "false");
  const before = await picture(page);
  await mirror.click();
  await expect(mirror).toHaveAttribute("aria-pressed", "true");
  await page.waitForTimeout(300);
  expect(await picture(page)).not.toBe(before);
});
