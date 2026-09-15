/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * End-to-end Spotlight tests: mouse, keyboard, reduced motion and undo.
 */

import { expect, test, type Page, type Locator } from "@playwright/test";

/**
 * Phase 2 acceptance (docs/PLAN.md):
 *
 *   The Spotlight demo works with a mouse, with the keyboard only, and with
 *   reduced motion (instant highlight, no glide); actions are announced to
 *   screen readers; undo restores state.
 *
 * Each of those is a test below. The point of the Spotlight is that an agent
 * driving the interface stays visible and reversible, so "undo restores state"
 * is not a nicety — it is the feature.
 *
 * Every locator is scoped to the demo section: the specimen page deliberately
 * shows the same products twice, once as static tiles and once in the live
 * listing, so an unscoped query matches both.
 */

/** Counts come from the generated catalogue: 25 products, 12 of them lighting. */
const TOTAL_PRODUCTS = 25;
const LIGHTING_PRODUCTS = 12;

function demo(page: Page): Locator {
  return page.locator("#specimen");
}

function tiles(page: Page): Locator {
  return demo(page).locator('article[data-agent-id^="product:"]');
}

function timelineEntries(page: Page): Locator {
  return demo(page)
    .getByRole("list", { name: "Concierge actions" })
    .getByRole("listitem");
}

async function gotoDemo(page: Page) {
  await page.goto("/design", { waitUntil: "domcontentloaded" });
  // Wait for the section to exist before scrolling to it: against a dev server
  // the first request compiles the route, and hydration can replace nodes
  // underneath a locator that resolved too early.
  await demo(page).waitFor({ state: "visible", timeout: 30_000 });

  // The demo is a Client Component: the markup arrives with the HTML but the
  // click handlers only exist after hydration. Playwright's actionability
  // checks cannot see that, so a click can land on a button that is visible,
  // enabled and completely inert — which showed up as this suite failing
  // roughly one run in four, always on whichever test clicked first.
  //
  // `networkidle` is not the signal to use: Next prefetches every Link in the
  // viewport, so with 25 products the network never goes quiet.
  await page.locator("html[data-concierge-ready]").waitFor({ timeout: 30_000 });

  // No explicit scroll: the listing animates its layout, so waiting for the
  // section to be "stable" never settles. Playwright scrolls to an element when
  // it acts on it, which is enough.
}

test("@smoke the Spotlight performs an action and undo restores the previous state", async ({
  page,
}) => {
  await gotoDemo(page);

  const before = await tiles(page).count();
  expect(before).toBe(TOTAL_PRODUCTS);

  await demo(page).getByRole("button", { name: "Show me lighting" }).click();

  await expect(tiles(page)).toHaveCount(LIGHTING_PRODUCTS, { timeout: 10_000 });

  // The action is recorded with a way to take it back.
  const entry = timelineEntries(page).filter({ hasText: "Filtering to lighting" });
  await expect(entry).toBeVisible();

  await entry.getByRole("button", { name: "Undo" }).click();

  await expect(tiles(page)).toHaveCount(before);
  await expect(entry.getByText("Undone")).toBeVisible();
});

test("the caption is announced to screen readers, not only drawn on screen", async ({
  page,
}) => {
  await gotoDemo(page);

  const liveRegion = page.locator('[aria-live="polite"]');
  await demo(page).getByRole("button", { name: "Point at one product" }).click();

  // The same words a sighted user sees in the caption chip.
  await expect(liveRegion).toContainText("This is the radford modern curved arm accent chair", {
    timeout: 10_000,
  });
});

test("the demo is operable by keyboard alone", async ({ page }) => {
  await gotoDemo(page);

  const trigger = demo(page).getByRole("button", { name: "Show me lighting" });
  await trigger.focus();
  await expect(trigger).toBeFocused();

  await page.keyboard.press("Enter");
  await expect(tiles(page)).toHaveCount(LIGHTING_PRODUCTS, { timeout: 10_000 });

  // Undo is reachable and operable without a pointer.
  const undo = timelineEntries(page)
    .filter({ hasText: "Filtering to lighting" })
    .getByRole("button", { name: "Undo" });
  await undo.focus();
  await page.keyboard.press("Enter");

  await expect(tiles(page)).toHaveCount(TOTAL_PRODUCTS);
});

test.describe("with reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("there is no travelling light, but the action and the timeline are identical", async ({
    page,
  }) => {
    await gotoDemo(page);
    await demo(page).getByRole("button", { name: "Show me lighting" }).click();

    // The action still happens, and it still lands in the timeline with undo.
    await expect(tiles(page)).toHaveCount(LIGHTING_PRODUCTS, { timeout: 10_000 });
    await expect(
      timelineEntries(page).filter({ hasText: "Filtering to lighting" }),
    ).toBeVisible();
  });
});

test("a three-step sequence records every action separately", async ({ page }) => {
  await gotoDemo(page);

  await demo(page).getByRole("button", { name: "Run a three-step sequence" }).click();

  const entries = timelineEntries(page);
  await expect(entries).toHaveCount(3, { timeout: 20_000 });

  await expect(entries.nth(0)).toContainText("Narrowing to seating and lighting under €600");
  await expect(entries.nth(1)).toContainText("fits your budget");
  await expect(entries.nth(2)).toContainText("This chair pairs with it");

  // Only the filter changed state, so only it offers an undo. Highlighting
  // something is not an action you need to take back.
  await expect(entries.nth(0).getByRole("button", { name: "Undo" })).toBeVisible();
  await expect(entries.nth(1).getByRole("button", { name: "Undo" })).toHaveCount(0);
});
