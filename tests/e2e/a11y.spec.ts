/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * End-to-end accessibility checks with axe.
 */

import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * Accessibility floor (docs/PLAN.md 4.7): WCAG 2.2 AA.
 *
 * Visible focus everywhere, targets of at least 24px (44px on touch), full
 * keyboard support, reviewed alt text, `lang` per locale, reduced motion
 * honoured, and no meaning carried by colour alone.
 *
 * axe catches the mechanical half of that. The half it cannot check — whether
 * the caption actually describes the action, whether focus order makes sense —
 * is covered by the Spotlight tests and by /design-critique.
 */

const PAGES = [
  { name: "home", path: "/" },
  { name: "design specimen", path: "/design" },
  { name: "category listing", path: "/en/c/lighting" },
  { name: "filtered listing", path: "/en/c/seating?color=grey&sort=price-asc" },
  { name: "whole collection", path: "/el/c" },
  { name: "product page", path: "/en/p/westview-extra-deep-down-filled-leather-sofa-couch-b082vlyqwx" },
  { name: "sold-out product page", path: "/el/p/classic-plank-top-console-table-with-large-drawer-b07mm5h3hx" },
  { name: "search results", path: "/en/search?q=lamp" },
  { name: "empty search", path: "/el/search?q=xylophone" },
  { name: "credits", path: "/en/credits" },
  { name: "budget stylist results", path: "/en/stylist?template=reading-corner&budget=1500&swap=0:lamp" },
  { name: "budget stylist, Greek", path: "/el/stylist" },
  { name: "this or that", path: "/en/taste" },
  { name: "account privacy", path: "/el/account" },
  { name: "room, choose a piece", path: "/en/room" },
  { name: "room, Greek", path: "/el/room?product=canova-3-seater-maxi-b07g2h3l4l" },
];

for (const page_ of PAGES) {
  test(`@smoke ${page_.name} has no accessibility violations`, async ({ page }) => {
    await page.goto(page_.path, { waitUntil: "domcontentloaded" });
    // Not `networkidle`: Next keeps prefetching links in the viewport.
    await page.waitForLoadState("load");

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();

    // Report the rule and the element, so a failure says what to fix rather
    // than just that something is wrong.
    const summary = results.violations.map((violation) => ({
      rule: violation.id,
      impact: violation.impact,
      help: violation.help,
      nodes: violation.nodes.map((node) => node.target.join(" ")),
    }));

    expect(summary, JSON.stringify(summary, null, 2)).toEqual([]);
  });
}

test("the Spotlight overlay does not trap or steal focus", async ({ page }) => {
  await page.goto("/design", { waitUntil: "domcontentloaded" });

  const demo = page.locator("#specimen");
  await demo.waitFor({ state: "visible" });
  // Wait for hydration before clicking (see spotlight.spec.ts).
  await page.locator("html[data-concierge-ready]").waitFor({ timeout: 30_000 });

  const trigger = demo.getByRole("button", { name: "Show me lighting" });
  await trigger.focus();
  await page.keyboard.press("Enter");

  // While the light is travelling the overlay covers the page, but it is
  // pointer-events:none and aria-hidden, so focus stays where the user put it.
  await expect(trigger).toBeFocused();

  await expect(
    demo.getByRole("list", { name: "Concierge actions" }).getByRole("listitem"),
  ).toHaveCount(1, { timeout: 10_000 });

  // And tabbing still moves through the real interface afterwards.
  await page.keyboard.press("Tab");
  const focusedTag = await page.evaluate(() => document.activeElement?.tagName ?? "");
  expect(focusedTag).not.toBe("BODY");
});

test("every interactive control on the specimen has an accessible name", async ({
  page,
}) => {
  await page.goto("/design", { waitUntil: "domcontentloaded" });

  const unnamed = await page.evaluate(() => {
    const controls = [...document.querySelectorAll("button, a[href], input, select")];
    return controls
      // Controls hidden from assistive technology are not part of the
      // interface a screen reader presents, so they need no name. Radix renders
      // such elements (aria-hidden, tabindex -1) purely so custom selects and
      // radios still submit with a native form.
      .filter((element) => element.closest("[aria-hidden=\"true\"]") === null)
      .filter((element) => {
        const label =
          element.getAttribute("aria-label") ??
          element.getAttribute("title") ??
          element.textContent?.trim() ??
          "";
        const labelledBy = element.getAttribute("aria-labelledby");
        const associated =
          element.id !== ""
            ? document.querySelector(`label[for="${CSS.escape(element.id)}"]`)
            : null;
        return label === "" && labelledBy === null && associated === null;
      })
      .map((element) => element.outerHTML.slice(0, 120));
  });

  expect(unnamed, `controls without an accessible name:\n${unnamed.join("\n")}`).toEqual(
    [],
  );
});
