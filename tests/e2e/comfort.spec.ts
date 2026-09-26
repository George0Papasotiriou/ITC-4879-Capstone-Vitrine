/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * End-to-end tests for reading and comfort: settings kept and applied before the first paint, point by number, shortcuts, and the Concierge changing them when asked.
 */

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { freshPage } from "./support/accounts";

/** docs/adr/032. */

test.describe.configure({ timeout: 90_000 });

/** Opens a page and waits for it to hydrate; a page that has not after a while is loaded again. */
async function ready(page: Page, path = "/en") {
  await expect(async () => {
    await page.goto(path, { waitUntil: "domcontentloaded" });
    await page.locator("html[data-concierge-ready]").waitFor({ timeout: 15_000 });
  }).toPass({ timeout: 50_000 });
}

const attribute = (page: Page, name: string) => page.evaluate((key) => document.documentElement.getAttribute(key), name);

test("@smoke comfort settings apply at once, are kept, and are there before the first paint on the next page", async ({ browser }) => {
  const page = await freshPage(browser, { country: "GR" });
  await ready(page, "/en/c/lighting");
  await page.locator('[data-agent-id="nav:comfort"]').click();
  const panel = page.getByRole("dialog", { name: "Reading and comfort" });
  await expect(panel).toBeVisible();

  await panel.getByRole("radio", { name: "Large", exact: true }).click();
  await panel.getByText("More contrast", { exact: true }).click();
  await panel.getByText("A more readable font", { exact: true }).click();
  await panel.getByRole("radio", { name: "Less motion" }).click();
  expect(await attribute(page, "data-text")).toBe("125");
  expect(await attribute(page, "data-contrast")).toBe("more");
  expect(await attribute(page, "data-font")).toBe("readable");
  expect(await attribute(page, "data-motion")).toBe("reduce");
  // The whole page grew with the text size.
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe("20px");

  // The panel itself passes the accessibility checks, with the settings on.
  const results = await new AxeBuilder({ page }).include('[role="dialog"]').withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);
  await panel.getByRole("button", { name: "Done" }).click();

  // A new page load: the attributes are on <html> before any of the page's own script has run.
  await page.addInitScript(() => {
    document.addEventListener("readystatechange", () => {
      if (document.readyState === "interactive") (window as unknown as { textAtParse: string | null }).textAtParse = document.documentElement.getAttribute("data-text");
    });
  });
  await page.goto("/en/p/faux-wood-table-lamp-b07mbfd87n", { waitUntil: "domcontentloaded" });
  expect(await page.evaluate(() => (window as unknown as { textAtParse?: string | null }).textAtParse)).toBe("125");

  // One button puts everything back.
  await ready(page, "/en/p/faux-wood-table-lamp-b07mbfd87n");
  await page.locator('[data-agent-id="nav:comfort"]').click();
  await page.locator('[data-agent-id="comfort:reset"]').click();
  expect(await attribute(page, "data-text")).toBeNull();
  expect(await attribute(page, "data-motion")).toBeNull();
  await page.context().close();
});

test("point by number: every control gets a number, and typing the number presses it", async ({ browser }) => {
  const page = await freshPage(browser, { country: "GR" });
  await ready(page, "/en/c/lighting");
  await page.keyboard.press("n");
  const badges = page.locator(".point-number");
  await expect(badges.first()).toBeVisible();
  expect(await badges.count()).toBeGreaterThan(3);
  await expect(page.locator('[data-agent-id="numbers:status"]')).toContainText("numbered");

  // Number 1 is the first control at the top left: the shop's name, which goes home.
  await page.keyboard.press("1");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/en$/, { timeout: 15_000 });
  await expect(page.locator('[data-agent-id="numbers:layer"]')).toHaveCount(0);

  // Escape hides them without pressing anything.
  await page.locator("html[data-concierge-ready]").waitFor({ timeout: 30_000 });
  await page.keyboard.press("n");
  await expect(badges.first()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-agent-id="numbers:layer"]')).toHaveCount(0);
  await page.context().close();
});

test("single-key shortcuts open the Concierge and their own list, and can be switched off", async ({ browser }) => {
  const page = await freshPage(browser, { country: "GR" });
  await ready(page);
  await page.keyboard.press("?");
  await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.keyboard.press("c");
  await expect(page.locator('[data-agent-id="concierge:dock"]')).toBeVisible();
  await page.locator('[data-agent-id="concierge:close"]').click();
  await expect(page.locator('[data-agent-id="concierge:dock"]')).toHaveCount(0);

  // Off: no single key does anything (WCAG 2.1.4).
  await page.keyboard.press("a");
  const panel = page.getByRole("dialog", { name: "Reading and comfort" });
  await panel.getByText("Single-key shortcuts", { exact: true }).click();
  await panel.getByRole("button", { name: "Done" }).click();
  await page.keyboard.press("c");
  await page.waitForTimeout(400);
  await expect(page.locator('[data-agent-id="concierge:dock"]')).toHaveCount(0);
  await page.context().close();
});

test("asked in words, the Concierge makes the text larger, and the change can be undone", async ({ browser }) => {
  const page = await freshPage(browser, { country: "GR" });
  await ready(page);
  await page.locator('[data-agent-id="nav:concierge-panel"]:visible, [data-agent-id="nav:concierge"]:visible').first().click();
  await page.locator('[data-agent-id="concierge:input"]').fill("The text is too small");
  await page.locator('[data-agent-id="concierge:send"]').click();
  await expect.poll(() => attribute(page, "data-text"), { timeout: 20_000 }).toBe("125");
  await expect(page.locator('[data-agent-id="concierge:message:assistant"]').last()).toContainText("Aa", { timeout: 15_000 });

  // The change is on the actions list, with its undo.
  const undo = page.getByRole("button", { name: /Undo/ }).last();
  await undo.click();
  await expect.poll(() => attribute(page, "data-text")).toBeNull();
  await page.context().close();
});

test("the reading guide follows the pointer, and product words can be listened to", async ({ browser }) => {
  const page = await freshPage(browser, { country: "GR" });
  await ready(page, "/en/p/faux-wood-table-lamp-b07mbfd87n");
  await page.locator('[data-agent-id="nav:comfort"]').click();
  const panel = page.getByRole("dialog", { name: "Reading and comfort" });
  await panel.getByText("Reading guide", { exact: true }).click();
  await panel.getByRole("button", { name: "Done" }).click();
  await expect(page.locator('[data-agent-id="comfort:guide"]')).toBeAttached();
  await page.mouse.move(200, 400);
  await expect.poll(() => page.locator('[data-agent-id="comfort:guide"] > div').last().evaluate((band) => band.style.transform)).toContain("translateY");

  await expect(page.locator('[data-agent-id="listen:product-highlights"]')).toHaveText(/Listen/);
  await page.context().close();
});
