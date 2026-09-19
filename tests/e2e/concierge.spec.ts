/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * End-to-end tests for the Concierge in demo mode: cart changes with undo, approval before checkout, Greek, accessibility.
 */

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { freshPage } from "./support/accounts";

/**
 * The test server runs without an AI key, so the Concierge answers from the
 * demo rules (docs/adr/019): the tools, the cart, approvals and the page's
 * commands are all real; only the choice of the next step is scripted.
 */

async function openConcierge(page: Page) {
  // The header button on wide screens, the bar at the bottom on phones.
  const toggle = page.locator('[data-agent-id="nav:concierge-panel"]:visible, [data-agent-id="nav:concierge"]:visible').first();
  await expect(async () => {
    await toggle.click({ timeout: 2_000 });
    await expect(page.locator('[data-agent-id="concierge:dock"]')).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
}

async function ask(page: Page, text: string) {
  await page.locator('[data-agent-id="concierge:input"]').fill(text);
  await page.locator('[data-agent-id="concierge:send"]').click();
}

const itemsInCart = async (page: Page) => ((await (await page.request.get("/api/cart?locale=en")).json()) as { itemCount: number }).itemCount;

test("@smoke the Concierge adds a piece to the cart when asked, and its undo takes it out again", async ({ browser }) => {
  const page = await freshPage(browser, { country: "GR" });
  await page.goto("/en", { waitUntil: "domcontentloaded" });
  await openConcierge(page);
  await ask(page, "add the faux wood table lamp to my cart");

  const log = page.locator('[data-agent-id="concierge:log"]');
  await expect(log).toContainText("Added Faux Wood Table Lamp to your cart");
  await expect(page.locator('[data-agent-id="concierge:demo"]')).toBeVisible();
  expect(await itemsInCart(page)).toBe(1);

  await log.getByRole("button", { name: "Undo" }).click();
  await expect(log).toContainText("Undone");
  expect(await itemsInCart(page)).toBe(0);
  await page.context().close();
});

test("checkout asks first, and only opens the page where the shopper pays", async ({ browser }) => {
  const page = await freshPage(browser, { country: "GR" });
  await page.goto("/en", { waitUntil: "domcontentloaded" });
  await openConcierge(page);
  await ask(page, "add the faux wood table lamp to my cart");
  await expect(page.locator('[data-agent-id="concierge:log"]')).toContainText("Added Faux Wood Table Lamp");

  await ask(page, "I'm ready to check out");
  const approval = page.locator('[data-agent-id="concierge:approval:start_checkout"]');
  await expect(approval).toContainText("Open checkout?");
  // Nothing happens before the shopper says yes.
  await expect(page).toHaveURL(/\/en$/);
  await approval.locator('[data-agent-id="concierge:approve"]').click();
  await expect(page).toHaveURL(/\/en\/checkout$/, { timeout: 15_000 });
  // The dock is still open on the new page, with the same conversation.
  await expect(page.locator('[data-agent-id="concierge:log"]')).toContainText("Checkout is open");
  await page.context().close();
});

test("declining an approval leaves everything as it was", async ({ browser }) => {
  const page = await freshPage(browser, { country: "GR" });
  await page.goto("/en", { waitUntil: "domcontentloaded" });
  await openConcierge(page);
  await ask(page, "add the faux wood table lamp to my cart");
  await expect(page.locator('[data-agent-id="concierge:log"]')).toContainText("Added Faux Wood Table Lamp");
  await ask(page, "check out please");
  await page.locator('[data-agent-id="concierge:decline"]').click();
  await expect(page.locator('[data-agent-id="concierge:log"]')).toContainText("Understood, I haven't done that.");
  await expect(page).toHaveURL(/\/en$/);
  await page.context().close();
});

test("in Greek, it answers in Greek and shows products with the shop's prices", async ({ browser }) => {
  const page = await freshPage(browser, { country: "GR" });
  await page.goto("/el", { waitUntil: "domcontentloaded" });
  await openConcierge(page);
  await ask(page, "Δείξε μου ξύλινα φωτιστικά");
  const card = page.locator('[data-agent-id^="concierge-product:"]').first();
  await expect(card).toContainText("Faux Wood Table Lamp");
  await expect(card).toContainText("94,00");
  await expect(page.locator('[data-agent-id="concierge:log"]')).toContainText("Να ένα κομμάτι που ταιριάζει");
  await page.context().close();
});

test("the open Concierge passes the accessibility checks, and Escape closes it", async ({ browser }) => {
  const page = await freshPage(browser, { country: "GR" });
  await page.goto("/en", { waitUntil: "domcontentloaded" });
  await openConcierge(page);
  await ask(page, "show me table lamps");
  await expect(page.locator('[data-agent-id^="concierge-product:"]').first()).toBeVisible();
  const results = await new AxeBuilder({ page }).include('[data-agent-id="concierge:dock"]').withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(results.violations, results.violations.map((violation) => `${violation.id} (${violation.nodes[0]?.target.join(" ")})`).join(", ")).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-agent-id="concierge:dock"]')).toHaveCount(0);
  await page.context().close();
});
