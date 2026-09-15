/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * End-to-end keyboard and focus behaviour of the UI primitives.
 */

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * The interactive primitives (docs/PLAN.md Phase 2, step 3; 4.7).
 *
 * These are the behaviours that are easy to break and invisible in a
 * screenshot: where focus goes when a dialog opens and closes, whether Esc
 * works, whether a radio group moves with the arrow keys, and whether an error
 * toast stays put. Each is a keyboard user's or a screen reader user's whole
 * experience of the component.
 */

async function gotoSpecimen(page: Page) {
  // Not "load": that waits for every one of the specimen's ~50 product images,
  // and one slow image once stalled this for the full 30s. Interaction needs
  // hydration, not pixels, and the marker below is the signal for that.
  await page.goto("/en/design", { waitUntil: "domcontentloaded" });
  await page.locator("html[data-concierge-ready]").waitFor({ timeout: 30_000 });
}

test("a dialog traps focus, closes on Esc, and returns focus to its trigger", async ({ page }) => {
  await gotoSpecimen(page);

  const trigger = page.getByRole("button", { name: "Remove from cart" });
  await trigger.focus();
  await page.keyboard.press("Enter");

  const dialog = page.getByRole("dialog", { name: "Remove the arc floor lamp?" });
  await expect(dialog).toBeVisible();

  // Focus is inside the dialog, and tabbing cannot escape it.
  for (let i = 0; i < 6; i += 1) {
    await page.keyboard.press("Tab");
    const inside = await dialog.evaluate((node) => node.contains(document.activeElement));
    expect(inside, `focus escaped the dialog after ${i + 1} tabs`).toBe(true);
  }

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("the dialog has an accessible name and description and passes axe", async ({ page }) => {
  await gotoSpecimen(page);
  await page.getByRole("button", { name: "Remove from cart" }).click();

  const dialog = page.getByRole("dialog", { name: "Remove the arc floor lamp?" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAccessibleDescription(/It will leave your cart/);

  const results = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
  expect(results.violations.map((v) => v.id)).toEqual([]);
});

test("the sheet opens as a labelled dialog and closes with its close button", async ({ page }) => {
  await gotoSpecimen(page);
  await page.getByRole("button", { name: "Open the Concierge dock" }).click();

  const sheet = page.getByRole("dialog", { name: "Concierge" });
  await expect(sheet).toBeVisible();

  await sheet.getByRole("button", { name: "Close" }).click();
  await expect(sheet).toBeHidden();
});

test("the select is operable with the keyboard alone", async ({ page }) => {
  await gotoSpecimen(page);

  const trigger = page.getByRole("combobox", { name: "Sort by" });
  await expect(trigger).toHaveText(/Most relevant/);

  await trigger.focus();
  await page.keyboard.press("Enter");

  // Wait for the menu to put focus on the current option before navigating. A
  // test can press keys within milliseconds of opening; a person cannot, and a
  // key pressed before the menu has taken focus goes nowhere.
  await expect(page.getByRole("option", { name: "Most relevant" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("option", { name: "Price, low to high" })).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(trigger).toHaveText(/Price, low to high/);
});

test("a radio group is one tab stop; arrow keys move and select, skipping disabled options", async ({
  page,
}) => {
  await gotoSpecimen(page);

  const standard = page.getByRole("radio", { name: /Standard, free/ });
  const express = page.getByRole("radio", { name: /Express/ });
  const pickup = page.getByRole("radio", { name: /Collect in Athens/ });

  await expect(standard).toBeChecked();
  await expect(pickup).toBeDisabled();

  // Arrive the way a keyboard user does — with Tab — not with a scripted
  // focus(). The two took different code paths in Radix, and only the Tab path
  // exposed the bug where arrows moved focus without selecting.
  await page.getByRole("combobox", { name: "Sort by" }).focus();
  for (let i = 0; i < 12 && !(await standard.evaluate((el) => el === document.activeElement)); i += 1) {
    await page.keyboard.press("Tab");
  }
  await expect(standard).toBeFocused();

  await page.keyboard.press("ArrowDown");
  await expect(express).toBeFocused();
  await expect(express).toBeChecked();
  await expect(standard).not.toBeChecked();

  // Down again skips the disabled option and wraps to the first.
  await page.keyboard.press("ArrowDown");
  await expect(pickup).not.toBeFocused();
  await expect(standard).toBeFocused();
  await expect(standard).toBeChecked();

  // One tab stop: Tab leaves the group rather than visiting each option.
  await page.keyboard.press("Tab");
  await expect(express).not.toBeFocused();
  await expect(standard).not.toBeFocused();
});

test("a checkbox toggles from its label, not only from the box", async ({ page }) => {
  await gotoSpecimen(page);

  const box = page.getByRole("checkbox", { name: "Let the Concierge remember my sizes" });
  await expect(box).not.toBeChecked();
  await page.getByText("Let the Concierge remember my sizes").click();
  await expect(box).toBeChecked();
});

test("tabs switch with the arrow keys and a disabled tab cannot be selected", async ({ page }) => {
  await gotoSpecimen(page);

  const photos = page.getByRole("tab", { name: "Photos" });
  const spin = page.getByRole("tab", { name: "360°" });

  await photos.focus();
  await page.keyboard.press("ArrowRight");
  await expect(spin).toBeFocused();
  await expect(spin).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel")).toContainText("arrow keys to turn it");

  await expect(page.getByRole("tab", { name: "In my room" })).toBeDisabled();
});

test("a tooltip appears on keyboard focus, not only on hover", async ({ page }) => {
  await gotoSpecimen(page);

  await page.getByRole("button", { name: "What does the 3D mark mean?" }).focus();
  await expect(page.getByRole("tooltip")).toContainText("Only available for products with a 3D model");
});

test("a confirmation toast is announced; an error toast stays until dismissed", async ({ page }) => {
  await gotoSpecimen(page);

  // Scope to toasts: the specimen also shows a static "That card was declined"
  // error state, which an unscoped text query would match instead.
  const toasts = page.locator("ol li[data-state]");

  await page.getByRole("button", { name: "Show a confirmation" }).click();
  await expect(toasts.filter({ hasText: "Added to cart" })).toBeVisible();

  await page.getByRole("button", { name: "Show an error" }).click();
  const error = toasts.filter({ hasText: "That card was declined" });
  await expect(error).toBeVisible();

  // Longer than a confirmation's five-second lifetime.
  await page.waitForTimeout(6_000);
  await expect(toasts.filter({ hasText: "Added to cart" })).toHaveCount(0);
  await expect(error).toBeVisible();

  await error.getByRole("button", { name: "Dismiss" }).click();
  await expect(error).toHaveCount(0);
});
