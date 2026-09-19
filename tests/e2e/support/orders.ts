/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Shared end-to-end helpers for orders: a paid guest order, the admin's sign-in, and moving an order at the desk.
 */

import { expect, type Page, type TestInfo } from "@playwright/test";

import { E2E_ADMIN_EMAILS } from "../../../playwright.config";
import { addLampToCart, signIn, signUpAndConfirm, uniqueEmail } from "./accounts";

export const adminEmail = (info: TestInfo) => E2E_ADMIN_EMAILS[info.project.name as keyof typeof E2E_ADMIN_EMAILS];

/** Signs the admin in, creating and confirming the account the first time. */
export async function signInAdmin(page: Page, info: TestInfo) {
  const email = adminEmail(info);
  await signIn(page, email);
  // The first test on this device creates the account; later ones find it.
  const outcome = await Promise.race([
    page.waitForURL(/\/en\/account$/, { timeout: 15_000 }).then(() => "signed-in" as const),
    page.locator('[data-agent-id="form:error"]').waitFor({ timeout: 15_000 }).then(() => "no-account" as const),
  ]);
  if (outcome === "no-account") await signUpAndConfirm(page, email, "Desk Admin");
  await expect(page.locator('[data-agent-id="account:email"]')).toHaveText(`Signed in as ${email}`);
}

/** A guest's paid order; returns its number, the guest's email and the order's private link. */
export async function paidGuestOrder(page: Page): Promise<{ number: string; email: string; url: string }> {
  const email = uniqueEmail("guest");
  await addLampToCart(page);
  await page.goto("/en/checkout", { waitUntil: "domcontentloaded" });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Full name").fill("Maria Guest");
  await page.getByLabel("Street and number").fill("Ermou 10");
  await page.getByLabel("City").fill("Athens");
  await page.getByLabel("Postcode").fill("105 63");
  await page.locator('[data-agent-id="action:place-order"]').click();
  await expect(page).toHaveURL(/\/en\/orders\/[0-9a-f-]{36}\?t=/, { timeout: 15_000 });
  const number = (await page.locator("h1").innerText()).replace("Order ", "").trim();
  const pay = page.getByRole("button", { name: /Pay .* \(test\)/ });
  await expect(async () => {
    await pay.click({ timeout: 2_000 });
    await expect(page.locator('[data-agent-id="order:status"]')).toHaveText("Paid", { timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  return { number, email, url: page.url() };
}

/** Opens an order at the desk and takes the given actions in turn, checking the status after each. */
export async function moveAtDesk(staff: Page, number: string, steps: { action: string; status: string }[]) {
  await staff.goto(`/en/staff/orders?view=all&q=${encodeURIComponent(number)}`, { waitUntil: "domcontentloaded" });
  // Opened by its address: this helper moves orders, clicking the link is tested in staff.spec.ts.
  const href = await staff.locator(`[data-agent-id="staff:order:${number}"]`).getByRole("link", { name: number }).getAttribute("href");
  await staff.goto(href!, { waitUntil: "domcontentloaded" });
  await expect(staff.locator("h1")).toHaveText(`Order ${number}`);
  for (const step of steps) {
    await staff.locator(`[data-agent-id="staff:action:${step.action}"]`).click();
    await expect(staff.locator('[data-agent-id="staff:status"]')).toHaveText(step.status);
  }
}
