/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Shared end-to-end helpers for accounts: fresh browsers, the outbox, sign-up, sign-in and TOTP codes.
 */

import { createHmac, randomInt } from "node:crypto";

import { expect, type Browser, type Page } from "@playwright/test";
import { E2E_COUNTRY_HEADER } from "../../../playwright.config";

/**
 * Each test gets its own browser with its own client address, so Better Auth's
 * per-address rate limits (3 sign-ins in 10 s) apply to each test as they would
 * to one person. Emails are read from the local outbox (/en/lab/outbox).
 */

export const PASSWORD = "correct horse battery";
export const LAMP = "/en/p/faux-wood-table-lamp-b07mbfd87n";

/** A TEST-NET-3 address (RFC 5737), different for every browser. */
export const clientAddress = () => `203.0.113.${randomInt(1, 255)}`;
export const uniqueEmail = (label: string) => `${label}.${Date.now()}.${randomInt(1e6)}@example.com`;

/** A new browser context from its own address; `country` sets where the shop thinks it is (prices, VAT). */
export async function freshPage(browser: Browser, { country }: { country?: string } = {}): Promise<Page> {
  const context = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": clientAddress(), ...(country === undefined ? {} : { [E2E_COUNTRY_HEADER]: country }) } });
  return context.newPage();
}

/** The newest link in the outbox for an address and kind of email. */
export async function linkFromOutbox(page: Page, address: string, kind: string): Promise<string> {
  let link: string | null = null;
  await expect(async () => {
    await page.goto("/en/lab/outbox", { waitUntil: "domcontentloaded" });
    const email = page.locator(`[data-agent-id="outbox:email:${kind}"]`).filter({ hasText: address }).first();
    link = await email.locator('[data-agent-id="outbox:link"]').getAttribute("href", { timeout: 1_000 });
    expect(link).toBeTruthy();
  }).toPass({ timeout: 15_000 });
  return link!;
}

export async function fillAndSubmit(page: Page, fields: Record<string, string>, action: string) {
  for (const [agentId, value] of Object.entries(fields)) await page.locator(`[data-agent-id="${agentId}"]`).fill(value);
  // Submit buttons stay disabled until the form is hydrated; click() waits for that.
  await page.locator(`[data-agent-id="${action}"]`).click();
}

/** Signs up through the form and confirms by the emailed link: the page ends signed in. */
export async function signUpAndConfirm(page: Page, email: string, name = "Eleni Papadopoulou") {
  await page.goto("/en/account/sign-up", { waitUntil: "domcontentloaded" });
  await fillAndSubmit(page, { "auth:name": name, "auth:email": email, "auth:password": PASSWORD }, "action:sign-up");
  await expect(page.locator('[data-agent-id="auth:check-inbox"]')).toContainText(email);
  await page.goto(await linkFromOutbox(page, email, "verify_email"));
  await expect(page).toHaveURL(/\/en\/account\?verified=1$/);
  await expect(page.locator('[data-agent-id="account:email"]')).toHaveText(`Signed in as ${email}`);
}

export async function signIn(page: Page, email: string, password = PASSWORD) {
  await page.goto("/en/account/sign-in", { waitUntil: "domcontentloaded" });
  await fillAndSubmit(page, { "auth:email": email, "auth:password": password }, "action:sign-in");
}

export async function signOut(page: Page) {
  await page.locator('[data-agent-id="action:sign-out"]').click();
  await expect(page).toHaveURL(/\/en$/);
}

/** RFC 6238 TOTP, as an authenticator app computes it. */
export function totp(secret: string, at = Date.now()): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const character of secret.replace(/[\s=]/g, "").toUpperCase()) bits += alphabet.indexOf(character).toString(2).padStart(5, "0");
  const key = Buffer.from(bits.match(/.{8}/g)!.map((byte) => Number.parseInt(byte, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const hmac = createHmac("sha1", key).update(counter).digest();
  const offset = hmac[19]! & 15;
  return String((hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

export async function addLampToCart(page: Page) {
  await page.goto(LAMP, { waitUntil: "domcontentloaded" });
  const sheet = page.getByRole("dialog", { name: "Added to your cart" });
  await expect(async () => {
    if (!(await sheet.isVisible())) await page.locator('[data-agent-id^="action:add-to-cart:"]').click({ timeout: 2_000 });
    await expect(sheet).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 25_000 });
}
