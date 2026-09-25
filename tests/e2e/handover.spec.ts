/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * End-to-end tests for the Concierge handing a shopper over to a person at the support desk.
 */

import { expect, test, type Page } from "@playwright/test";

import { freshPage, signUpAndConfirm, uniqueEmail } from "./support/accounts";
import { signInAdmin } from "./support/orders";

/**
 * docs/adr/027. The demo Concierge recognises a request for a person and
 * proposes the hand-over with the shopper's own words; the shopper reads it
 * on the approval card and nothing is sent before they say yes.
 */

test.describe.configure({ timeout: 120_000 });

const REQUEST = "My lamp arrived with a cracked base, I want to talk to a person";

async function openConcierge(page: Page) {
  await page.locator("html[data-concierge-ready]").waitFor({ timeout: 30_000 });
  await page.locator('[data-agent-id="nav:concierge-panel"]:visible, [data-agent-id="nav:concierge"]:visible').first().click();
  await expect(page.locator('[data-agent-id="concierge:dock"]')).toBeVisible({ timeout: 15_000 });
}

async function askForAPerson(page: Page) {
  await page.locator('[data-agent-id="concierge:input"]').fill(REQUEST);
  await page.locator('[data-agent-id="concierge:send"]').click();
  // The card shows the words that would be sent, before anything is.
  const card = page.locator('[data-agent-id="concierge:approval:hand_to_person"]');
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(card.locator('[data-agent-id="concierge:handover-summary"]')).toContainText("cracked base");
  return card;
}

test("@smoke a signed-in shopper is handed to a person, and the ticket is theirs to follow", async ({ browser }, info) => {
  const page = await freshPage(browser, { country: "GR" });
  await signUpAndConfirm(page, uniqueEmail("handover"));
  await page.goto("/en", { waitUntil: "domcontentloaded" });
  await openConcierge(page);

  const card = await askForAPerson(page);
  await card.locator('[data-agent-id="concierge:approve"]').click();

  const sent = page.locator('[data-agent-id="concierge:handover"]');
  await expect(sent).toBeVisible({ timeout: 30_000 });
  await expect(sent).toContainText(/VS-[0-9A-Z]{4}-[0-9A-Z]{4}/);

  // The conversation's page carries the summary they approved, and not the
  // desk's internal note with the chat, which is for staff only.
  await sent.locator('[data-agent-id="concierge:handover-link"]').click();
  await expect(page).toHaveURL(/\/en\/support\/[0-9a-f-]{36}/, { timeout: 15_000 });
  await expect(page.locator("main")).toContainText("cracked base");
  await expect(page.locator("main")).not.toContainText("Handed over from the Concierge");

  // The person who picks it up sees how it began, as a note only staff read.
  const number = /VS-[0-9A-Z]{4}-[0-9A-Z]{4}/.exec((await sent.textContent()) ?? "")![0];
  const staff = await freshPage(browser);
  await signInAdmin(staff, info);
  await staff.goto("/en/staff/support", { waitUntil: "domcontentloaded" });
  await staff.locator(`[data-agent-id="desk:ticket:${number}"]`).click();
  await expect(staff.locator("main")).toContainText("Handed over from the Concierge", { timeout: 15_000 });
  await expect(staff.locator("main")).toContainText(`Shopper: ${REQUEST}`);

  await staff.context().close();
  await page.context().close();
});

test("a guest is sent to the contact form with the message written in, and adds their own email", async ({ browser }) => {
  const page = await freshPage(browser, { country: "GR" });
  await page.goto("/en", { waitUntil: "domcontentloaded" });
  await openConcierge(page);

  const card = await askForAPerson(page);
  await card.locator('[data-agent-id="concierge:approve"]').click();

  await expect(page).toHaveURL(/\/en\/contact$/, { timeout: 30_000 });
  await expect(page.locator('[data-agent-id="support:from-concierge"]')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[data-agent-id="support:body"]')).toHaveValue(/cracked base/);
  // The address is the guest's to type: nothing filled it in.
  await expect(page.locator('[data-agent-id="support:email"]')).toHaveValue("");

  await page.context().close();
});

test("saying no sends nothing, and leaves nothing waiting", async ({ browser }) => {
  // A guest, so this file signs up once per device: the accounts service
  // limits sign-ups, and a second one here would test the limit, not this.
  const page = await freshPage(browser, { country: "GR" });
  await page.goto("/en", { waitUntil: "domcontentloaded" });
  await openConcierge(page);

  const card = await askForAPerson(page);
  await card.locator('[data-agent-id="concierge:decline"]').click();
  await expect(page.locator('[data-agent-id="concierge:log"]')).toContainText("Declined", { timeout: 15_000 });
  await expect(page.locator('[data-agent-id="concierge:handover"]')).toHaveCount(0);

  // The page did not move, and no message was left for the contact form.
  await expect(page).toHaveURL(/\/en$/);
  expect(await page.evaluate(() => window.sessionStorage.getItem("vitrine:contact-draft"))).toBeNull();
  await page.goto("/en/contact", { waitUntil: "domcontentloaded" });
  await page.locator('[data-agent-id="support:form"]').waitFor();
  await expect(page.locator('[data-agent-id="support:from-concierge"]')).toHaveCount(0);
  await expect(page.locator('[data-agent-id="support:body"]')).toHaveValue("");

  await page.context().close();
});
