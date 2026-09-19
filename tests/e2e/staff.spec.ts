/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * End-to-end tests for the staff order desk: queues, packing and shipping, reasons, emails and access control.
 */

import { expect, test } from "@playwright/test";

import { fillAndSubmit, freshPage, linkFromOutbox, signUpAndConfirm, uniqueEmail } from "./support/accounts";
import { paidGuestOrder, signInAdmin } from "./support/orders";

/**
 * The order desk (docs/adr/016). The admin is the address ADMIN_EMAILS names
 * for this device project: signing up and confirming it is all it takes, as
 * for the first admin in production. A guest orders and pays with the local
 * test payment; the admin packs and ships; the guest's outbox gets the email.
 */

test("@smoke staff pack and ship a paid order, and the customer is emailed with their own link", async ({ browser }, info) => {
  const guest = await freshPage(browser);
  const { number, email } = await paidGuestOrder(guest);

  const staff = await freshPage(browser);
  await signInAdmin(staff, info);
  await staff.locator('[data-agent-id="action:open-order-desk"]').click();
  await expect(staff).toHaveURL(/\/en\/staff\/orders$/);
  const row = staff.locator(`[data-agent-id="staff:order:${number}"]`);
  await expect(row).toContainText("Maria Guest");
  await row.getByRole("link", { name: number }).click();

  await expect(staff.locator('[data-agent-id="staff:status"]')).toHaveText("Paid");
  await staff.locator('[data-agent-id="staff:action:pack"]').click();
  await expect(staff.locator('[data-agent-id="staff:status"]')).toHaveText("Packed");
  await staff.locator('[data-agent-id="staff:action:ship"]').click();
  await expect(staff.locator('[data-agent-id="staff:status"]')).toHaveText("Shipped");
  await expect(staff.locator('[data-agent-id="staff:history"]')).toContainText("by Desk Admin");

  // The customer's email carries their private link, which opens the order as it now is.
  const link = await linkFromOutbox(guest, email, "order_shipped");
  await guest.goto(link);
  await expect(guest.locator("h1")).toHaveText(`Order ${number}`);
  await expect(guest.locator('[data-agent-id="order:status"]')).toHaveText("Shipped");
  await guest.context().close();
  await staff.context().close();
});

test("cancelling needs a reason, which the history keeps", async ({ browser }, info) => {
  const guest = await freshPage(browser);
  const { number } = await paidGuestOrder(guest);
  await guest.context().close();

  const staff = await freshPage(browser);
  await signInAdmin(staff, info);
  await staff.goto(`/en/staff/orders?view=all&q=${encodeURIComponent(number)}`, { waitUntil: "domcontentloaded" });
  await staff.locator(`[data-agent-id="staff:order:${number}"]`).getByRole("link", { name: number }).click();

  await staff.locator('[data-agent-id="staff:action:cancel"]').click();
  await staff.locator('[data-agent-id="staff:confirm:cancel"]').click();
  await expect(staff.getByText("Say why before cancelling or refunding.")).toBeVisible();
  await fillAndSubmit(staff, { "staff:reason": "Customer asked by phone" }, "staff:confirm:cancel");
  await expect(staff.locator('[data-agent-id="staff:status"]')).toHaveText("Cancelled");
  await expect(staff.locator('[data-agent-id="staff:history"]')).toContainText("Customer asked by phone");
  await staff.context().close();
});

test("a customer cannot open the order desk or use its API", async ({ browser }) => {
  const page = await freshPage(browser);
  const signedOut = await page.request.post("/api/staff/orders/01890000-0000-7000-8000-000000000000/events", { data: { event: "pack" } });
  expect(signedOut.status()).toBe(401);
  await page.goto("/en/staff/orders", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/en\/account\/sign-in\?next=%2Fen%2Fstaff%2Forders$/);

  await signUpAndConfirm(page, uniqueEmail("customer"));
  expect((await page.goto("/en/staff/orders"))?.status()).toBe(404);
  const origin = new URL(page.url()).origin;
  const customer = await page.request.post("/api/staff/orders/01890000-0000-7000-8000-000000000000/events", {
    headers: { origin },
    data: { event: "pack" },
  });
  expect(customer.status()).toBe(403);
  // And the account page does not offer the desk.
  await page.goto("/en/account", { waitUntil: "domcontentloaded" });
  await expect(page.locator('[data-agent-id="account:email"]')).toBeVisible();
  await expect(page.locator('[data-agent-id="action:open-order-desk"]')).toHaveCount(0);
  await page.context().close();
});
