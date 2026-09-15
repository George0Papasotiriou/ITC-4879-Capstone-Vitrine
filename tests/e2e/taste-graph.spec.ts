/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * End-to-end Taste Graph consent, tracking and recommendation tests.
 */

import { expect, test } from "@playwright/test";

/**
 * The Taste Graph (A2) through the browser: opt-in, consented tracking,
 * explained recommendations, forgetting, "pairs well with" and This-or-That.
 *
 * The test server starts from an empty behaviour table, so recommendations come
 * from content neighbour lists built on start — the cold-start path.
 */

const SOFA = "/en/p/westview-extra-deep-down-filled-leather-sofa-couch-b082vlyqwx";

test("nothing is recorded before personal recommendations are turned on", async ({ page }) => {
  const recorded: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/interactions")) recorded.push(request.url());
  });
  await page.goto(SOFA, { waitUntil: "load" });
  await page.waitForTimeout(500);
  expect(recorded).toEqual([]);
  await page.goto("/en", { waitUntil: "domcontentloaded" });
  await expect(page.getByText(/Turn on personal recommendations to see picks/)).toBeVisible();
});

test("@smoke opting in, viewing a product, and getting explained recommendations; forgetting undoes it", async ({ page }) => {
  await page.goto("/en/account", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Personal recommendations are off.")).toBeVisible();
  await expect(async () => {
    await page.getByRole("button", { name: "Turn on" }).click();
    await expect(page.getByText("Personal recommendations are on.")).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 15_000 });

  const recorded = page.waitForResponse((response) => response.url().includes("/api/interactions") && response.status() === 201);
  await page.goto(SOFA, { waitUntil: "domcontentloaded" });
  await recorded;

  await page.goto("/en", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Picked from what you have looked at. Nothing is sponsored.")).toBeVisible();
  await expect(page.getByText("Because you viewed Westview Extra-Deep Down-Filled Leather Sofa Couch").first()).toBeVisible();

  await page.goto("/en/account", { waitUntil: "domcontentloaded" });
  await expect(async () => {
    await page.getByRole("button", { name: "Forget my history" }).click();
    await expect(page.getByText("Personal recommendations are off.")).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 15_000 });
  await page.goto("/en", { waitUntil: "domcontentloaded" });
  await expect(page.getByText(/Because you viewed/)).toHaveCount(0);
});

test("the interactions API refuses malformed events and ignores events without consent", async ({ request }) => {
  const withoutConsent = await request.post("/api/interactions", {
    data: { productId: "01a0982c-866b-7e91-93c4-4c249740bb97", kind: "view", sessionId: "e2e-session-0001" },
  });
  expect(withoutConsent.status()).toBe(204);

  await request.post("/api/personalization", { data: { action: "enable" } });
  const spoofedPurchase = await request.post("/api/interactions", {
    data: { productId: "01a0982c-866b-7e91-93c4-4c249740bb97", kind: "purchase", sessionId: "e2e-session-0001" },
  });
  expect(spoofedPurchase.status()).toBe(400);
  await request.post("/api/personalization", { data: { action: "forget" } });
});

test("a product page shows what goes with it", async ({ page }) => {
  await page.goto(SOFA, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { level: 2, name: /Pairs well with|More like this/ })).toBeVisible();
});

test("This-or-That learns from eight choices and shows a shelf", async ({ page }) => {
  await page.goto("/en/taste", { waitUntil: "domcontentloaded" });
  for (let round = 1; round <= 8; round += 1) {
    await expect(page.getByText(`Choice ${round} of 8`)).toBeVisible();
    await page.locator('[data-agent-id^="choice:"]').first().click();
  }
  await expect(page.getByRole("heading", { level: 1, name: "Your taste" })).toBeVisible();
  await expect(page.locator('article[data-agent-id^="product:"]')).not.toHaveCount(0);
});
