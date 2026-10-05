/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * End-to-end tests for the wearables: shoes by size, a size in the cart, Amazon.com reviews shown apart and labelled, staff hiding one.
 */

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { fillAndSubmit, freshPage } from "./support/accounts";
import { signInAdmin } from "./support/orders";

/**
 * docs/adr/061. The local stack seeds the wear specimen: twelve real ABO
 * wearables (shoes, boots, a sandal, bags, a hat, a scarf, jewellery), four of
 * them with the reviews Amazon.com customers wrote of the same product.
 */

const SANDAL = "/en/p/leather-hurrache-closed-sandals-b01n4opiru";

async function noViolations(page: Page) {
  await page.waitForLoadState("load");
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  const summary = results.violations.map((violation) => ({ rule: violation.id, help: violation.help, nodes: violation.nodes.map((node) => node.target.join(" ")) }));
  expect(summary, JSON.stringify(summary, null, 2)).toEqual([]);
}

const tiles = (page: Page) =>
  page.locator('[data-agent-id="listing:results"] a[href*="/p/"]').evaluateAll((nodes) => [...new Set(nodes.map((node) => (node as HTMLAnchorElement).pathname))]);

test("@smoke shoes are browsed and narrowed to a size in stock", async ({ page }) => {
  await page.goto("/en/c/shoes", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Shoes");
  const all = await tiles(page);
  expect(all.length).toBeGreaterThan(1);

  // The size filter comes first, sizes in order; "One size" is never a choice.
  const sizes = page.locator("fieldset").filter({ has: page.locator("legend", { hasText: /^Size$/ }) });
  await expect(sizes.first()).toBeAttached();
  const offered = await sizes.first().locator("a").evaluateAll((links) => links.map((link) => new URL((link as HTMLAnchorElement).href).searchParams.get("size")));
  expect(offered.map(Number)).toEqual([...offered.map(Number)].sort((a, b) => a - b));

  // A filter is a link, so it works the same from the phone's sheet and the desktop column.
  const href = await sizes.first().locator('a[href*="size=38"]').first().getAttribute("href");
  await page.goto(href!, { waitUntil: "domcontentloaded" });
  const in38 = await tiles(page);
  expect(in38.length).toBeGreaterThan(0);
  expect(in38.length).toBeLessThan(all.length);
  expect(in38).toContain(new URL(SANDAL, "http://x").pathname);
  await noViolations(page);
});

test("a shoe is bought in a size, and the cart says which one", async ({ browser }) => {
  const page = await freshPage(browser, { country: "GR" });
  await page.goto(SANDAL, { waitUntil: "domcontentloaded" });
  await expect(page.locator('[data-agent-id^="action:add-to-cart"]')).toContainText("Choose a size first");
  // EU sizes with the foot length each one fits, in centimetres.
  await expect(page.locator('[data-agent-id="product:size-chart"]')).toContainText("Foot length, cm");
  await expect(page.locator('[data-agent-id="product:size-chart"]')).toContainText("23.8");
  // Shoes are tried on too (Try-On Max, docs/adr/063): the Fitting Room opens with this pair first.
  await expect(page.locator('[data-agent-id^="action:try-it-on"]')).toHaveAttribute("href", /\/fitting-room\?piece=leather-hurrache-closed-sandals-b01n4opiru$/);

  await page.locator('[data-agent-id="size:38"]').click();
  await expect(page.locator('[data-agent-id="sizes:state"]')).toContainText("38");
  await page.locator('[data-agent-id^="action:add-to-cart"]').click();
  await expect(page.locator('[data-agent-id="mini-cart"]')).toBeVisible({ timeout: 15_000 });
  const cart = (await (await page.request.get("/api/cart?locale=en")).json()) as { lines: { title: string }[] };
  expect(cart.lines[0]!.title).toMatch(/, 38$/);
  await page.context().close();
});

test("@smoke Amazon.com reviews are shown apart, labelled, and never counted as the shop's", async ({ page }) => {
  await page.goto(SANDAL, { waitUntil: "domcontentloaded" });
  const block = page.locator('[data-agent-id="product:amazon-reviews"]');
  await expect(block.getByRole("heading", { name: "From Amazon.com customers" })).toBeVisible();
  await expect(block).toContainText("not reviews from this shop's buyers");
  await expect(block.locator('[data-agent-id="amazon-reviews:source"]')).toContainText("Amazon Reviews 2023");
  // Written in English and marked so, for screen readers on the Greek pages too.
  await expect(block.locator('[data-agent-id^="amazon-review:"]').first().locator('p[lang="en"]')).toBeVisible();
  // Enough reviewers mention fit for the shop to say which way it runs.
  await expect(block.locator('[data-agent-id="amazon-reviews:fit"]')).toContainText(/Reviewers say it (runs small|fits true to size|runs large)\./);

  // The rating near the price says whose it is and leads to the block.
  const rating = page.locator('[data-agent-id="product:amazon-rating"]');
  await expect(rating).toContainText("on Amazon.com");
  await rating.click();
  await expect(page).toHaveURL(/#amazon-reviews-heading$/);

  // Search engines are told only of the shop's own verified reviews; this piece has none.
  const jsonLd = JSON.parse((await page.locator('script[type="application/ld+json"]').first().textContent())!) as { aggregateRating?: unknown }[];
  expect(jsonLd[0]!.aggregateRating).toBeUndefined();
  await noViolations(page);
});

test("staff hide an Amazon.com review, which leaves the product page, and restore it", async ({ browser }, info) => {
  const shopper = await freshPage(browser);
  await shopper.goto(SANDAL, { waitUntil: "domcontentloaded" });
  const first = shopper.locator('[data-agent-id="product:amazon-reviews"] [data-agent-id^="amazon-review:"]').first();
  const reviewId = (await first.getAttribute("data-agent-id"))!.replace("amazon-review:", "");

  const staff = await freshPage(browser);
  await signInAdmin(staff, info);
  await staff.goto("/en/staff/reviews?view=amazon", { waitUntil: "domcontentloaded" });
  // Found by a word of the product's title, as staff reach any piece's reviews.
  await staff.locator('[data-agent-id="staff:amazon-find"]').fill("Hurrache");
  await staff.locator('[data-agent-id="staff:amazon-find"]').press("Enter");
  await expect(staff).toHaveURL(/product=Hurrache/);
  await expect(staff.locator('[data-agent-id^="staff:amazon-review:"] a[href*="/p/"]').first()).toHaveAttribute("href", /b01n4opiru/);
  await expect(staff.locator(`[data-agent-id="staff:amazon-review:${reviewId}"]`)).toBeVisible();
  await staff.locator(`[data-agent-id="staff:review-hide:${reviewId}"]`).click();
  await fillAndSubmit(staff, { "staff:review-reason": "Describes a different product" }, `staff:review-confirm-hide:${reviewId}`);
  await expect(staff.getByText("Review hidden.", { exact: true })).toBeVisible();

  await shopper.goto(SANDAL, { waitUntil: "domcontentloaded" });
  await expect(shopper.locator('[data-agent-id="product:amazon-reviews"]')).toBeVisible();
  await expect(shopper.locator(`[data-agent-id="amazon-review:${reviewId}"]`)).toHaveCount(0);

  await staff.reload({ waitUntil: "domcontentloaded" });
  await expect(staff.locator(`[data-agent-id="staff:amazon-review:${reviewId}"]`)).toContainText("Hidden: Describes a different product");
  await staff.locator(`[data-agent-id="staff:review-restore:${reviewId}"]`).click();
  await expect(staff.getByText("Review restored.", { exact: true })).toBeVisible();
  await shopper.goto(SANDAL, { waitUntil: "domcontentloaded" });
  await expect(shopper.locator(`[data-agent-id="amazon-review:${reviewId}"]`)).toHaveCount(1);
  await shopper.context().close();
  await staff.context().close();
});
