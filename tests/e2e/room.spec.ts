/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * End-to-end room placement flow with the sample room.
 */

import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";

import { sampleRoomGeometry, SAMPLE_WIDTH } from "../../src/components/room/sample-room";

/**
 * See it in your room (A4, Phase 10) with the drawn sample room, whose sheet
 * corners are known exactly, so the flow and the geometry are checked together.
 */

const SOFA = "canova-3-seater-maxi-b07g2h3l4l";

/** Page coordinates of a point in the sample photo. */
async function toPage(page: Page, [x, y]: [number, number]) {
  const box = (await page.locator('canvas[data-agent-id="room:stage"]').boundingBox())!;
  const scale = box.width / SAMPLE_WIDTH;
  return { x: box.x + x * scale, y: box.y + y * scale };
}

async function openSample(page: Page) {
  await page.goto(`/en/room?product=${SOFA}`, { waitUntil: "domcontentloaded" });
  const sample = page.getByRole("button", { name: "Try the sample room" });
  // Retry until hydrated: a click before hydration does nothing.
  await expect(async () => {
    await sample.click();
    await expect(page.locator('canvas[data-agent-id="room:stage"]')).toBeVisible({ timeout: 1_000 });
  }).toPass();
  await page.locator('canvas[data-agent-id="room:stage"]').scrollIntoViewIfNeeded();
}

test("@smoke marking the sheet in the sample room recovers the camera and places the sofa", async ({ page }) => {
  await openSample(page);
  const { sheetImage } = sampleRoomGeometry();

  // Tap roughly: a few pixels off each corner, as a finger would.
  const offsets: [number, number][] = [[4, -3], [-3, 4], [3, 3], [-4, -2]];
  for (const [index, corner] of sheetImage.entries()) {
    const point = await toPage(page, [corner[0] + offsets[index]![0], corner[1] + offsets[index]![1]]);
    await page.mouse.click(point.x, point.y);
    await expect(page.getByText(`${index + 1} of 4 corners marked`)).toBeVisible();
  }

  const floor = page.locator('[data-agent-id="room:floor"]');
  await expect(floor.getByText("Floor found")).toBeVisible();
  // The sample camera is 1.4 m above the floor; the corners snap to the paper's edges.
  await expect(floor.getByText("Camera about 1.4 m above the floor")).toBeVisible();

  await page.getByRole("button", { name: "Place it" }).click();
  await expect(page.getByRole("heading", { name: "Move it into place" })).toBeVisible();
  const readout = page.locator('[data-agent-id="room:readout"]');
  await expect(readout.getByText("233 × 102 × 93 cm")).toBeVisible();
  await expect(readout.getByText(/About 1\.\d m from the camera/)).toBeVisible();

  // Drag it further away: the distance readout grows.
  await page.locator('canvas[data-agent-id="room:stage"]').scrollIntoViewIfNeeded();
  const start = await toPage(page, [800, 900]);
  const end = await toPage(page, [800, 520]);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
  await expect(readout.getByText(/About [2-9]\.\d m from the camera/)).toBeVisible();
});

test("the sheet can be marked and the piece moved with the keyboard alone", async ({ page }) => {
  await openSample(page);
  const { sheetImage } = sampleRoomGeometry();
  const canvas = page.locator('canvas[data-agent-id="room:stage"]');
  await canvas.focus();

  const box = (await canvas.boundingBox())!;
  const scale = box.width / SAMPLE_WIDTH;
  // The marker starts in the middle of the photo; arrows move it 2 px, 20 px with Shift.
  let at: [number, number] = [box.width / 2, box.height / 2];
  for (const [index, corner] of sheetImage.entries()) {
    const target = [corner[0] * scale, corner[1] * scale];
    for (const axis of [0, 1] as const) {
      const delta = target[axis]! - at[axis];
      const [less, more] = axis === 0 ? ["ArrowLeft", "ArrowRight"] : ["ArrowUp", "ArrowDown"];
      const key = delta < 0 ? less : more;
      const coarse = Math.floor(Math.abs(delta) / 20);
      for (let i = 0; i < coarse; i += 1) await page.keyboard.press(`Shift+${key}`);
      const fine = Math.round((Math.abs(delta) - coarse * 20) / 2);
      for (let i = 0; i < fine; i += 1) await page.keyboard.press(key!);
      at = axis === 0 ? [at[0] + Math.sign(delta) * (coarse * 20 + fine * 2), at[1]] : [at[0], at[1] + Math.sign(delta) * (coarse * 20 + fine * 2)];
    }
    await page.keyboard.press("Enter");
    await expect(page.getByText(`${index + 1} of 4 corners marked`)).toBeVisible();
  }
  await expect(page.getByText("Camera about 1.4 m above the floor")).toBeVisible();

  await page.keyboard.press("Backspace");
  await expect(page.getByText("3 of 4 corners marked")).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Floor found")).toBeVisible();

  await page.getByRole("button", { name: "Place it" }).click();
  await canvas.focus();
  const readout = page.locator('[data-agent-id="room:readout"]');
  const before = await readout.getByText(/from the camera/).innerText();
  for (let i = 0; i < 6; i += 1) await page.keyboard.press("Shift+ArrowUp");
  await expect(readout.getByText(/from the camera/)).not.toHaveText(before);
  await page.keyboard.press("r");
  await expect(page.getByText("Turned right by 15°")).toBeAttached();
});

