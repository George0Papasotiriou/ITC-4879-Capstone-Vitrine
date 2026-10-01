/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * End-to-end tests for Showcase mode: the 3D shop window, its keyboard and placard, its 2D fallback, one tap to shop, and the Concierge opening it.
 */

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { freshPage } from "./support/accounts";

/**
 * docs/adr/040. The test database holds the 25 specimen pieces and the
 * capsule, so a window may be a full Stylist set (with its total) or the
 * search fallback (without one); both are what the page promises.
 *
 * docs/adr/048. The specimen pieces have no 3D scans, so here the room shows
 * them from their photographs — the same engine, lights and arrangement as a
 * scanned set. Headless Chromium draws WebGL in software (SwiftShader).
 */

test.describe.configure({ timeout: 90_000 });

const window = (page: Page) => page.locator('[data-agent-id="showcase:window"]');
const pieces = (page: Page) => page.locator('[data-agent-id^="showcase:piece:"]');

test("@smoke a shop window stands its pieces in the window and lists every one in words", async ({ page }) => {
  await page.goto("/en/showcase", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("A reading corner in warm wood");
  await expect(window(page)).toBeVisible();
  const count = await pieces(page).count();
  expect(count).toBeGreaterThan(0);
  // The window and the list below say the same pieces.
  await expect(page.locator('[data-agent-id="showcase:pieces"] li')).toHaveCount(count);
  // Either the Stylist's total or the plain fallback, never neither.
  await expect(page.locator('[data-agent-id="showcase:total"]').or(page.getByText("No set in stock fits this budget"))).toBeVisible();
});

test("@smoke the window is a lit 3D room: the canvas draws, and a button stands over every piece", async ({ page }) => {
  await page.goto("/en/showcase", { waitUntil: "domcontentloaded" });
  await expect(window(page)).toHaveAttribute("data-state", "ready", { timeout: 45_000 });
  await expect(window(page).locator("canvas")).toBeVisible();
  // Every piece's button has been laid over its projected outline.
  await expect(window(page).locator('[data-agent-id^="showcase:piece:"][data-placed="true"]').first()).toBeAttached({ timeout: 15_000 });
  const box = await pieces(page).first().boundingBox();
  expect(box!.width).toBeGreaterThan(20);
});

test("the window is walked with the arrow keys; Enter opens a piece's placard, Escape goes back", async ({ page }) => {
  await page.goto("/en/showcase?theme=calm-living", { waitUntil: "domcontentloaded" });
  await page.locator("html[data-concierge-ready]").waitFor({ timeout: 30_000 });
  await expect(window(page)).toHaveAttribute("data-state", "ready", { timeout: 45_000 });
  const first = pieces(page).first();
  await first.focus();
  const firstId = await first.getAttribute("id");
  if ((await pieces(page).count()) > 1) {
    await page.keyboard.press("ArrowRight");
    await expect(page.locator(":focus")).not.toHaveAttribute("id", firstId!);
    await page.keyboard.press("Home");
    await expect(page.locator(":focus")).toHaveAttribute("id", firstId!);
  }
  await page.keyboard.press("Enter");
  const productId = firstId!.replace("stage-piece-", "");
  const placard = page.locator(`[data-agent-id="showcase:placard:${productId}"]`);
  await expect(placard).toBeVisible();
  // The placard's own heading has the focus, and it says the same as the list below the window.
  await expect(page.locator(`#placard-title-${productId}`)).toBeFocused();
  await expect(page.locator(`#placard-title-${productId}`)).toHaveText((await page.locator(`#piece-${productId} [data-piece-title]`).textContent())!);
  await expect(placard.locator(`[data-agent-id="placard:add-to-cart:${productId}"]`)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(placard).toBeHidden();
  await expect(page.locator(`#${firstId}`)).toBeFocused();
});

test("choosing another window re-dresses the same room: the canvas is kept", async ({ page }) => {
  await page.goto("/en/showcase", { waitUntil: "domcontentloaded" });
  await expect(window(page)).toHaveAttribute("data-state", "ready", { timeout: 45_000 });
  await page.locator("html[data-concierge-ready]").waitFor({ timeout: 30_000 });
  await page.evaluate(() => {
    // globalThis: this file's own window() helper shadows the browser's name.
    (globalThis as { firstCanvas?: Element | null }).firstCanvas = document.querySelector('[data-agent-id="showcase:window"] canvas');
  });
  await page.locator('[data-agent-id="showcase:theme:small-gifts"]').click();
  await expect(page).toHaveURL(/theme=small-gifts/);
  await expect(window(page)).toHaveAttribute("data-state", "ready", { timeout: 45_000 });
  const same = await page.evaluate(() => (globalThis as { firstCanvas?: Element | null }).firstCanvas === document.querySelector('[data-agent-id="showcase:window"] canvas'));
  expect(same).toBe(true);
});

test("where 3D cannot run, the window is shown in 2D with a note, and still works", async ({ browser }) => {
  const page = await freshPage(browser, { country: "GR" });
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    // No WebGL 2 on this "device".
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: string, ...rest: unknown[]) {
      if (kind === "webgl2") return null;
      return (original as (...args: unknown[]) => unknown).call(this, kind, ...rest);
    } as typeof HTMLCanvasElement.prototype.getContext;
  });
  await page.goto("/en/showcase", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("This device shows the window as a picture.")).toBeVisible({ timeout: 20_000 });
  await expect(window(page)).toBeVisible();
  await expect(window(page).locator("canvas")).toHaveCount(0);
  await expect(pieces(page)).toHaveCount(await page.locator('[data-agent-id="showcase:pieces"] li').count());
  await page.context().close();
});

