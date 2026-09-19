/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * End-to-end tests for accounts: sign-up by email link, sign-in, two-step sign-in, passkeys, reset, cart and orders.
 */

import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { addLampToCart, fillAndSubmit, freshPage, linkFromOutbox, PASSWORD, signIn, signOut, signUpAndConfirm, totp, uniqueEmail } from "./support/accounts";

/**
 * Accounts (docs/adr/016) as a shopper meets them, on the production build.
 * Helpers, and why each test gets its own browser, are in ./support/accounts.ts.
 */

test("@smoke signs up, confirms the email by link, signs out and signs back in", async ({ browser }) => {
  const page = await freshPage(browser);
  const email = uniqueEmail("smoke");
  await signUpAndConfirm(page, email);
  await expect(page.getByText("Your email is confirmed and you are signed in.")).toBeVisible();
  await expect(page.locator('[data-agent-id="account:sessions"]')).toContainText("This device");

  await signOut(page);
  await page.goto("/en/account", { waitUntil: "domcontentloaded" });
  await expect(page.locator('[data-agent-id="action:go-sign-in"]')).toBeVisible();

  await signIn(page, email);
  await expect(page).toHaveURL(/\/en\/account$/);
  await expect(page.locator('[data-agent-id="account:email"]')).toHaveText(`Signed in as ${email}`);
  await page.context().close();
});

test("says what is wrong: a wrong password, and an address not yet confirmed", async ({ browser }) => {
  const page = await freshPage(browser);
  const email = uniqueEmail("unconfirmed");
  await page.goto("/en/account/sign-up", { waitUntil: "domcontentloaded" });
  await fillAndSubmit(page, { "auth:name": "Nikos", "auth:email": email, "auth:password": PASSWORD }, "action:sign-up");
  await expect(page.locator('[data-agent-id="auth:check-inbox"]')).toBeVisible();

  await signIn(page, email);
  await expect(page.locator('[data-agent-id="form:error"]')).toHaveText("Confirm your email first. We have just sent you a new link.");

  await signIn(page, email, "not the password at all");
  await expect(page.locator('[data-agent-id="form:error"]')).toHaveText("That email and password do not match an account. Check both, or reset your password.");
  await page.context().close();
});

test("a short password is explained next to the field, before anything is sent", async ({ page }) => {
  await page.goto("/en/account/sign-up", { waitUntil: "domcontentloaded" });
  await fillAndSubmit(page, { "auth:name": "Anna", "auth:email": "anna@example.com", "auth:password": "short" }, "action:sign-up");
  await expect(page.getByText("Use at least 10 characters.")).toBeVisible();
  await expect(page.locator('[data-agent-id="auth:password"]')).toHaveAttribute("aria-invalid", "true");
});

test("turns on two-step sign-in with an authenticator app, then asks for the code at sign-in", async ({ browser }) => {
  const page = await freshPage(browser);
  const email = uniqueEmail("totp");
  await signUpAndConfirm(page, email);

  await page.locator('[data-agent-id="action:enable-2fa"]').click();
  await fillAndSubmit(page, { "auth:2fa-password": PASSWORD }, "action:2fa-password");
  const secret = (await page.locator('[data-agent-id="account:totp-secret"]').innerText()).trim();
  await expect(page.getByRole("img", { name: "QR code to add Vitrine to an authenticator app" })).toBeVisible();
  await fillAndSubmit(page, { "auth:2fa-code": totp(secret) }, "action:confirm-2fa");
  const codes = page.locator('[data-agent-id="account:backup-codes"] li');
  await expect(codes).toHaveCount(10);
  const backupCode = (await codes.first().innerText()).trim();
  await page.locator('[data-agent-id="action:backup-codes-saved"]').click();
  await expect(page.locator('[data-agent-id="account:two-factor-state"]')).toHaveText(
    "On. After your password, sign-in asks for a code from your authenticator app.",
  );

  await signOut(page);
  await signIn(page, email);
  await expect(page).toHaveURL(/\/en\/account\/two-factor/);
  await fillAndSubmit(page, { "auth:code": "000000" }, "action:verify-code");
  await expect(page.locator('[data-agent-id="form:error"]')).toContainText("That code did not work.");
  await fillAndSubmit(page, { "auth:code": totp(secret) }, "action:verify-code");
  await expect(page).toHaveURL(/\/en\/account$/);

  // A backup code works once, as the page promises.
  await signOut(page);
  await signIn(page, email);
  await expect(page).toHaveURL(/\/en\/account\/two-factor/);
  await page.getByRole("button", { name: "Use a backup code instead" }).click();
  await fillAndSubmit(page, { "auth:backup-code": backupCode }, "action:verify-code");
  await expect(page).toHaveURL(/\/en\/account$/);
  await page.context().close();
});

test("adds a passkey and signs in with it, no password", async ({ browser }) => {
  const page = await freshPage(browser);
  // A virtual authenticator stands in for the device's fingerprint or face check.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });

  const email = uniqueEmail("passkey");
  await signUpAndConfirm(page, email);
  await page.locator('[data-agent-id="action:add-passkey"]').click();
  await expect(page.locator('[data-agent-id="account:passkeys"] li')).toHaveCount(1);

  await signOut(page);
  await page.goto("/en/account/sign-in", { waitUntil: "domcontentloaded" });
  await expect(async () => {
    await page.locator('[data-agent-id="action:passkey-sign-in"]').click({ timeout: 2_000 });
    await expect(page).toHaveURL(/\/en\/account$/, { timeout: 5_000 });
  }).toPass({ timeout: 20_000 });
  await expect(page.locator('[data-agent-id="account:email"]')).toHaveText(`Signed in as ${email}`);
  await page.context().close();
});

