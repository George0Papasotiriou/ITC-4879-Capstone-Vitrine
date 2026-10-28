/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * End-to-end tests for the shop's frame: the categories menu, the sign-in and sign-out icon, the account page's quick navigation and the Concierge bubble.
 */

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { fillAndSubmit, freshPage, PASSWORD, signUpAndConfirm, uniqueEmail } from "./support/accounts";

/** docs/adr/067. */

test.describe.configure({ timeout: 90_000 });

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const agent = (page: Page, id: string) => page.locator(`[data-agent-id="${id}"]`);

/** Opens a page and waits for it to hydrate; a page that has not after a while is loaded again. */
async function ready(page: Page, path: string) {
  await expect(async () => {
    await page.goto(path, { waitUntil: "domcontentloaded" });
    await page.locator("html[data-concierge-ready]").waitFor({ timeout: 15_000 });
  }).toPass({ timeout: 50_000 });
}

test("@smoke the categories menu opens from the header, shows one department at a time, and its links narrow a category to one kind", async ({ browser }) => {
  const page = await freshPage(browser, { country: "GR" });
  await ready(page, "/en");
  const trigger = agent(page, "nav:categories");
  const panel = agent(page, "menu:panel");
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  // Closed, the menu is not in the page at all: nothing hidden for the Concierge's page map to count.
  await expect(panel).toHaveCount(0);

  await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await expect(panel).toBeVisible();
  await expect(agent(page, "menu:tab-home")).toHaveAttribute("aria-selected", "true");
  await expect(agent(page, "menu:seating")).toBeVisible();
  // Only the open department's links are there.
  await expect(agent(page, "menu:wear-dress")).toHaveCount(0);

  await agent(page, "menu:tab-fashion").click();
  await expect(agent(page, "menu:tab-fashion")).toHaveAttribute("aria-selected", "true");
  await expect(agent(page, "menu:wear-dress")).toBeVisible();
  await expect(agent(page, "menu:seating")).toHaveCount(0);

  // The open menu passes the accessibility checks.
  const results = await new AxeBuilder({ page }).include('[data-agent-id="menu:panel"]').withTags(WCAG).analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);

  // A kind link: the category, narrowed to sofas, with the choice shown as a filter that can be removed.
  await agent(page, "menu:tab-home").click();
  await agent(page, "menu:seating-sofa").click();
  await expect(page).toHaveURL(/\/en\/c\/seating\?kind=SOFA$/);
  await expect(panel).toHaveCount(0);
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  const listing = agent(page, "listing:results");
  await expect(listing.locator('[data-agent-id^="product:"]').first()).toBeVisible();
  const chip = page.getByRole("link", { name: "Remove filter: Sofa" });
  await expect(chip).toBeVisible();
  await chip.click();
  // The local server can be slow to answer while it is still resizing the first page's photographs.
  await expect(page).toHaveURL(/\/en\/c\/seating$/, { timeout: 20_000 });
});

