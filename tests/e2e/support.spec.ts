/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * End-to-end tests for the support desk: writing in, the draft an agent sends, closing, and who may see a ticket.
 */

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { freshPage, linkFromOutbox, uniqueEmail } from "./support/accounts";
import { signInAdmin } from "./support/orders";

/**
 * docs/adr/021. The test server has no AI key, so "Write a draft" comes from
 * the desk's ready answers — the same path a model takes, with the same
 * storage, the same editing and the same send.
 */

test.describe.configure({ timeout: 90_000 });

async function writeToTheDesk(page: Page, email: string, message: string): Promise<void> {
  await page.goto("/en/contact", { waitUntil: "domcontentloaded" });
  await page.locator('[data-agent-id="support:name"]').fill("Anna Test");
  await page.locator('[data-agent-id="support:email"]').fill(email);
  await page.locator('[data-agent-id="support:body"]').fill(message);
  await page.locator('[data-agent-id="action:send-support"]').click();
}

test("@smoke a guest writes to the desk, an agent sends the draft, and the conversation closes with a score", async ({ browser }, info) => {
  const customer = await freshPage(browser);
  const email = uniqueEmail("desk");
  await writeToTheDesk(customer, email, "Hello, my rug arrived with a tear on the edge. Can I send it back?");

  // The page lands on the conversation, and the email carries the private link.
  await expect(customer.locator('[data-agent-id^="support:ticket:"]')).toBeVisible({ timeout: 20_000 });
  const number = (await customer.locator('[data-agent-id^="support:ticket:"]').getAttribute("data-agent-id"))!.replace("support:ticket:", "");
  const link = await linkFromOutbox(customer, email, "support_received");
  expect(link).toContain("/support/");

  // The desk sees it, writes a draft from the ready answers, edits it and sends.
  const staff = await freshPage(browser);
  await signInAdmin(staff, info);
  await staff.goto("/en/staff/support", { waitUntil: "domcontentloaded" });
  await expect(staff.locator(`[data-agent-id="desk:ticket:${number}"]`)).toContainText("Anna Test");
  await staff.locator(`[data-agent-id="desk:ticket:${number}"]`).click();

  const reply = staff.locator('[data-agent-id="desk:reply"]');
  await staff.locator('[data-agent-id="action:write-draft"]').click();
  await expect(reply).not.toHaveValue("", { timeout: 20_000 });
  await expect(staff.locator('[data-agent-id="desk:draft-note"]')).toBeVisible();
  await reply.fill("Hello Anna,\n\nI am sorry about the rug. We will collect it and refund it in full.");
  await staff.locator('[data-agent-id="action:send-reply"]').click();
  await expect(staff.locator('[data-agent-id="desk:ticket-facts"]')).toContainText("Waiting for the customer", { timeout: 20_000 });
  // What goes out is the agent's message, not a draft.
  await expect(staff.locator('[data-agent-id="desk:message:agent"]')).toContainText("collect it and refund it in full");
  await expect(staff.locator('[data-agent-id="desk:message:draft"]')).toHaveCount(0);

  // The customer reads it through the link from the email and writes back.
  await customer.goto(link, { waitUntil: "domcontentloaded" });
  await expect(customer.locator('[data-agent-id="support:messages"]')).toContainText("collect it and refund it in full");
  await customer.locator('[data-agent-id="support:reply"]').fill("Thank you. When will you collect it?");
  await customer.locator('[data-agent-id="action:send-reply"]').click();
  await expect(customer.locator('[data-agent-id="support:messages"]')).toContainText("When will you collect it?", { timeout: 20_000 });

  // The desk closes it, and the customer is asked the one question.
  await staff.reload({ waitUntil: "domcontentloaded" });
  await staff.locator('[data-agent-id="action:close-ticket"]').click();
  await expect(staff.locator('[data-agent-id="desk:ticket-facts"]')).toContainText("Closed", { timeout: 20_000 });

  await customer.goto(link, { waitUntil: "domcontentloaded" });
  await customer.locator('[data-agent-id="action:rate:5"]').click();
  await expect(customer.locator('[data-agent-id="support:rated"]')).toContainText("5 out of 5", { timeout: 20_000 });

  await customer.context().close();
  await staff.context().close();
});

test("a conversation opens only with its link, and a customer cannot work the desk", async ({ browser }) => {
  const customer = await freshPage(browser);
  const email = uniqueEmail("private");
  await writeToTheDesk(customer, email, "A question about delivery to Cyprus, please.");
  await expect(customer.locator('[data-agent-id^="support:ticket:"]')).toBeVisible({ timeout: 20_000 });
  const url = new URL(customer.url());
  const id = url.pathname.split("/").at(-1)!;

  // Someone else's browser, with the id but not the token.
  const stranger = await freshPage(browser);
  expect((await stranger.goto(`/en/support/${id}`))?.status()).toBe(404);
  expect((await stranger.goto(`/en/support/${id}?t=not-the-token`))?.status()).toBe(404);
  // A visitor with no account is sent to sign in; a signed-in customer gets 404 (tests/e2e/admin.spec.ts).
  await stranger.goto("/en/staff/support", { waitUntil: "domcontentloaded" });
  await expect(stranger).toHaveURL(/\/en\/account\/sign-in/);

  const origin = url.origin;
  const asStranger = await stranger.request.post(`/api/staff/support/${id}`, { headers: { origin }, data: { action: "reply", body: "Hello" } });
  expect(asStranger.status()).toBe(401);
  const rate = await stranger.request.post("/api/support", { headers: { origin }, data: { action: "rate", ticketId: id, score: 5 } });
  expect(rate.status()).toBe(404);

  await stranger.context().close();
  await customer.context().close();
});

test("the desk and the contact page pass the accessibility checks", async ({ browser }, info) => {
  const customer = await freshPage(browser);
  const email = uniqueEmail("axe");
  await writeToTheDesk(customer, email, "Is the Canova sofa available in grey?");
  await expect(customer.locator('[data-agent-id^="support:ticket:"]')).toBeVisible({ timeout: 20_000 });
  const ticketUrl = customer.url();

  for (const path of ["/en/contact", "/el/contact", ticketUrl]) {
    await customer.goto(path, { waitUntil: "networkidle" });
    const results = await new AxeBuilder({ page: customer }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    expect(results.violations, `${path}: ${results.violations.map((violation) => violation.id).join(", ")}`).toEqual([]);
  }
  await customer.context().close();

  const staff = await freshPage(browser);
  await signInAdmin(staff, info);
  await staff.goto("/en/staff/support", { waitUntil: "networkidle" });
  const queue = await new AxeBuilder({ page: staff }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(queue.violations, queue.violations.map((violation) => violation.id).join(", ")).toEqual([]);

  await staff.locator('[data-agent-id^="desk:ticket:"]').first().click();
  await staff.waitForLoadState("networkidle");
  const ticket = await new AxeBuilder({ page: staff }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(ticket.violations, ticket.violations.map((violation) => violation.id).join(", ")).toEqual([]);
  await staff.context().close();
});
