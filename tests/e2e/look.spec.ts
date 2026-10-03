/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * End-to-end tests for "Shop the look": on the Snap page and in the Concierge, honest about what it can see without a model.
 */

import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { freshPage } from "./support/accounts";

/**
 * docs/adr/054. The test shop has no AI key, so the model that finds the
 * pieces is not there: the shop must say it read the whole photograph's
 * colours, show what it found that way, and never draw pins it did not
 * find. (With a key, the pins come from the model's boxes; the pure parts
 * — boxes, overlap, cleaned words — are unit-tested in src/lib/look.)
 */

test.describe.configure({ timeout: 90_000 });

const SCENE = "tests/e2e/fixtures/room-scene.webp";

test("@smoke on the Snap page, Shop the look says what it could see and shows the matches", async ({ browser }) => {
  const page = await freshPage(browser, { country: "GR" });
  await page.goto("/en/snap", { waitUntil: "domcontentloaded" });
  await page.locator('[data-agent-id="snap:consent"]').check();
  await page.locator('[data-agent-id="snap:file"]').setInputFiles(SCENE);
  await expect(page.locator('[data-agent-id="snap:photo"]')).toBeVisible({ timeout: 30_000 });

  const section = page.locator('[data-agent-id="look:section"]');
  await section.scrollIntoViewIfNeeded();
  await section.locator('[data-agent-id="look:go"]').click();
  await expect(section.locator('[data-agent-id="look:drawn"]')).toContainText("whole photo's colours", { timeout: 30_000 });
  await expect(section.locator('[data-agent-id^="concierge-product:"]').first()).toBeVisible();
  // No pins it did not find, and no "add the look" for a look it could not take apart.
  await expect(section.locator('[data-agent-id^="look:pin:"]')).toHaveCount(0);
  await expect(section.locator('[data-agent-id="look:add-all"]')).toHaveCount(0);

  const results = await new AxeBuilder({ page }).include('[data-agent-id="look:section"]').analyze();
  expect(results.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`)).toEqual([]);
  await page.context().close();
});

test("the API finds a photograph only for the browser that gave it", async ({ browser }) => {
  const owner = await freshPage(browser, { country: "GR" });
  await owner.goto("/en/snap", { waitUntil: "domcontentloaded" });
  await owner.locator('[data-agent-id="snap:consent"]').check();
  await owner.locator('[data-agent-id="snap:file"]').setInputFiles(SCENE);
  await expect(owner.locator('[data-agent-id="snap:photo"]')).toBeVisible({ timeout: 30_000 });
  const photos = (await (await owner.request.get("/api/photos")).json()) as { photos: { id: string }[] };
  const photoId = photos.photos[0]!.id;
  expect((await owner.request.post("/api/look", { data: { photoId, locale: "en" } })).status()).toBe(200);

  const stranger = await freshPage(browser, { country: "GR" });
  await stranger.goto("/en", { waitUntil: "domcontentloaded" });
  expect((await stranger.request.post("/api/look", { data: { photoId, locale: "en" } })).status()).toBe(404);
  await stranger.context().close();
  await owner.context().close();
});

test("asked in the Concierge with a photo attached, it answers from the photo", async ({ browser }) => {
  const page = await freshPage(browser, { country: "GR" });
  await page.goto("/en", { waitUntil: "domcontentloaded" });
  await page.locator("html[data-concierge-ready]").waitFor({ timeout: 30_000 });
  await page.locator('[data-agent-id="nav:concierge-panel"]:visible, [data-agent-id="nav:concierge"]:visible').first().click();
  const composer = page.locator('[data-agent-id="concierge:composer"]');
  await expect(composer).toBeVisible({ timeout: 15_000 });
  await composer.locator('[data-agent-id="photo:input"]').setInputFiles(SCENE);
  await composer.locator('[data-agent-id="photo:consent"]').check();
  await composer.locator("textarea").fill("Shop this look");
  await page.locator('[data-agent-id="concierge:send"]').click();
  const card = page.locator('[data-agent-id="concierge:look"]');
  await expect(card).toContainText("whole photo's colours", { timeout: 30_000 });
  await expect(card.locator('[data-agent-id^="concierge-product:"]').first()).toBeVisible();
  await page.context().close();
});
