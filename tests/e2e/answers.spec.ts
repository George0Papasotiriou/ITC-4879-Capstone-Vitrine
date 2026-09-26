/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * End-to-end tests for the desk's ready answers: editing one, refusing a blank a draft cannot fill, restoring, adding and removing.
 */

import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { freshPage } from "./support/accounts";
import { signInAdmin } from "./support/orders";

/**
 * docs/adr/029. One test per device: the accounts service limits sign-ins,
 * and the flow is one person working through the page anyway.
 */

test.describe.configure({ timeout: 120_000 });

test("@smoke the desk edits a ready answer, is stopped by a blank no draft can fill, and puts the shop's words back", async ({ browser }, info) => {
  const page = await freshPage(browser);
  await signInAdmin(page, info);
  await page.goto("/en/staff/support", { waitUntil: "domcontentloaded" });
  await page.locator('[data-agent-id="desk:answers-link"]').click();
  await expect(page).toHaveURL(/\/en\/staff\/support\/answers$/, { timeout: 15_000 });

  const damaged = page.locator('[data-agent-id="answer:damaged"]');
  await expect(damaged.locator('[data-agent-id="answer:damaged:source"]')).toHaveText("The shop's words");
  await damaged.locator('[data-agent-id$=":open"]').click();

  // A blank in braces that the draft cannot fill is refused, next to the field.
  const bodyEn = damaged.locator('[data-agent-id$=":bodyEn"]');
  await bodyEn.fill("Hello {customer},\n\nWe are sorry it arrived damaged.");
  await damaged.locator('[data-agent-id$=":save"]').click();
  await expect(damaged).toContainText("A blank in braces that a draft cannot fill");

  // A real edit is saved, marked as the desk's, and on the audit log.
  await bodyEn.fill("Hello {name},\n\nWe are sorry it arrived damaged. Two photographs are all we need to arrange the rest.");
  await damaged.locator('[data-agent-id$=":save"]').click();
  await expect(damaged.locator('[data-agent-id="answer:damaged:source"]')).toContainText("Edited by the desk", { timeout: 15_000 });
  await expect(damaged).toContainText("Two photographs are all we need");

  // The shop's words come back with one button.
  await damaged.locator('[data-agent-id$=":open"]').click();
  await damaged.locator('[data-agent-id$=":restore"]').click();
  await expect(damaged.locator('[data-agent-id="answer:damaged:source"]')).toHaveText("The shop's words", { timeout: 15_000 });
  await expect(damaged).not.toContainText("Two photographs are all we need");

  // A new answer, written in both languages, filed under its queue, and removed again.
  await page.locator('[data-agent-id="answer:new:open"]').click();
  await page.locator('[data-agent-id="answer:new:topic"]').selectOption("delivery");
  await page.locator('[data-agent-id="answer:new:titleEn"]').fill("Saturday delivery");
  await page.locator('[data-agent-id="answer:new:titleEl"]').fill("Παράδοση το Σάββατο");
  await page.locator('[data-agent-id="answer:new:bodyEn"]').fill("Hello {name},\n\nThe carrier can come on Saturday morning.");
  await page.locator('[data-agent-id="answer:new:bodyEl"]').fill("Γεια σου {name},\n\nΗ μεταφορική μπορεί να έρθει το Σάββατο το πρωί.");
  await page.locator('[data-agent-id="answer:new:save"]').click();
  const saturday = page.locator('[data-agent-id^="answer:saturday_delivery"]').first();
  await expect(saturday).toBeVisible({ timeout: 15_000 });
  await expect(saturday).toContainText("Written by the desk");
  await saturday.locator('[data-agent-id$=":open"]').click();
  await saturday.locator('[data-agent-id$=":remove"]').click();
  await expect(page.locator('[data-agent-id^="answer:saturday_delivery"]')).toHaveCount(0, { timeout: 15_000 });

  // Every change is on the audit log under the person who made it.
  await page.goto("/en/admin/audit?entity=macro", { waitUntil: "domcontentloaded" });
  const log = page.locator('[data-agent-id="audit:entries"]');
  await expect(log).toContainText("Edited a ready answer");
  await expect(log).toContainText("Restored a ready answer");
  await expect(log).toContainText("Wrote a ready answer");
  await expect(log).toContainText("Removed a ready answer");

  // And the page passes the accessibility checks, with an editor open.
  await page.goto("/en/staff/support/answers", { waitUntil: "domcontentloaded" });
  await page.locator('[data-agent-id="answer:new:open"]').click();
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);

  await page.context().close();
});

test("a customer cannot open the ready answers, or change one", async ({ browser }) => {
  const page = await freshPage(browser);
  await page.goto("/en/staff/support/answers", { waitUntil: "domcontentloaded" });
  // A visitor with no account is sent to sign in.
  await expect(page).toHaveURL(/\/en\/account\/sign-in/, { timeout: 15_000 });
  const refused = await page.request.post("/api/staff/support/answers", {
    headers: { origin: new URL(page.url()).origin, "content-type": "application/json" },
    data: { action: "remove", id: "01890000-0000-7000-8000-000000000001" },
  });
  expect(refused.status()).toBe(401);
  await page.context().close();
});