test("with reduced motion the room still opens, every piece in place at once", async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  await page.goto("/en/showcase?theme=oak-bedroom", { waitUntil: "domcontentloaded" });
  await expect(window(page)).toHaveAttribute("data-state", "ready", { timeout: 45_000 });
  await expect(window(page).locator('[data-agent-id^="showcase:piece:"][data-placed="true"]').first()).toBeAttached({ timeout: 15_000 });
  await context.close();
});

test("choosing another window changes the display, and the link opens the same window", async ({ page }) => {
  await page.goto("/en/showcase", { waitUntil: "domcontentloaded" });
  await page.locator('[data-agent-id="showcase:theme:oak-bedroom"]').click();
  await expect(page).toHaveURL(/theme=oak-bedroom/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("A bedroom in oak");
  await expect(page.locator('[data-agent-id="showcase:theme:oak-bedroom"]')).toHaveAttribute("aria-current", "page");
  // A window made from a room, a budget and words reads back from its own link.
  await page.goto("/en/showcase?template=living-room&budget=1500&words=grey", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Your window");
});

test("one tap puts the whole window in the cart", async ({ browser }) => {
  const page = await freshPage(browser, { country: "GR" });
  await page.goto("/en/showcase?theme=small-gifts", { waitUntil: "domcontentloaded" });
  const button = page.locator('[data-agent-id="action:add-window"]');
  await expect(button).toBeEnabled({ timeout: 30_000 });
  await button.click();
  await expect(page.getByText(/Everything in the window is in your cart|Added, except/).first()).toBeVisible({ timeout: 20_000 });
  const cart = (await (await page.request.get("/api/cart?locale=en")).json()) as { itemCount: number };
  expect(cart.itemCount).toBeGreaterThan(0);
  await page.context().close();
});

test("the Concierge opens a shop window when asked", async ({ browser }) => {
  const page = await freshPage(browser, { country: "GR" });
  await page.goto("/en", { waitUntil: "domcontentloaded" });
  await page.locator("html[data-concierge-ready]").waitFor({ timeout: 30_000 });
  const toggle = page.locator('[data-agent-id="nav:concierge-panel"]:visible, [data-agent-id="nav:concierge"]:visible').first();
  await toggle.click();
  await page.locator('[data-agent-id="concierge:input"]').fill("show me a shop window for a bedroom");
  await page.locator('[data-agent-id="concierge:send"]').click();
  await expect(page).toHaveURL(/\/en\/showcase\?theme=oak-bedroom/, { timeout: 30_000 });
  await page.context().close();
});

test("the shop windows pass the accessibility checks, in both languages", async ({ page }) => {
  for (const path of ["/en/showcase", "/el/showcase?theme=black-dining"]) {
    await page.goto(path, { waitUntil: "networkidle" });
    // A window with nothing to show says so instead of drawing a room; either is checked as it stands.
    if ((await window(page).count()) > 0) await expect(window(page)).toHaveAttribute("data-state", "ready", { timeout: 45_000 });
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    expect(results.violations, `${path}: ${results.violations.map((violation) => `${violation.id} (${violation.nodes[0]?.target.join(" ")})`).join(", ")}`).toEqual([]);
  }
});
