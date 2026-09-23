/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * End-to-end catalogue and search flows.
 */

import { expect, test } from "@playwright/test";

/**
 * Catalogue and search flows against the database (docs/PLAN.md Phases 3–4).
 *
 * The test server seeds the specimen fixture: 25 products, 12 of them lighting,
 * two sold out. Every assertion here goes through the rendered page or the
 * public API — what a shopper or the Concierge would actually get.
 */

const SOFA = "/en/p/westview-extra-deep-down-filled-leather-sofa-couch-b082vlyqwx";
const SOLD_OUT = "/en/p/classic-plank-top-console-table-with-large-drawer-b07mm5h3hx";

const resultCount = (page: import("@playwright/test").Page) => page.getByText(/^\d+ products?$/).first();

test("@smoke a category lists its products with a count", async ({ page }) => {
  await page.goto("/en/c/lighting", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { level: 1, name: "Lighting" })).toBeVisible();
  await expect(resultCount(page)).toHaveText("12 products");
  await expect(page.locator('article[data-agent-id^="product:"]')).toHaveCount(12);
});

test("a facet link filters the listing, keeps the state in the URL, and can be removed", async ({ page, isMobile }) => {
  await page.goto("/en/c/lighting", { waitUntil: "domcontentloaded" });

  const filters = page.locator("aside details.listing-filters");
  if (isMobile) await page.locator("aside summary").click();

  await filters.getByRole("link", { name: /^Glass/ }).first().click();
  await expect(page).toHaveURL(/\/en\/c\/lighting\?material=glass$/);
  const count = Number((await resultCount(page).innerText()).split(" ")[0]);
  expect(count).toBeGreaterThan(0);
  expect(count).toBeLessThan(12);

  await page.getByRole("link", { name: "Remove filter: Glass" }).click();
  await expect(page).toHaveURL(/\/en\/c\/lighting$/);
  await expect(resultCount(page)).toHaveText("12 products");
});

test("sorting by price reorders the grid", async ({ page }) => {
  await page.goto("/en/c/seating?sort=price-asc", { waitUntil: "domcontentloaded" });
  const prices = await page.locator('article[data-agent-id^="product:"] .tabular span').allInnerTexts();
  const values = prices.filter((text) => text.includes("€")).map((text) => Number(text.replace(/[^0-9.]/g, "")));
  expect(values.length).toBeGreaterThan(2);
  expect(values).toEqual([...values].sort((a, b) => a - b));
  await expect(page.getByRole("combobox", { name: "Sort by" })).toHaveValue("price-asc");
});

test("choosing a sort order navigates to the sorted URL", async ({ page }) => {
  await page.goto("/en/c/seating", { waitUntil: "domcontentloaded" });
  const sort = page.getByRole("combobox", { name: "Sort by" });
  // Retry until hydrated: a change before hydration has no handler to navigate.
  // Alternate the option so every attempt fires a change event.
  let attempt = 0;
  await expect(async () => {
    attempt += 1;
    if (attempt > 1) await sort.selectOption("featured");
    await sort.selectOption("price-desc");
    await expect(page).toHaveURL(/sort=price-desc/, { timeout: 1_500 });
  }).toPass();
});

test("the whole collection paginates", async ({ page }) => {
  await page.goto("/en/c", { waitUntil: "domcontentloaded" });

  // Counted from what the shop holds rather than written down here: the
  // catalogue grows (the Wear capsule of docs/adr/022 added two dozen pieces),
  // and a number in a test would only record when it was last edited.
  const tiles = page.locator('article[data-agent-id^="product:"]');
  const total = Number(/^(\d+) products?$/.exec((await resultCount(page).textContent()) ?? "")?.[1]);
  const perPage = await tiles.count();
  const pages = Math.ceil(total / perPage);
  expect(total).toBeGreaterThan(perPage);

  await expect(page.getByText(`Page 1 of ${pages}`)).toBeVisible();
  await page.getByRole("link", { name: "Next page" }).click();
  await expect(page.getByText(`Page 2 of ${pages}`)).toBeVisible();
  expect(new URL(page.url()).search).toBe("?page=2");
  await expect(tiles).toHaveCount(Math.min(perPage, total - perPage));
});

