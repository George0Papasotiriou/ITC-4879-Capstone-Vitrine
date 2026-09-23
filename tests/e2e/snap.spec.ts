/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * End-to-end tests for Snap to shop: a photograph in, the colours the shop read, and what it has like them.
 */

import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { freshPage } from "./support/accounts";

/**
 * docs/adr/024. No key is needed: the photograph is measured on the shop's own
 * server and the colours become an ordinary search. The fixture is a drawn
 * scene — a beige wall, a brown floor, a blue sofa — so the expected answer is
 * known and nobody's home is in the repository.
 */

test.describe.configure({ timeout: 90_000 });

const SCENE = "tests/e2e/fixtures/room-scene.webp";

test("@smoke a photograph becomes colours, and the colours find pieces", async ({ browser }) => {
  const page = await freshPage(browser, { country: "GR" });
  await page.goto("/en/snap", { waitUntil: "domcontentloaded" });

  // Nothing can be given before the shopper agrees to it being read and kept.
  await expect(page.locator('[data-agent-id="snap:file"]')).toBeHidden();
  await expect(page.locator('[data-agent-id="snap:page"]')).toContainText("Kept for 24 hours");

  await page.locator('[data-agent-id="snap:consent"]').check();
  await page.locator('[data-agent-id="snap:file"]').setInputFiles(SCENE);

  // What it saw, in the shop's own colour words, before any result.
  const saw = page.locator('[data-agent-id="snap:saw"]');
  await expect(saw).toBeVisible({ timeout: 30_000 });
  await expect(saw).toContainText("Blue");
  await expect(saw).toContainText("Beige");

  // And the pieces those colours found, on the same page as the reading.
  await expect(page.locator('[data-agent-id="snap:results"]')).toBeVisible();
  expect(await page.locator('[data-agent-id^="concierge-product:"]').count()).toBeGreaterThan(0);

  // "Open these in search" hands the same words to the ordinary search.
  await page.locator('[data-agent-id="snap:refine"]').click();
  await page.waitForURL(/\/en\/search\?q=/);
  await expect(page.locator("main")).toContainText("Blue");

  await page.context().close();
});

test("the photograph can be deleted at once, and the results go with it", async ({ browser }) => {
  const page = await freshPage(browser, { country: "GR" });
  await page.goto("/en/snap", { waitUntil: "domcontentloaded" });
  await page.locator('[data-agent-id="snap:consent"]').check();
  await page.locator('[data-agent-id="snap:file"]').setInputFiles(SCENE);
  await expect(page.locator('[data-agent-id="snap:results"]')).toBeVisible({ timeout: 30_000 });

  await page.locator('[data-agent-id="action:delete-snap"]').click();
  await expect(page.locator('[data-agent-id="snap:photo"]')).toHaveCount(0);
  await expect(page.locator('[data-agent-id="snap:results"]')).toHaveCount(0);
  const photos = (await (await page.request.get("/api/photos")).json()) as { photos: unknown[] };
  expect(photos.photos).toEqual([]);

  await page.context().close();
});

test("a photograph given for one purpose is not read for another", async ({ browser }) => {
  const page = await freshPage(browser);
  await page.goto("/en/fitting-room", { waitUntil: "domcontentloaded" });
  const origin = new URL(page.url()).origin;

  // Uploaded for the Fitting Room...
  await page.locator('[data-agent-id="fitting:consent"]').check();
  await page.locator('[data-agent-id="fitting:file"]').setInputFiles("tests/e2e/fixtures/person.webp");
  await expect(page.locator('[data-agent-id="fitting:photo"]')).toBeVisible({ timeout: 20_000 });
  const photos = (await (await page.request.get("/api/photos")).json()) as { photos: { id: string }[] };

  // ...and search by photo will not touch it.
  const refused = await page.request.post("/api/snap", {
    headers: { origin, "content-type": "application/json" },
    data: { photoId: photos.photos[0]!.id },
  });
  expect(refused.status()).toBe(404);
  expect((await refused.json()).reason).toBe("not_found");

  await page.context().close();
});

test("Snap to shop passes the accessibility checks in both languages", async ({ browser }) => {
  const page = await freshPage(browser, { country: "GR" });
  for (const path of ["/en/snap", "/el/snap"]) {
    await page.goto(path, { waitUntil: "domcontentloaded" });
    await page.locator("main").waitFor();
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    expect(results.violations, `${path}: ${results.violations.map((violation) => violation.id).join(", ")}`).toEqual([]);
  }
  await page.context().close();
});