test("resets a forgotten password by the emailed link", async ({ browser }) => {
  const page = await freshPage(browser);
  const email = uniqueEmail("reset");
  await signUpAndConfirm(page, email);
  await signOut(page);

  await page.goto("/en/account/forgot-password", { waitUntil: "domcontentloaded" });
  await fillAndSubmit(page, { "auth:email": email }, "action:send-reset");
  await expect(page.getByText(`If ${email} has an account, a link is on its way.`)).toBeVisible();

  await page.goto(await linkFromOutbox(page, email, "reset_password"));
  await expect(page).toHaveURL(/\/en\/account\/reset-password\?token=/);
  await fillAndSubmit(page, { "auth:new-password": "a brand new passphrase" }, "action:save-password");
  await expect(page.getByText("Your password is changed and every device is signed out.")).toBeVisible();

  await signIn(page, email, PASSWORD);
  await expect(page.locator('[data-agent-id="form:error"]')).toContainText("do not match an account");
  await signIn(page, email, "a brand new passphrase");
  await expect(page).toHaveURL(/\/en\/account$/);
  await page.context().close();
});

test("a guest cart follows the shopper into the account, and orders placed signed in appear there", async ({ browser }) => {
  const page = await freshPage(browser);
  await addLampToCart(page);
  const email = uniqueEmail("cart");
  await signUpAndConfirm(page, email);

  // The lamp added as a guest is now in the account's cart.
  await page.goto("/en/cart", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Faux Wood Table Lamp", { exact: false }).first()).toBeVisible();

  // Signed out, the same browser no longer sees the account's cart.
  await page.goto("/en/account", { waitUntil: "domcontentloaded" });
  await signOut(page);
  await page.goto("/en/cart", { waitUntil: "domcontentloaded" });
  await expect(page.locator('[data-agent-id="action:checkout"]')).toHaveCount(0);

  // Back in, it is there, and checkout starts from the account's email and name.
  await signIn(page, email);
  await expect(page).toHaveURL(/\/en\/account$/);
  await page.goto("/en/checkout", { waitUntil: "domcontentloaded" });
  await expect(page.getByLabel("Email")).toHaveValue(email);
  await expect(page.getByLabel("Full name")).toHaveValue("Eleni Papadopoulou");
  await page.getByLabel("Street and number").fill("Ermou 10");
  await page.getByLabel("City").fill("Athens");
  await page.getByLabel("Postcode").fill("105 63");
  await page.locator('[data-agent-id="action:place-order"]').click();
  await expect(page).toHaveURL(/\/en\/orders\/[0-9a-f-]{36}\?t=/, { timeout: 15_000 });
  const number = (await page.locator("h1").innerText()).replace("Order ", "").trim();

  // The account lists it, and opens it without the guest link.
  await page.goto("/en/account", { waitUntil: "domcontentloaded" });
  const row = page.locator(`[data-agent-id="account:order:${number}"]`);
  await expect(row).toContainText("Waiting for payment");
  await row.click();
  await expect(page).toHaveURL(/\/en\/orders\/[0-9a-f-]{36}$/);
  await expect(page.locator("h1")).toHaveText(`Order ${number}`);
  await page.context().close();
});

test("an order page without its link asks a signed-out visitor to sign in, and hides other people's orders", async ({ browser }) => {
  const page = await freshPage(browser);
  const id = "01890000-0000-7000-8000-000000000000";
  await page.goto(`/en/orders/${id}`, { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(new RegExp(`/en/account/sign-in\\?next=%2Fen%2Forders%2F${id}$`));

  await signUpAndConfirm(page, uniqueEmail("nosy"));
  const response = await page.goto(`/en/orders/${id}`);
  expect(response?.status()).toBe(404);
  await page.context().close();
});

test("a customer cannot use the admin endpoints", async ({ browser }) => {
  const page = await freshPage(browser);
  await signUpAndConfirm(page, uniqueEmail("customer"));
  const origin = new URL(page.url()).origin;
  const list = await page.request.get("/api/auth/admin/list-users", { headers: { origin } });
  expect(list.status()).toBe(403);
  const promote = await page.request.post("/api/auth/admin/set-role", { headers: { origin }, data: { userId: "x", role: "admin" } });
  expect(promote.status()).toBe(403);
  await page.context().close();
});

test("refuses a return address on another site after signing in", async ({ browser }) => {
  const page = await freshPage(browser);
  const email = uniqueEmail("next");
  await signUpAndConfirm(page, email);
  await signOut(page);
  await page.goto("/en/account/sign-in?next=https%3A%2F%2Fevil.example%2F", { waitUntil: "domcontentloaded" });
  await fillAndSubmit(page, { "auth:email": email, "auth:password": PASSWORD }, "action:sign-in");
  await expect(page).toHaveURL(/\/en\/account$/);
  await page.context().close();
});

test("the account pages have no accessibility violations", async ({ browser }) => {
  const page = await freshPage(browser);
  const audit = async (label: string) => {
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    expect(results.violations, `${label}: ${results.violations.map((violation) => violation.id).join(", ")}`).toEqual([]);
  };
  for (const path of ["/en/account/sign-in", "/en/account/sign-up", "/en/account/forgot-password", "/el/account/sign-in"]) {
    await page.goto(path, { waitUntil: "networkidle" });
    await audit(path);
  }
  await signUpAndConfirm(page, uniqueEmail("a11y"));
  await audit("/en/account signed in");
  await page.context().close();
});
