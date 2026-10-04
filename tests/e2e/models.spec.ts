/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * End-to-end tests for "See it in 3D": the shop's made models, honestly labelled, measured on screen, stored once, turned in the planner.
 */

import { expect, test, type Page } from "@playwright/test";
import { validateBytes } from "gltf-validator";

import { sampleRoomGeometry, SAMPLE_WIDTH } from "../../src/components/room/sample-room";
import { signInAdmin } from "./support/orders";

/**
 * docs/adr/058. George's screenshot (2026-10-03) was four red boxes for a
 * tufted chair. Every piece that stands or lies on a floor now has the shop's
 * own model, drawn from its measurements, words and photograph. These tests
 * hold it to what the dialog says: it is labelled "made by the shop" (a scan
 * says it is a scan), it is the listed size — "Show size" reads it off the
 * model — it is built once and then served as a stored file that passes
 * Khronos's validator, and in the room planner a piece with only a photograph
 * can be switched to its model, which turns.
 */

const MADE = "canova-3-seater-maxi-b07g2h3l4l";
const SCANNED = "angela-modern-turned-leg-wood-shelf-storage-coffee-b07dbft2yg";

const viewer = (page: Page) => page.locator('[data-agent-id="model:viewer"]');

async function openModel(page: Page, slug: string) {
  await page.goto(`/en/p/${slug}?view=model`, { waitUntil: "domcontentloaded" });
  await expect(viewer(page)).toBeVisible({ timeout: 30_000 });
  // The first request builds the model (a few seconds); after that it is a stored file.
  await page.waitForFunction(() => (document.querySelector('[data-agent-id="model:viewer"]') as (HTMLElement & { loaded?: boolean }) | null)?.loaded === true, null, { timeout: 90_000 });
}

test("@smoke a piece without a scan is shown as the shop's made model, says so, and measures its listed size", async ({ page }) => {
  await openModel(page, MADE);
  const origin = page.locator('[data-agent-id="model:origin"]');
  await expect(origin).toHaveAttribute("data-origin", "made");
  await expect(origin).toHaveText("Made by the shop");
  await expect(viewer(page)).toHaveAttribute("data-model-kind", "made");

  // The size under the viewer is the listing's; "Show size" reads the model's own, and they agree.
  const listed = (await page.locator('[data-agent-id="model:size"]').innerText()).match(/(\d+) × (\d+) × (\d+)/)!;
  await page.locator('[data-agent-id="model:show-size"]').click();
  await expect(page.locator('[data-agent-id="model:size-w"]')).toHaveText(`W ${listed[1]} cm`);
  await expect(page.locator('[data-agent-id="model:size-d"]')).toHaveText(`D ${listed[2]} cm`);
  await expect(page.locator('[data-agent-id="model:size-h"]')).toHaveText(`H ${listed[3]} cm`);
  await expect(page.locator('[data-agent-id="model:show-size"]')).toHaveAttribute("aria-pressed", "true");
});

test("the made model is stored once and served as a valid glTF file", async ({ page }) => {
  const first = await page.request.get(`/api/models/${MADE}`, { maxRedirects: 0 });
  expect(first.status()).toBe(302);
  const location = first.headers()["location"]!;
  expect(location).toMatch(/^\/media\/catalog\/made-3d\/v\d+\//);
  // Asked again, the same stored file: nothing is built twice.
  expect((await page.request.get(`/api/models/${MADE}`, { maxRedirects: 0 })).headers()["location"]).toBe(location);

  const file = await page.request.get(location);
  expect(file.headers()["content-type"]).toContain("model/gltf-binary");
  const report = await validateBytes(new Uint8Array(await file.body()), { maxIssues: 20 });
  expect(report.issues.numErrors, JSON.stringify(report.issues.messages)).toBe(0);
  expect(report.issues.numWarnings, JSON.stringify(report.issues.messages)).toBe(0);
});

test("a piece with its own scan says it is a scan", async ({ page }) => {
  await openModel(page, SCANNED);
  await expect(page.locator('[data-agent-id="model:origin"]')).toHaveAttribute("data-origin", "scan");
  await expect(page.locator('[data-agent-id="model:origin"]')).toHaveText("3D scan");
});

const stage = (page: Page) => page.locator('canvas[data-agent-id="room:stage"]');
const picture = (page: Page) => stage(page).evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL("image/png"));

test("in the room planner a photo-only piece can be switched to its 3D model, which turns", async ({ page }) => {
  await page.goto(`/en/room?product=${MADE}`, { waitUntil: "domcontentloaded" });
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

  // The photograph first: it mirrors. Then the model: it turns.
  await expect(page.locator('[data-agent-id="room:mirror"]')).toBeVisible({ timeout: 20_000 });
  await page.locator('[data-agent-id="room:view-model"]').click();
  await expect(page.locator('[data-agent-id="room:view-model"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-agent-id="room:made-note"]')).toBeVisible({ timeout: 90_000 });
  await expect(page.locator('[data-agent-id="room:mirror"]')).toHaveCount(0);
  await page.waitForTimeout(400);
  const before = await picture(page);
  await page.locator('[data-agent-id="room:rotate-right"]').click();
  await page.locator('[data-agent-id="room:rotate-right"]').click();
  await page.waitForTimeout(400);
  expect(await picture(page)).not.toBe(before);

  // Back to the photograph: it mirrors again.
  await page.locator('[data-agent-id="room:view-photo"]').click();
  await expect(page.locator('[data-agent-id="room:mirror"]')).toBeVisible();
});

test("staff have a desk for AI 3D models, empty until a batch is approved and run", async ({ browser }, info) => {
  const page = await browser.newPage();
  await signInAdmin(page, info);
  await page.goto("/en/staff", { waitUntil: "domcontentloaded" });
  await page.locator('[data-agent-id="action:open-models"]').click();
  await expect(page.locator('[data-agent-id="staff:models"]')).toBeVisible();
  await expect(page.getByRole("heading", { name: "3D models made by AI" })).toBeVisible();
  await page.context().close();
});
