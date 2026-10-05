/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * End-to-end tests for the real clothes: Clothing by who it is for and by size, a garment's label and reviews, search, and the home shelf.
 */

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { freshPage } from "./support/accounts";

/**
 * docs/adr/062. The local stack seeds the clothes specimen: twelve garments
 * from Amazon Reviews 2023's listings with their photographs in public/, and
 * no drawn capsule.
 */

const COAT = "/en/p/ridge-coat-b009ydcj12";
const JACKET = "b005focnkq";

async function noViolations(page: Page) {
  await page.waitForLoadState("load");
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  const summary = results.violations.map((violation) => ({ rule: violation.id, help: violation.help, nodes: violation.nodes.map((node) => node.target.join(" ")) }));
  expect(summary, JSON.stringify(summary, null, 2)).toEqual([]);
}

const tiles = (page: Page) =>
  page.locator('[data-agent-id="listing:results"] a[href*="/p/"]').evaluateAll((nodes) => [...new Set(nodes.map((node) => (node as HTMLAnchorElement).pathname))]);

test("@smoke Clothing is real garments, narrowed by who they are for and by size", async ({ page }) => {
  await page.goto("/en/c/wear", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Clothing");
  const all = await tiles(page);
  expect(all.length).toBeGreaterThanOrEqual(12);
  // The drawn capsule is gone from the shop.
  expect(all.some((path) => /poplin-shirt-ecru|heavy-cotton-tee/.test(path))).toBe(false);

  // "For" comes first: a filter is a link, so it works the same from the phone's sheet and the desktop column.
  const forGroup = page.locator("fieldset").filter({ has: page.locator("legend", { hasText: /^For$/ }) }).first();
  await expect(forGroup.locator("a")).toHaveText([/Women/, /Men/]);
  await page.goto((await forGroup.locator('a[href*="for=men"]').getAttribute("href"))!, { waitUntil: "domcontentloaded" });
  const men = await tiles(page);
  expect(men.length).toBeGreaterThan(0);
  expect(men.length).toBeLessThan(all.length);
  expect(men).toContain(new URL(COAT, "http://x").pathname);

  const sizes = page.locator("fieldset").filter({ has: page.locator("legend", { hasText: /^Size$/ }) }).first();
  const offered = await sizes.locator("a").evaluateAll((links) => links.map((link) => new URL((link as HTMLAnchorElement).href).searchParams.get("size")));
  expect(offered).toEqual(["XS", "S", "M", "L", "XL"].filter((size) => offered.includes(size)));
  await noViolations(page);
});

test("a garment shows its label, its size chart and what reviewers say of its fit, and is bought in a size", async ({ browser }) => {
  const page = await freshPage(browser, { country: "GR" });
  await page.goto(COAT, { waitUntil: "domcontentloaded" });
  await expect(page.locator("main")).toContainText("For");
  await expect(page.locator("main")).toContainText("100% cotton");
  await expect(page.locator('[data-agent-id="product:size-chart"]')).toContainText("Chest");
  // Most of the coat's reviewers who mention fit say it runs large.
  const block = page.locator('[data-agent-id="product:amazon-reviews"]');
  await expect(block.getByRole("heading", { name: "From Amazon.com customers" })).toBeVisible();
  await expect(block.locator('[data-agent-id="amazon-reviews:fit"]')).toContainText("Reviewers say it runs large.");
  await expect(block.locator('[data-agent-id="amazon-reviews:source"]')).toContainText("Amazon Reviews 2023");

  await page.locator('[data-agent-id="size:M"]').click();
  await page.locator('[data-agent-id^="action:add-to-cart"]').click();
  await expect(page.locator('[data-agent-id="mini-cart"]')).toBeVisible({ timeout: 15_000 });
  const cart = (await (await page.request.get("/api/cart?locale=en")).json()) as { lines: { title: string }[] };
  expect(cart.lines[0]!.title).toBe("Ridge Coat, M");
  await noViolations(page);
  await page.context().close();
});

test("a search for a jacket finds real jackets", async ({ page }) => {
  await page.goto("/en/search?q=jacket", { waitUntil: "domcontentloaded" });
  const results = page.locator('article[data-agent-id^="product:"]');
  await expect(results).not.toHaveCount(0);
  await expect(page.locator(`main a[href*="${JACKET}"]`).first()).toBeVisible();
});

test("the home page shows the clothes, shoes and bags, with a way into each", async ({ page }) => {
  await page.goto("/en", { waitUntil: "domcontentloaded" });
  const shelf = page.locator('[data-agent-id="home:wear"]');
  await expect(shelf.getByRole("heading", { name: "Clothes, shoes and bags" })).toBeVisible();
  await expect(shelf.getByRole("link", { name: "Clothing", exact: true })).toHaveAttribute("href", "/en/c/wear");
  await expect(shelf.getByRole("link", { name: "Shoes", exact: true })).toHaveAttribute("href", "/en/c/shoes");
  await expect(shelf.locator('a[href*="/p/"]')).not.toHaveCount(0);
});
