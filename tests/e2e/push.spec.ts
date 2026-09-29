/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * End-to-end tests for Web Push: turned on only when asked, topics kept, the device listed and removable.
 */

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { freshPage, signUpAndConfirm, uniqueEmail } from "./support/accounts";

/**
 * docs/adr/044. A test browser cannot subscribe to a real push service, so
 * the browser's side is a stand-in: a push manager that hands back a
 * subscription with an FCM address and RFC 8291's example keys. Everything
 * after that — the shop's routes, the database, the pages — is real. The
 * e2e server has VAPID keys made for the run and never posts to a push
 * service (the local stack logs pushes instead).
 */
async function standInPush(page: Page) {
  await page.addInitScript(() => {
    const endpoint = sessionStorage.getItem("e2e-push-endpoint") ?? `https://fcm.googleapis.com/fcm/send/e2e-${Math.random().toString(36).slice(2)}`;
    sessionStorage.setItem("e2e-push-endpoint", endpoint);
    const subscription = {
      endpoint,
      toJSON: () => ({ endpoint, expirationTime: null, keys: { p256dh: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4", auth: "BTBZMqHH6r4Tts7J_aSIgg" } }),
      unsubscribe: async () => {
        sessionStorage.removeItem("e2e-push-on");
        return true;
      },
    };
    const pushManager = {
      subscribe: async () => {
        sessionStorage.setItem("e2e-push-on", "1");
        return subscription;
      },
      getSubscription: async () => (sessionStorage.getItem("e2e-push-on") === "1" ? subscription : null),
    };
    const registration = { scope: "/", pushManager };
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { getRegistration: async () => registration, register: async () => registration, ready: Promise.resolve(registration), addEventListener: () => {}, controller: null },
    });
    (window as unknown as { PushManager: unknown }).PushManager = function PushManager() {};
    Object.defineProperty(Notification, "permission", { configurable: true, get: () => "default" });
    Notification.requestPermission = async () => "granted";
  });
}

test("@smoke notifications are turned on only when asked, keep their topics, and are listed with the shopper's data", async ({ browser }) => {
  const page = await freshPage(browser);
  await standInPush(page);
  await signUpAndConfirm(page, uniqueEmail("push"));

  await page.goto("/en/account/preferences", { waitUntil: "domcontentloaded" });
  const state = page.locator('[data-agent-id="prefs:push-state"]');
  await expect(state).toHaveText("Notifications are off on this device.");
  const axe = await new AxeBuilder({ page }).include('[data-agent-id="prefs:push"]').analyze();
  expect(axe.violations).toEqual([]);

  await page.locator('[data-agent-id="prefs:push-topic:prices"]').uncheck();
  await page.locator('[data-agent-id="action:push-on"]').click();
  await expect(state).toHaveText("Notifications are on for this device.");

  // Kept by the shop, with the topics chosen, and shown with everything else it keeps.
  await page.goto("/en/account/data", { waitUntil: "domcontentloaded" });
  const devices = page.locator('[data-agent-id="ledger:devices"]');
  await expect(devices).toContainText("orders · desk replies");
  await page.goto("/en/account/preferences", { waitUntil: "domcontentloaded" });
  await expect(state).toHaveText("Notifications are on for this device.");
  await expect(page.locator('[data-agent-id="prefs:push-topic:prices"]')).not.toBeChecked();

  await page.locator('[data-agent-id="action:push-off"]').click();
  await expect(state).toHaveText("Notifications are off on this device.");
  await page.goto("/en/account/data", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("No device gets the shop's notifications.")).toBeVisible();
  await page.context().close();
});

test("a device can be removed from the shopper's data, and a guest is asked to sign in", async ({ browser }) => {
  const page = await freshPage(browser);
  await standInPush(page);
  await page.goto("/en/account/preferences", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Sign in to get notifications about your orders on this device.")).toBeVisible();

  await signUpAndConfirm(page, uniqueEmail("push-remove"));
  await page.goto("/en/account/preferences", { waitUntil: "domcontentloaded" });
  await page.locator('[data-agent-id="action:push-on"]').click();
  await expect(page.locator('[data-agent-id="prefs:push-state"]')).toHaveText("Notifications are on for this device.");
  await page.goto("/en/account/data", { waitUntil: "domcontentloaded" });
  await page.locator('[data-agent-id^="ledger:forget-device:"]').first().click();
  await expect(page.getByText("No device gets the shop's notifications.")).toBeVisible();
  await page.context().close();
});