test("a filter with no matches explains itself and offers a way back", async ({ page }) => {
  await page.goto("/en/c/lighting?material=velvet", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Nothing matches these filters")).toBeVisible();
  await page.getByRole("link", { name: "Clear all filters" }).last().click();
  await expect(page).toHaveURL(/\/en\/c\/lighting$/);
});

test("@smoke a product page shows price, stock, dimensions and structured data from the database", async ({ page }) => {
  await page.goto(SOFA, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Westview Extra-Deep Down-Filled Leather Sofa Couch");
  await expect(page.getByText("€1,259.00").first()).toBeVisible();
  await expect(page.getByText("Only 4 left")).toBeVisible();
  await expect(page.getByText("226 × 107 × 80 cm")).toBeVisible();

  const jsonLd = JSON.parse((await page.locator('script[type="application/ld+json"]').textContent()) ?? "[]");
  expect(jsonLd[0]).toMatchObject({
    "@type": "Product",
    name: "Westview Extra-Deep Down-Filled Leather Sofa Couch",
    offers: { price: "1259.00", priceCurrency: "EUR", availability: "https://schema.org/InStock" },
  });
  expect(jsonLd[1]["@type"]).toBe("BreadcrumbList");
});

test("the gallery swaps the photograph when a thumbnail is chosen", async ({ page }) => {
  await page.goto(SOFA, { waitUntil: "domcontentloaded" });
  const second = page.getByRole("button", { name: "Show photograph 2 of 2" });
  await expect(page.getByRole("button", { name: "Show photograph 1 of 2" })).toHaveAttribute("aria-pressed", "true");
  // The thumbnails are server-rendered; a click that lands before hydration does
  // nothing, so retry the click until the gallery responds (it failed once on a
  // slow mobile run without this).
  await expect(async () => {
    await second.click();
    await expect(second).toHaveAttribute("aria-pressed", "true", { timeout: 1000 });
  }).toPass({ timeout: 10_000 });
  await expect(page.locator("main img").first()).toHaveAttribute("src", /b082vlyqwx-b\.webp/);
});

test("a sold-out product says so and cannot be added to the cart", async ({ page }) => {
  await page.goto(SOLD_OUT, { waitUntil: "domcontentloaded" });
  const button = page.locator('[data-agent-id^="action:add-to-cart:"]');
  await expect(button).toHaveAttribute("aria-disabled", "true");
  await expect(button).toHaveText("Out of stock");
});

test("a Greek product page keeps Greek chrome and marks English copy as English", async ({ page }) => {
  await page.goto("/el/p/radford-modern-curved-arm-accent-chair-b07f2x8k62", { waitUntil: "domcontentloaded" });
  await expect(page.locator("h1")).toHaveAttribute("lang", "en");
  await expect(page.getByText("Η περιγραφή αυτού του προϊόντος εμφανίζεται στα αγγλικά")).toBeVisible();
  await expect(page.getByRole("link", { name: "Καθίσματα" }).first()).toHaveAttribute("href", "/el/c/seating");
});

test("@smoke searching from the form shows results and what was understood", async ({ page }) => {
  await page.goto("/en/search", { waitUntil: "domcontentloaded" });
  await page.getByRole("searchbox", { name: "Search the collection" }).fill("leather sofa under 1300");
  await page.getByRole("button", { name: "Search", exact: true }).click();

  await expect(page).toHaveURL(/\/en\/search\?q=leather\+sofa\+under\+1300/);
  await expect(page.getByText(/Understood as: .*Leather.*Under €1,300/)).toBeVisible();
  await expect(page.locator('article[data-agent-id^="product:"]').first()).toContainText("Westview");
});

test("Greeklish and misspellings are read, and the page says how", async ({ page }) => {
  await page.goto("/el/search?q=kanapes", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Το «kanapes» διαβάστηκε ως «καναπεσ»")).toBeVisible();
  await expect(page.locator('article[data-agent-id^="product:"]')).not.toHaveCount(0);

  await page.goto("/en/search?q=chiar", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Also searched for “chair”")).toBeVisible();
});

test("a search with no results offers a way forward", async ({ page }) => {
  await page.goto("/en/search?q=xylophone", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Nothing matches “xylophone”")).toBeVisible();
  await expect(page.getByRole("link", { name: "Browse the whole collection" })).toHaveAttribute("href", "/en/c");
});

test("the search API returns compact, typed results and rejects bad input", async ({ request }) => {
  const response = await request.get("/api/search?q=fotistiko&locale=el&limit=5");
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.understood.readings[0]).toMatchObject({ term: "fotistiko", greek: expect.arrayContaining(["φωτιστικο"]) });
  expect(body.results.length).toBeGreaterThan(0);
  expect(body.results.length).toBeLessThanOrEqual(5);
  expect(body.results[0]).toEqual({
    id: expect.any(String),
    slug: expect.any(String),
    title: expect.any(String),
    brand: expect.anything(),
    category: "lighting",
    priceCents: expect.any(Number),
    currency: "EUR",
    inStock: expect.any(Boolean),
    image: expect.stringMatching(/^\//),
  });

  expect((await request.get("/api/search")).status()).toBe(400);
  expect((await request.get(`/api/search?q=${"x".repeat(201)}`)).status()).toBe(400);
});

test("the sitemap lists products in both languages and robots points at it", async ({ request }) => {
  const sitemap = await (await request.get("/sitemap.xml")).text();
  expect(sitemap).toContain("/en/p/westview-extra-deep-down-filled-leather-sofa-couch-b082vlyqwx");
  expect(sitemap).toContain('hreflang="el"');
  const robots = await (await request.get("/robots.txt")).text();
  expect(robots).toMatch(/Sitemap: http.*\/sitemap\.xml/);
  expect(robots).toContain("Disallow: /api/");
});

test("catalogue media is served only from the public prefix", async ({ request }) => {
  expect((await request.get("/media/uploads/private.webp")).status()).toBe(404);
  expect((await request.get("/media/catalog/abo/missing/0000000000000000.webp")).status()).toBe(404);
});
