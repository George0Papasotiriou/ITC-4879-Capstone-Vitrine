/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * End-to-end tests for "will it get in?": the way in measured on a product page, kept, and asked about in the Concierge.
 */

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { freshPage } from "./support/accounts";

/**
 * docs/adr/055. The Canova 3 Seater Maxi is 233 × 102 × 93 cm: its smallest
 * side is 93 × 102, so an 80 cm door stops it by 13 cm and a 110 cm door lets
 * it through. The shop works this out on the page from the catalogue's box.
 */

test.describe.configure({ timeout: 90_000 });

const SOFA = "canova-3-seater-maxi-b07g2h3l4l";

async function openWayIn(page: Page) {
  await page.goto(`/en/p/${SOFA}`, { waitUntil: "domcontentloaded" });
  const section = page.locator('[data-agent-id="product:way-in"]');
  await section.scrollIntoViewIfNeeded();
  if ((await section.getAttribute("open")) === null) await section.locator("summary").click();
  return section;
}

test("@smoke a door too narrow names the step and the centimetres; a wider one lets the sofa in", async ({ browser }) => {
  const page = await freshPage(browser, { country: "GR" });
  const section = await openWayIn(page);
  await section.locator('[data-agent-id="fit:add:door"]').click();
  // The door starts at 80 × 200.
  await expect(section.locator('[data-agent-id="fit:verdict"]')).toHaveText("It won't get past step 1");
  await expect(section.locator('[data-agent-id="fit:outcome:1"]')).toContainText("13 cm too tight");

  await section.locator('[data-agent-id="fit:field:1:width"]').fill("110");
  await expect(section.locator('[data-agent-id="fit:verdict"]')).toHaveText("It gets in");
  await expect(section.locator('[data-agent-id="fit:outcome:1"]')).toContainText("Fits, 17 cm to spare");

  // A corner, drawn from above.
  await section.locator('[data-agent-id="fit:add:turn"]').click();
  await expect(section.locator('[data-agent-id="fit:step:2"] [data-agent-id="fit:plan"]')).toBeVisible();
  await page.context().close();
});

test("the way in is kept: the next product page, the preferences and the data page all know it", async ({ browser }) => {
  const page = await freshPage(browser, { country: "GR" });
  const section = await openWayIn(page);
  await section.locator('[data-agent-id="fit:add:door"]').click();
  await section.locator('[data-agent-id="fit:field:1:width"]').fill("110");
  await section.locator('[data-agent-id="fit:save"]').click();
  await expect(section).toContainText("Saved. Every piece now checks it.");

  // Back on the page, the section opens by itself with the verdict.
  await page.reload({ waitUntil: "domcontentloaded" });
  const again = page.locator('[data-agent-id="product:way-in"]');
  await expect(again).toHaveAttribute("open", "");
  await expect(again.locator('[data-agent-id="fit:verdict"]')).toHaveText("It gets in");

  await page.goto("/en/account/preferences", { waitUntil: "domcontentloaded" });
  await expect(page.locator('[data-agent-id="prefs-fit:field:1:width"]')).toHaveValue("110");

  await page.goto("/en/account/data", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Way in, step 1: a door 110 × 200 cm")).toBeVisible();
  await page.context().close();
});

test("the Concierge checks the saved way in, and opens the page to measure it when there is none", async ({ browser }) => {
  const page = await freshPage(browser, { country: "GR" });
  await page.goto("/en", { waitUntil: "domcontentloaded" });
  await page.locator("html[data-concierge-ready]").waitFor({ timeout: 30_000 });
  await page.locator('[data-agent-id="nav:concierge-panel"]:visible, [data-agent-id="nav:concierge"]:visible').first().click();
  await expect(page.locator('[data-agent-id="concierge:dock"]')).toBeVisible({ timeout: 15_000 });

  await page.locator('[data-agent-id="concierge:input"]').fill("Will the Canova sofa get through my front door?");
  await page.locator('[data-agent-id="concierge:send"]').click();
  await expect(page).toHaveURL(/\/en\/account\/preferences#way-in$/, { timeout: 30_000 });
  await expect(page.locator('[data-agent-id="concierge:log"]')).toContainText("Measure your way in first");

  // Measured: an 80 cm front door. On a phone the Concierge is a sheet over the page, so it is put away first.
  await page.locator('[data-agent-id="concierge:close"]').click();
  const editor = page.locator('[data-agent-id="prefs:way-in"]');
  await editor.locator('[data-agent-id="prefs-fit:add:door"]').click();
  await editor.locator('[data-agent-id="prefs-fit:save"]').click();
  await expect(editor).toContainText("Saved.");

  await page.locator('[data-agent-id="nav:concierge-panel"]:visible, [data-agent-id="nav:concierge"]:visible').first().click();
  await expect(page.locator('[data-agent-id="concierge:dock"]')).toBeVisible({ timeout: 15_000 });
  await page.locator('[data-agent-id="concierge:input"]').fill("Will the Canova sofa get through my front door?");
  await page.locator('[data-agent-id="concierge:send"]').click();
  const card = page.locator('[data-agent-id="concierge:way-in"]');
  await expect(card).toContainText("won't get past step 1", { timeout: 30_000 });
  await expect(card).toContainText("13 cm too tight");
  await page.context().close();
});

test("the way in passes axe, on the product page and in the preferences", async ({ browser }) => {
  const page = await freshPage(browser, { country: "GR" });
  const section = await openWayIn(page);
  await section.locator('[data-agent-id="fit:add:door"]').click();
  await section.locator('[data-agent-id="fit:add:turn"]').click();
  const product = await new AxeBuilder({ page }).include('[data-agent-id="product:way-in"]').analyze();
  expect(product.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`)).toEqual([]);
  await page.goto("/en/account/preferences", { waitUntil: "domcontentloaded" });
  const prefs = await new AxeBuilder({ page }).include('[data-agent-id="prefs:way-in"]').analyze();
  expect(prefs.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`)).toEqual([]);
  await page.context().close();
});
