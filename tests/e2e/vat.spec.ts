/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * End-to-end prices and VAT by country tests.
 */

import { expect, test, type Page } from "@playwright/test";

import { E2E_COUNTRY_HEADER } from "../../playwright.config";

/**
 * Prices and VAT by country (docs/adr/013). The test server trusts a header in
 * place of a CDN's country header, so these tests can arrive "from" Germany.
 *
 * The faux-wood lamp costs €94.00 in Greece: €75.81 before VAT, so €90.21 with
 * Germany's 19% and €94.76 with Sweden's 25%.
 */

const LAMP = "/en/p/faux-wood-table-lamp-b07mbfd87n";

async function addLampToCart(page: Page) {
  await page.goto(LAMP, { waitUntil: "domcontentloaded" });
  const sheet = page.getByRole("dialog", { name: "Added to your cart" });
  await expect(async () => {
    if (!(await sheet.isVisible())) await page.locator('[data-agent-id^="action:add-to-cart:"]').click({ timeout: 2_000 });
    await expect(sheet).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 25_000 });
}

test.describe("a visitor from Germany", () => {
  test.use({ extraHTTPHeaders: { [E2E_COUNTRY_HEADER]: "DE" } });

  test("@smoke sees German prices with 19% VAT on product pages and listings", async ({ page }) => {
    await page.goto(LAMP, { waitUntil: "domcontentloaded" });
    const detail = page.locator('[data-agent-id^="product-detail:"]');
    await expect(detail.getByText("€90.21")).toBeVisible();
    await expect(detail.locator('[data-agent-id="region:note"]')).toContainText("Prices for Germany include 19% VAT.");

    await page.goto("/en/c/lighting", { waitUntil: "domcontentloaded" });
    await expect(page.locator('[data-agent-id^="product:"]').filter({ hasText: "Faux Wood Table Lamp" })).toContainText("€90.21");
  });

  test("finds products by a budget in German prices", async ({ page }) => {
    // €90.21 is under €91 in Germany, although the Greek price, €94.00, is not.
    await page.goto("/en/search?q=lamp%20under%2091", { waitUntil: "domcontentloaded" });
    await expect(page.locator('[data-agent-id^="product:"]').filter({ hasText: "Faux Wood Table Lamp" })).toHaveCount(1);
  });

  test("checks out to Germany with German VAT, and sees the price change for a Greek address", async ({ page }) => {
    await addLampToCart(page);
    await page.goto("/en/cart", { waitUntil: "domcontentloaded" });
    await expect(page.locator('[data-agent-id="cart:totals"]')).toContainText("€90.21");
    await expect(page.locator('[data-agent-id="cart:vat"]')).toContainText("19% for Germany");

    await page.goto("/en/checkout", { waitUntil: "domcontentloaded" });
    // The country list is a controlled field: wait until the form is hydrated (its button enables).
    await expect(page.locator('[data-agent-id="action:place-order"]')).toBeEnabled();
    const country = page.locator('[data-agent-id="checkout:country"]');
    await expect(country).toHaveValue("DE");
    const totals = page.locator('[data-agent-id="checkout:totals"]');
    await expect(totals).toContainText("€90.21");
    await expect(page.locator('[data-agent-id="checkout:vat"]')).toContainText("19% for Germany");

    // Delivering to Greece instead: Greek price and VAT, and the page says why the prices moved.
    await expect(async () => {
      await country.selectOption("GR");
      await expect(totals).toContainText("€94.00", { timeout: 1_500 });
    }).toPass();
    await expect(page.getByText("Prices updated for delivery to Greece, including 24% VAT.")).toBeVisible();

    await country.selectOption("DE");
    await page.getByLabel("Email").fill("jonas@example.com");
    await page.getByLabel("Full name").fill("Jonas Weber");
    await page.getByLabel("Street and number").fill("Unter den Linden 1");
    await page.getByLabel("City").fill("Berlin");
    await page.getByLabel("Postcode").fill("10117");
    await page.locator('[data-agent-id="action:place-order"]').click();
    await expect(page).toHaveURL(/\/en\/orders\/[0-9a-f-]{36}\?t=/, { timeout: 15_000 });
    await expect(page.locator('[data-agent-id="order:vat"]')).toContainText("19% for Germany");
    await expect(page.locator('[data-agent-id="order:totals"]')).toContainText("€90.21");
    await expect(page.locator("address")).toContainText("10117 Berlin, DE");
  });

  test("is told the shop cannot deliver to the Canary Islands yet", async ({ page }) => {
    await addLampToCart(page);
    await page.goto("/en/checkout", { waitUntil: "domcontentloaded" });
    // The country list is a controlled field: wait until the form is hydrated (its button enables).
    await expect(page.locator('[data-agent-id="action:place-order"]')).toBeEnabled();
    await page.locator('[data-agent-id="checkout:country"]').selectOption("ES");
    await page.getByLabel("Email").fill("ana@example.com");
    await page.getByLabel("Full name").fill("Ana García");
    await page.getByLabel("Street and number").fill("Calle Mayor 1");
    await page.getByLabel("City").fill("Las Palmas");
    await page.getByLabel("Postcode").fill("35001");
    await page.locator('[data-agent-id="action:place-order"]').click();
    await expect(page.getByRole("alert").filter({ hasText: "We cannot deliver to the Canary Islands yet" })).toContainText("outside the EU VAT area");
  });
});

