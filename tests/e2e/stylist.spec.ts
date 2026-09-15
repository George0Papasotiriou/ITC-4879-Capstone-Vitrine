/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * End-to-end Budget Stylist page and API tests.
 */

import { expect, test } from "@playwright/test";

/**
 * The Budget Stylist page and API (A3) on the specimen catalogue.
 */

test("@smoke the form builds three sets within the budget", async ({ page }) => {
  await page.goto("/en/stylist", { waitUntil: "domcontentloaded" });
  await page.getByLabel("What are you furnishing?").selectOption("reading-corner");
  await page.getByLabel("Budget in euros").fill("1500");
  await page.getByRole("button", { name: "Put it together" }).click();

  await expect(page).toHaveURL(/\/en\/stylist\?template=reading-corner&budget=1500/);
  const sets = page.locator('[data-agent-id^="bundle:"]');
  await expect(sets).toHaveCount(3);

  for (const set of await sets.all()) {
    const total = Number((await set.locator("p.tabular").first().innerText()).replace(/[^0-9]/g, ""));
    expect(total).toBeLessThanOrEqual(1500);
    await expect(set.getByText(/left of your budget/)).toBeVisible();
    await expect(set.getByRole("heading", { name: "Why these go together" })).toBeVisible();
  }
});

test("other options for a piece open in place and stay within budget", async ({ page }) => {
  await page.goto("/en/stylist?template=reading-corner&budget=1500", { waitUntil: "domcontentloaded" });
  const firstSet = page.locator('[data-agent-id="bundle:0"]');
  await firstSet.getByRole("link", { name: "Other options" }).nth(1).click();
  await expect(page).toHaveURL(/swap=0%3Alamp|swap=0:lamp/);
  await expect(firstSet.getByText("Other options for the lamp")).toBeVisible();
  const setTotals = await firstSet.getByText(/for the set$/).allInnerTexts();
  expect(setTotals.length).toBeGreaterThan(0);
  for (const text of setTotals) expect(Number(text.replace(/[^0-9]/g, ""))).toBeLessThanOrEqual(1500);
});

test("a template the catalogue cannot fill says which piece is missing", async ({ page }) => {
  await page.goto("/en/stylist?template=bedroom&budget=2000", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("No set fits these limits")).toBeVisible();
  await expect(page.getByText("Nothing in the collection can fill the bed")).toBeVisible();
});

test("the Greek page is in Greek and avoids a chosen colour", async ({ page }) => {
  await page.goto("/el/stylist?template=living-room&budget=3000&avoid=grey", { waitUntil: "domcontentloaded" });
  await expect(page.locator("html")).toHaveAttribute("lang", "el");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Στυλίστας προϋπολογισμού");
  await expect(page.getByRole("checkbox", { name: "Γκρι" })).toBeChecked();
});

test("the API returns typed bundles and rejects bad requests", async ({ request }) => {
  const response = await request.post("/api/stylist", { data: { template: "dining", budgetCents: 400_000 } });
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.bundles.length).toBeGreaterThan(0);
  for (const bundle of body.bundles) {
    expect(bundle.totalCents).toBeLessThanOrEqual(400_000);
    const chairs = bundle.picks.find((pick: { slotId: string }) => pick.slotId === "chairs");
    expect(chairs.quantity).toBe(4);
    expect(chairs.lineTotalCents).toBe(chairs.unitPriceCents * 4);
  }

  expect((await request.post("/api/stylist", { data: { template: "outfit", budgetCents: 1 } })).status()).toBe(400);
  expect((await request.post("/api/stylist", { data: "not json", headers: { "content-type": "application/json" } })).status()).toBe(400);
});