test("the categories menu works from the keyboard and Escape returns to its button", async ({ browser }) => {
  const page = await freshPage(browser, { country: "GR" });
  await ready(page, "/en/c/lighting");
  const trigger = agent(page, "nav:categories");
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(agent(page, "menu:panel")).toBeVisible();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");

  // Tab goes into the departments; the arrow keys move between them and show their columns.
  await page.keyboard.press("Tab");
  await expect(agent(page, "menu:tab-home")).toBeFocused();
  await page.keyboard.press(test.info().project.name === "mobile" ? "ArrowRight" : "ArrowDown");
  await expect(agent(page, "menu:tab-fashion")).toBeFocused();
  await expect(agent(page, "menu:tab-fashion")).toHaveAttribute("aria-selected", "true");
  await expect(agent(page, "menu:wear")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(agent(page, "menu:panel")).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");

  // A click outside the menu closes it too.
  await trigger.click();
  await expect(agent(page, "menu:panel")).toBeVisible();
  await page.mouse.click(5, page.viewportSize()!.height - 5);
  await expect(agent(page, "menu:panel")).toHaveCount(0);
});

test("on a wide screen the categories menu opens on hover, departments follow the pointer, and it closes when the pointer leaves", async ({ browser }, info) => {
  test.skip(info.project.name === "mobile", "Hover belongs to a mouse; phones open the menu with a tap.");
  const page = await freshPage(browser, { country: "GR" });
  await ready(page, "/en");
  await agent(page, "nav:categories").hover();
  await expect(agent(page, "menu:panel")).toBeVisible();
  await agent(page, "menu:tab-discover").hover();
  await expect(agent(page, "menu:tab-discover")).toHaveAttribute("aria-selected", "true");
  await expect(agent(page, "menu:fittingRoom")).toBeVisible();
  // The pointer goes back over the page beneath, well below the panel.
  await page.mouse.move(700, 880);
  await expect(agent(page, "menu:panel")).toHaveCount(0);
});

test("@smoke the header's sign-in icon returns to the same page, and the sign-out icon signs out from anywhere", async ({ browser }) => {
  const page = await freshPage(browser, { country: "GR" });
  const email = uniqueEmail("shell");
  await signUpAndConfirm(page, email);

  // Signed in: the header offers sign-out, on any page.
  await ready(page, "/en/c/lighting");
  await expect(agent(page, "nav:sign-in")).toHaveCount(0);
  await agent(page, "nav:sign-out").click();
  await expect(page).toHaveURL(/\/en$/);
  await expect(agent(page, "nav:sign-in")).toBeVisible();
  await expect(agent(page, "nav:sign-out")).toHaveCount(0);

  // Signed out on a filtered listing: the icon goes to sign-in and back to that exact listing.
  await ready(page, "/en/c/seating?kind=SOFA");
  await agent(page, "nav:sign-in").click();
  await expect(page).toHaveURL(/\/en\/account\/sign-in\?next=/);
  expect(new URL(page.url()).searchParams.get("next")).toBe("/en/c/seating?kind=SOFA");
  // On the sign-in page itself the icon does not point back to sign-in.
  await expect(agent(page, "nav:sign-in")).not.toHaveAttribute("href", /next=/);
  await fillAndSubmit(page, { "auth:email": email, "auth:password": PASSWORD }, "action:sign-in");
  await expect(page).toHaveURL(/\/en\/c\/seating\?kind=SOFA$/, { timeout: 20_000 });
  await expect(agent(page, "nav:sign-out")).toBeVisible();
});

test("the account page's quick navigation jumps to a section and marks the one being read", async ({ browser }, info) => {
  const page = await freshPage(browser, { country: "GR" });
  await signUpAndConfirm(page, uniqueEmail(`shell-nav-${info.project.name}`));
  const nav = agent(page, "account:nav");
  await expect(nav).toBeVisible();
  await expect(agent(page, "account:nav-orders")).toHaveAttribute("aria-current", "location");
  // A new customer has no staff desks and no price drops, so neither is offered.
  await expect(agent(page, "account:nav-desks")).toHaveCount(0);

  await agent(page, "account:nav-passkeys").click();
  await expect(page).toHaveURL(/#passkeys$/);
  await expect(agent(page, "account:nav-passkeys")).toHaveAttribute("aria-current", "location");
  await expect(agent(page, "account:nav-orders")).not.toHaveAttribute("aria-current", "location");
  // The heading has come to rest below the sticky header (and on phones, below the row of chips), not under it.
  await expect(async () => {
    const top = await page.locator("#passkeys").evaluate((element) => element.getBoundingClientRect().top);
    const below = await nav.evaluate((element) => {
      const header = document.querySelector("header")!.getBoundingClientRect().bottom;
      // On phones the navigation is a full-width row under the header; on wide screens a column beside the page.
      const row = element.getBoundingClientRect().width > window.innerWidth * 0.8;
      return row ? Math.max(header, element.getBoundingClientRect().bottom) : header;
    });
    expect(top).toBeGreaterThanOrEqual(below - 1);
    expect(top).toBeLessThan(page.viewportSize()!.height / 2);
  }).toPass({ timeout: 5_000 });
  // Focus moved with the jump, so the keyboard continues from the chosen section.
  await expect(page.locator("#passkeys")).toBeFocused();

  // Scrolling back to the top marks the first section again.
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(agent(page, "account:nav-orders")).toHaveAttribute("aria-current", "location");

  // The other settings pages are one click away.
  await expect(agent(page, "account:nav-preferences-page")).toHaveAttribute("href", "/en/account/preferences");

  const results = await new AxeBuilder({ page }).include('[data-agent-id="account:nav"]').withTags(WCAG).analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);
});

test("the Concierge bubble opens the Concierge on wide screens and stays off phones", async ({ browser }, info) => {
  const page = await freshPage(browser, { country: "GR" });
  await ready(page, "/en/c/lighting");
  const bubble = agent(page, "nav:concierge-bubble");
  if (info.project.name === "mobile") {
    // Phones already have the Concierge in the bar at the bottom of the screen.
    await expect(bubble).toBeHidden();
    return;
  }
  await expect(bubble).toBeVisible();
  // It sits in the bottom-left corner.
  const box = (await bubble.boundingBox())!;
  expect(box.x).toBeLessThan(100);
  expect(box.y + box.height).toBeGreaterThan(page.viewportSize()!.height - 100);

  await bubble.click();
  await expect(agent(page, "concierge:dock")).toBeVisible({ timeout: 15_000 });
  await expect(bubble).toHaveAttribute("aria-expanded", "true");
  await bubble.click();
  await expect(agent(page, "concierge:dock")).toHaveCount(0);
});

test("the Concierge bubble's hint shows once, after a while, and stays dismissed", async ({ browser }, info) => {
  test.skip(info.project.name === "mobile", "The bubble, and so its hint, is for wide screens.");
  const page = await freshPage(browser, { country: "GR" });
  await ready(page, "/en/c/lighting");
  const hint = agent(page, "concierge:bubble-hint");
  await expect(hint).toHaveCount(0);
  // It waits for the shopper to have looked around first.
  await expect(hint).toBeVisible({ timeout: 20_000 });
  await expect(hint).toContainText("Need help finding something? Ask me.");
  await agent(page, "concierge:bubble-hint-dismiss").click();
  await expect(hint).toHaveCount(0);
  expect(await page.evaluate(() => window.localStorage.getItem("vt-concierge-hint"))).toBe("seen");

  // Checkout, the account and the desks never show it: those are pages for getting something done.
  const quiet = await freshPage(browser, { country: "GR" });
  await ready(quiet, "/en/checkout");
  await quiet.waitForTimeout(10_500);
  await expect(agent(quiet, "concierge:bubble-hint")).toHaveCount(0);
});