test("a shopper can choose another country, and the choice is remembered", async ({ page }) => {
  await page.goto(LAMP, { waitUntil: "domcontentloaded" });
  const detail = page.locator('[data-agent-id^="product-detail:"]');
  await expect(detail.getByText("€94.00")).toBeVisible();

  const dialog = page.getByRole("dialog", { name: "Where are you shopping from?" });
  await expect(async () => {
    await detail.getByRole("button", { name: "Change country" }).click();
    await expect(dialog).toBeVisible({ timeout: 1_500 });
  }).toPass();
  await dialog.getByLabel("Country").selectOption("SE");
  await expect(dialog.getByText("Prices will include 25% VAT for Sweden.")).toBeVisible();
  await dialog.getByRole("button", { name: "Show these prices" }).click();

  // The page refreshes from the server with the new country's prices.
  await expect(detail.getByText("€94.76")).toBeVisible({ timeout: 15_000 });
  await expect(detail.locator('[data-agent-id="region:note"]')).toContainText("Sweden include 25% VAT");
  await page.reload();
  await expect(detail.getByText("€94.76")).toBeVisible();
  await expect(page.locator("footer")).toContainText("Prices for Sweden, including 25% VAT");
});

test("a visitor from a country the shop exports to sees prices without VAT, and is told how import tax works", async ({ browser }) => {
  const context = await browser.newContext({ extraHTTPHeaders: { [E2E_COUNTRY_HEADER]: "US" } });
  const page = await context.newPage();
  await page.goto(LAMP, { waitUntil: "domcontentloaded" });
  const detail = page.locator('[data-agent-id^="product-detail:"]');
  // €94.00 / 1.24 = €75.81.
  await expect(detail.getByText("€75.81")).toBeVisible();
  await expect(detail.locator('[data-agent-id="region:note"]')).toContainText("We deliver there: import tax is added at checkout or paid on delivery.");
  await context.close();
});

test("a visitor from a country the shop does not deliver to is told so", async ({ browser }) => {
  const context = await browser.newContext({ extraHTTPHeaders: { [E2E_COUNTRY_HEADER]: "BR" } });
  const page = await context.newPage();
  await page.goto(LAMP, { waitUntil: "domcontentloaded" });
  const detail = page.locator('[data-agent-id^="product-detail:"]');
  await expect(detail.getByText("€75.81")).toBeVisible();
  await expect(detail.locator('[data-agent-id="region:note"]')).toContainText("We do not deliver there yet.");
  await context.close();
});

test.describe("delivery beyond the EU (docs/adr/015)", () => {
  test.use({ extraHTTPHeaders: { [E2E_COUNTRY_HEADER]: "CH" } });

  test("checks out to Switzerland without VAT, and to the United States with a state", async ({ page }) => {
    await addLampToCart(page);
    await page.goto("/en/checkout", { waitUntil: "domcontentloaded" });
    await expect(page.locator('[data-agent-id="action:place-order"]')).toBeEnabled();
    const country = page.locator('[data-agent-id="checkout:country"]');
    await expect(country).toHaveValue("CH");
    // €75.81 without VAT, plus €39.90 export delivery to the rest of Europe.
    await expect(page.locator('[data-agent-id="checkout:totals"]')).toContainText("€115.71");
    await expect(page.locator('[data-agent-id="checkout:vat"]')).toContainText("No VAT charged: an export to Switzerland. Import VAT at 8.1% and any duties are paid on delivery.");

    // The United States needs a state, which appears with the country.
    await expect(async () => {
      await country.selectOption("US");
      await expect(page.locator('[data-agent-id="checkout:region"]')).toBeVisible({ timeout: 1_500 });
    }).toPass();
    await page.getByLabel("Email").fill("sam@example.com");
    await page.getByLabel("Full name").fill("Sam Taylor");
    await page.getByLabel("Street and number").fill("1 Main Street");
    await page.getByLabel("City").fill("Springfield");
    await page.getByLabel("Postcode").fill("62701");
    await page.locator('[data-agent-id="action:place-order"]').click();
    await expect(page.getByText("Choose the state or province of this address.")).toBeVisible();

    await page.locator('[data-agent-id="checkout:region"]').selectOption("IL");
    await page.locator('[data-agent-id="action:place-order"]').click();
    await expect(page).toHaveURL(/\/en\/orders\/[0-9a-f-]{36}\?t=/, { timeout: 15_000 });
    await expect(page.locator("address")).toContainText("Springfield, IL 62701, US");
    await expect(page.locator('[data-agent-id="order:vat"]')).toContainText("No VAT charged: an export to the United States.");
  });
});

test("the Greek storefront writes rates the Greek way", async ({ browser }) => {
  const context = await browser.newContext({ extraHTTPHeaders: { [E2E_COUNTRY_HEADER]: "FI" } });
  const page = await context.newPage();
  await page.goto("/el/p/faux-wood-table-lamp-b07mbfd87n", { waitUntil: "domcontentloaded" });
  await expect(page.locator('[data-agent-id="region:note"]')).toContainText("ΦΠΑ 25,5%");
  await context.close();
});
