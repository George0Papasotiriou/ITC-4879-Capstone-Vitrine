/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * End-to-end tests for price watches, the AI page and its switches, and the weekly report.
 */

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { freshPage, LAMP, signUpAndConfirm, uniqueEmail } from "./support/accounts";
import { signInAdmin } from "./support/orders";

/**
 * docs/adr/020. The watch is set on the product page and read back on the
 * account page; the nightly pass that emails it is covered by the integration
 * tests, which can move a price and run the job.
 *
 * The AI switches are global, and the suite runs one test at a time
 * (playwright.config.ts), so the kill switch is turned on and off inside a
 * single test rather than left for the next one.
 */

const watch = (page: Page) => page.locator('[data-agent-id^="price-watch:"]').first();

test("@smoke a shopper sets the price they are waiting for, changes it, and stops watching", async ({ browser }) => {
  const page = await freshPage(browser, { country: "GR" });

  // A guest is told what it does and invited to sign in; nothing is saved for nobody.
  await page.goto(LAMP, { waitUntil: "domcontentloaded" });
  await expect(watch(page)).toContainText("Sign in and we will email you");
  const guestTry = await page.request.post("/api/watch", {
    headers: { origin: new URL(page.url()).origin },
    data: { action: "set", productId: "01890000-0000-7000-8000-000000000000", targetCents: 1_000, locale: "en" },
  });
  expect(guestTry.status()).toBe(401);

  await signUpAndConfirm(page, uniqueEmail("watcher"));
  await page.goto(LAMP, { waitUntil: "domcontentloaded" });
  await page.locator('[data-agent-id="action:watch-price"]').click();

  // The form starts below today's price, and refuses a target that is not below it.
  const target = page.locator('[data-agent-id="price-watch:target"]');
  await expect(target).toHaveValue("84.00");
  await target.fill("120");
  await page.locator('[data-agent-id="action:save-price-watch"]').click();
  await expect(page.locator('[data-agent-id="price-watch:form"]')).toContainText("Write an amount below");
  await target.fill("79,50");
  await page.locator('[data-agent-id="action:save-price-watch"]').click();
  await expect(page.locator('[data-agent-id="price-watch:state"]')).toContainText("We will email you when it reaches €79.50");

  // It is on the account page, with today's price beside it.
  await page.goto("/en/account", { waitUntil: "domcontentloaded" });
  const row = page.locator('[data-agent-id="account:watches"] li').first();
  await expect(row).toContainText("Faux Wood Table Lamp");
  await expect(row).toContainText("Waiting for €79.50");

  // Asking again moves the target rather than adding a second row.
  await page.goto(LAMP, { waitUntil: "domcontentloaded" });
  await page.locator('[data-agent-id="action:watch-price"]').click();
  await target.fill("70");
  await page.locator('[data-agent-id="action:save-price-watch"]').click();
  await expect(page.locator('[data-agent-id="price-watch:state"]')).toContainText("€70.00");
  await page.goto("/en/account", { waitUntil: "domcontentloaded" });
  await expect(page.locator('[data-agent-id="account:watches"] li')).toHaveCount(1);

  await page.locator('[data-agent-id^="action:stop-watch:"]').first().click();
  await expect(page.locator('[data-agent-id="account:watches"]')).toHaveCount(0);
  await page.goto(LAMP, { waitUntil: "domcontentloaded" });
  await expect(watch(page)).toContainText("Say what you would pay");
  await page.context().close();
});