test("an uploaded photo opens for marking, and a file that is not a photo says what to do", async ({ page }) => {
  await page.goto(`/en/room?product=${SOFA}`, { waitUntil: "domcontentloaded" });
  const input = page.locator('input[type="file"]');

  await expect(async () => {
    await input.setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("not a photo") });
    await expect(page.getByText("This photo could not be opened. Try a JPEG or PNG photo.")).toBeVisible({ timeout: 1_000 });
  }).toPass();

  const png = await sharp({ create: { width: 1200, height: 900, channels: 3, background: { r: 150, g: 120, b: 90 } } })
    .composite([{ input: Buffer.from('<svg width="1200" height="900"><polygon points="500,600 700,590 720,680 480,690" fill="white"/></svg>'), top: 0, left: 0 }])
    .png()
    .toBuffer();
  await input.setInputFiles({ name: "room.png", mimeType: "image/png", buffer: png });
  await expect(page.getByRole("heading", { name: "Mark the four corners of the sheet" })).toBeVisible();
  await expect(page.getByText("0 of 4 corners marked")).toBeVisible();
  await expect(page.getByText("The photo does not say which lens took it.")).toBeVisible();
});

test("without a product the page offers pieces that stand on the floor, and wall lights are not offered", async ({ page }) => {
  await page.goto("/en/room", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Choose a piece to place" })).toBeVisible();
  const choices = page.locator('[data-agent-id^="room-choice:"]');
  expect(await choices.count()).toBeGreaterThan(5);
  await expect(page.getByRole("link", { name: /Modern Wall Sconce/ })).toHaveCount(0);

  await page.goto("/en/room?product=modern-wall-sconce-with-bulb-b07hk85jkq", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("status")).toContainText("cannot be placed in a room photo yet");
});

test("product pages link to the room only for pieces that can be placed", async ({ page }) => {
  await page.goto(`/en/p/${SOFA}`, { waitUntil: "domcontentloaded" });
  await page.getByRole("link", { name: "See it in your room" }).click();
  await expect(page).toHaveURL(new RegExp(`/en/room\\?product=${SOFA}`));

  await page.goto("/en/p/modern-wall-sconce-with-bulb-b07hk85jkq", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("link", { name: "See it in your room" })).toHaveCount(0);
});

/**
 * The paper-free mode (ADR-014). The drawn room's depth is known exactly, so
 * this exercises the whole flow — choose the method, measure, judge, place —
 * and checks the geometry against the camera the room was drawn with: 1.4 m up.
 */
test("@smoke a shopper can place a piece without a sheet of paper", async ({ page }) => {
  await page.goto(`/en/room?product=${SOFA}`, { waitUntil: "domcontentloaded" });

  // Choose the paper-free method, then the sample room.
  const withoutPaper = page.locator('[data-agent-id="room:method-depth"]');
  await expect(async () => {
    await withoutPaper.check({ timeout: 2_000 });
    await expect(withoutPaper).toBeChecked({ timeout: 1_000 });
  }).toPass();
  await page.getByRole("button", { name: "Try the sample room" }).click();

  const scan = page.locator('[data-agent-id="room:scan"]');
  await expect(scan.getByText("Floor found")).toBeVisible({ timeout: 20_000 });
  // The sample room was drawn from 1.4 m above the floor, and nothing was marked by hand.
  await expect(scan.getByText("Camera about 1.4 m above the floor")).toBeVisible();
  await expect(scan.getByText(/Floor in view: [5-9]\d%|Floor in view: 100%/)).toBeVisible();

  await page.getByRole("button", { name: "Place it" }).click();
  await expect(page.getByRole("heading", { name: "Move it into place" })).toBeVisible();
  const readout = page.locator('[data-agent-id="room:readout"]');
  await expect(readout.getByText("233 × 102 × 93 cm")).toBeVisible();
  await expect(readout.getByText(/About \d\.\d m from the camera/)).toBeVisible();

  // Back to the floor, and the height can be corrected by hand.
  await page.getByRole("button", { name: "Back to the floor" }).click();
  const height = page.locator('[data-agent-id="room:camera-height"]');
  await expect(height).toBeVisible();
  await height.fill("1.8");
  await expect(page.locator('[data-agent-id="room:scan"]').getByText("Camera about 1.8 m above the floor")).toBeVisible();
});

test("the paper-free mode and the sheet method can be swapped without losing the photo", async ({ page }) => {
  await openSample(page);
  // Started with the sheet method: switch to measuring instead.
  await page.getByRole("button", { name: "Without paper" }).click();
  await expect(page.getByRole("heading", { name: "Finding the floor" })).toBeVisible();
  await expect(page.locator('[data-agent-id="room:scan"]').getByText("Floor found")).toBeVisible({ timeout: 20_000 });

  // And back again: the sheet stage is waiting, with no corners marked.
  await page.getByRole("button", { name: "Use a sheet of paper instead" }).click();
  await expect(page.getByRole("heading", { name: "Mark the four corners of the sheet" })).toBeVisible();
  await expect(page.getByText("0 of 4 corners marked")).toBeVisible();
});

test("a real photo says the measurement model is not installed, and offers the sheet", async ({ page }) => {
  await page.goto(`/en/room?product=${SOFA}`, { waitUntil: "domcontentloaded" });
  const withoutPaper = page.locator('[data-agent-id="room:method-depth"]');
  await expect(async () => {
    await withoutPaper.check({ timeout: 2_000 });
    await expect(withoutPaper).toBeChecked({ timeout: 1_000 });
  }).toPass();

  const png = await sharp({ create: { width: 900, height: 675, channels: 3, background: { r: 150, g: 120, b: 90 } } })
    .png()
    .toBuffer();
  await page.locator('input[type="file"]').setInputFiles({ name: "room.png", mimeType: "image/png", buffer: png });

  const error = page.locator('[data-agent-id="room:scan-error"]');
  await expect(error).toContainText("not installed in this shop yet", { timeout: 20_000 });
  await page.getByRole("button", { name: "Use a sheet of paper instead" }).click();
  await expect(page.getByRole("heading", { name: "Mark the four corners of the sheet" })).toBeVisible();
});
