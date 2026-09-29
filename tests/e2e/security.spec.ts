/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * End-to-end tests for the security headers: a fresh nonce per view, and no page the policy breaks.
 */

import { expect, test, type Page } from "@playwright/test";

import { freshPage } from "./support/accounts";

/**
 * docs/adr/046. The policy is enforced on the production build these tests
 * run against, so a script, frame or connection it wrongly blocks shows up
 * here as a violation the browser reported, before a shopper meets it.
 */

type Violation = { directive: string; blocked: string; page: string };

async function watchViolations(page: Page) {
  await page.addInitScript(() => {
    const seen: Violation[] = [];
    (window as unknown as { __csp: Violation[] }).__csp = seen;
    document.addEventListener("securitypolicyviolation", (event) => seen.push({ directive: event.effectiveDirective, blocked: event.blockedURI, page: location.pathname }));
  });
}

const violations = (page: Page) => page.evaluate(() => (window as unknown as { __csp: Violation[] }).__csp);

const PAGES = [
  "/en",
  "/el",
  "/en/c",
  "/en/c/lighting",
  "/en/p/faux-wood-table-lamp-b07mbfd87n",
  "/en/search?q=oak+table",
  "/en/cart",
  "/en/showcase",
  "/en/stylist",
  "/en/snap",
  "/en/fitting-room",
  "/en/support",
  "/en/account/sign-in",
  "/en/account/preferences",
  "/en/shipping",
];

test("@smoke every page carries a policy with a nonce made for that view, and the headers every response has", async ({ page }) => {
  const first = await page.goto("/en", { waitUntil: "domcontentloaded" });
  const second = await page.goto("/en", { waitUntil: "domcontentloaded" });
  const policy = first!.headers()["content-security-policy"]!;
  expect(policy).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]{24}' 'strict-dynamic'/);
  expect(policy).toContain("object-src 'none'");
  expect(policy).toContain("frame-ancestors 'none'");
  const nonceOf = (value: string) => /'nonce-([^']+)'/.exec(value)![1];
  expect(nonceOf(second!.headers()["content-security-policy"]!)).not.toBe(nonceOf(policy));
  expect(first!.headers()).toMatchObject({ "x-content-type-options": "nosniff", "referrer-policy": "strict-origin-when-cross-origin", "x-frame-options": "DENY" });
  expect(first!.headers()["permissions-policy"]).toContain("microphone=(self)");

  // The page's own inline script carries the nonce (the browser hides the attribute but keeps the property).
  expect(await page.evaluate(() => [...document.querySelectorAll("script:not([src])")].every((script) => (script as HTMLScriptElement).nonce !== "" || (script as HTMLScriptElement).type === "application/ld+json"))).toBe(true);

  // API answers are not pages: no policy, but the same base headers.
  const api = await page.request.get("/api/health");
  expect(api.headers()["content-security-policy"]).toBeUndefined();
  expect(api.headers()["x-content-type-options"]).toBe("nosniff");
});

test("the shop's pages run under the policy without a single violation", async ({ browser }) => {
  test.setTimeout(180_000);
  const page = await freshPage(browser);
  await watchViolations(page);
  const found: Violation[] = [];
  for (const path of PAGES) {
    await page.goto(path, { waitUntil: "load" });
    // Let late scripts (the Concierge engine, model-viewer, workers) start.
    await page.waitForTimeout(400);
    found.push(...(await violations(page)));
  }
  expect(found).toEqual([]);
  await page.context().close();
});

test("the Concierge, the 3D view and the room planner work under the policy", async ({ browser }) => {
  test.setTimeout(120_000);
  const page = await freshPage(browser);
  await watchViolations(page);

  await page.goto("/en", { waitUntil: "load" });
  // As concierge.spec opens it: once, after hydration, so the engine loads under the policy.
  await page.locator("html[data-concierge-ready]").waitFor({ timeout: 30_000 });
  await page.locator('[data-agent-id="nav:concierge-panel"]:visible, [data-agent-id="nav:concierge"]:visible').first().click();
  await expect(page.locator('[data-agent-id="concierge:dock"]')).toBeVisible({ timeout: 15_000 });
  await page.locator('[data-agent-id="concierge:input"]').fill("oak coffee table");
  await page.locator('[data-agent-id="concierge:send"]').click();
  await expect(page.locator('[data-agent-id="concierge:dock"]')).toContainText(/table/i, { timeout: 30_000 });
  expect(await violations(page)).toEqual([]);

  // The 3D view: model-viewer, three.js and the scan's textures, loaded all the way.
  await page.goto("/en/p/faux-wood-table-lamp-b07mbfd87n?view=model", { waitUntil: "load" });
  const viewer = page.locator('[data-agent-id="model:viewer"]');
  await expect(viewer).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => viewer.evaluate((node) => (node as HTMLElement & { loaded?: boolean }).loaded === true), { timeout: 30_000 }).toBe(true);
  expect(await violations(page)).toEqual([]);

  await page.goto("/en/room?product=canova-3-seater-maxi-b07g2h3l4l", { waitUntil: "load" });
  await page.getByRole("button", { name: "Try the sample room" }).click();
  await expect(page.locator('canvas[data-agent-id="room:stage"]')).toBeVisible();
  expect(await violations(page)).toEqual([]);
  await page.context().close();
});