test("the AI page shows what AI costs, and its switches are the admin's alone", async ({ browser }, info) => {
  const staff = await freshPage(browser);
  await signInAdmin(staff, info);
  await staff.goto("/en/admin/ai?days=7", { waitUntil: "domcontentloaded" });
  await expect(staff.locator('[data-agent-id="admin:ai-mode"]')).toContainText("Demo");
  for (const panel of ["ai-by-day", "ai-by-feature", "ai-settings"]) {
    await expect(staff.locator(`[data-agent-id="dashboard:${panel}"]`)).toBeVisible();
  }
  await expect(staff.locator('[data-agent-id="ai:today"]')).toContainText("daily budget");

  // The budget is saved and recorded; demo answers are free, so the shop is unaffected.
  await staff.locator('[data-agent-id="admin:ai-budget"]').fill("4,50");
  await staff.locator('[data-agent-id="admin:ai-budget-save"]').click();
  // Radix announces a toast twice, visibly and in a live region (as the other specs found).
  await expect(staff.getByText("Saved.", { exact: true }).first()).toBeVisible();
  await staff.reload({ waitUntil: "domcontentloaded" });
  await expect(staff.locator('[data-agent-id="admin:ai-budget"]')).toHaveValue("4.50");
  await staff.goto("/en/admin/audit?entity=setting", { waitUntil: "domcontentloaded" });
  await expect(staff.locator('[data-agent-id^="audit:entry:"]').first()).toContainText("Changed an AI switch");

  // An amount that is not one is refused in the browser, before the shop hears about it.
  await staff.goto("/en/admin/ai", { waitUntil: "domcontentloaded" });
  await staff.locator('[data-agent-id="admin:ai-budget"]').fill("soon");
  await staff.locator('[data-agent-id="admin:ai-budget-save"]').click();
  await expect(staff.locator('[data-agent-id="dashboard:ai-settings"]')).toContainText("Write an amount between 0 and 1000");
  await staff.context().close();
});

test("the kill switch stops the Concierge answering, and lets it answer again", async ({ browser }, info) => {
  test.setTimeout(120_000);
  const staff = await freshPage(browser);
  await signInAdmin(staff, info);
  await staff.goto("/en/admin/ai", { waitUntil: "domcontentloaded" });

  await staff.locator('[data-agent-id="admin:ai-kill-switch"]').click();
  await expect(staff.locator('[data-agent-id="admin:ai-state"]')).toContainText("Paused", { timeout: 15_000 });

  const shopper = await freshPage(browser, { country: "GR" });
  await shopper.goto("/en", { waitUntil: "domcontentloaded" });
  await shopper.locator("html[data-concierge-ready]").waitFor({ timeout: 30_000 });
  await shopper.locator('[data-agent-id="nav:concierge-panel"]:visible, [data-agent-id="nav:concierge"]:visible').first().click();
  await shopper.locator('[data-agent-id="concierge:input"]').fill("show me a table lamp");
  await shopper.locator('[data-agent-id="concierge:send"]').click();
  await expect(shopper.locator('[data-agent-id="concierge:refusal"]')).toContainText("paused", { timeout: 20_000 });
  await shopper.context().close();

  await staff.locator('[data-agent-id="admin:ai-kill-switch"]').click();
  await expect(staff.locator('[data-agent-id="admin:ai-state"]')).toContainText("Running", { timeout: 15_000 });
  await staff.context().close();
});

test("an admin builds the weekly report and the link gives back a PDF", async ({ browser }, info) => {
  const staff = await freshPage(browser);
  await signInAdmin(staff, info);
  await staff.goto("/en/admin", { waitUntil: "domcontentloaded" });
  await expect(staff.locator('[data-agent-id="dashboard:reports"]')).toBeVisible();

  await staff.locator('[data-agent-id="action:generate-report"]').click();
  await expect(staff.getByText("Building the report. It appears here in a moment.").first()).toBeVisible();

  const link = staff.locator('[data-agent-id^="dashboard:report:"]').first();
  await expect(link).toBeVisible({ timeout: 30_000 });
  const href = (await link.getAttribute("href"))!;
  const file = await staff.request.get(href);
  expect(file.status()).toBe(200);
  expect(file.headers()["content-type"]).toContain("application/pdf");
  expect((await file.body()).subarray(0, 8).toString("latin1")).toBe("%PDF-1.7");

  // Row and file agree on the week.
  await expect(staff.locator('[data-agent-id="dashboard:reports-table"]')).toContainText("Sales");
  await staff.context().close();
});

test("the AI page passes the accessibility checks in both languages", async ({ browser }, info) => {
  const staff = await freshPage(browser);
  await signInAdmin(staff, info);
  for (const path of ["/en/admin/ai", "/el/admin/ai"]) {
    await staff.goto(path, { waitUntil: "networkidle" });
    const results = await new AxeBuilder({ page: staff }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    expect(results.violations, `${path}: ${results.violations.map((violation) => violation.id).join(", ")}`).toEqual([]);
  }
  await staff.context().close();
});
