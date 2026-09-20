/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * End-to-end check that no English interface text appears on Greek pages.
 */

import { expect, test } from "@playwright/test";

// Playwright loads tests as native ES modules, which require an import
// attribute for JSON.
import el from "../../messages/el.json" with { type: "json" };
import en from "../../messages/en.json" with { type: "json" };

/**
 * No English interface text on the Greek storefront.
 *
 * The catalogue parity unit test proves every key has a Greek translation; it
 * cannot prove a component actually *uses* the catalogue. This test closes that
 * gap from the outside: it takes every English interface string that differs
 * from its Greek counterpart and checks that none of them appears on a Greek
 * page.
 *
 * Only multi-word strings are checked. Product names and brands come from the
 * dataset in English in both locales ("Ravenna Home"), and a single word such as
 * "Home" would match them; a phrase like "No reviews yet" will not.
 */

type Tree = { [key: string]: string | Tree };

function leaves(tree: Tree, prefix = ""): [string, string][] {
  return Object.entries(tree).flatMap(([key, value]) => {
    const path = prefix === "" ? key : `${prefix}.${key}`;
    return typeof value === "string" ? [[path, value] as [string, string]] : leaves(value, path);
  });
}

const greek = new Map(leaves(el as Tree));

/** English phrases that must never appear once the page is in Greek. */
const LEAKS = leaves(en as Tree)
  .filter(([key, text]) => greek.get(key) !== text)
  // Drop ICU syntax, keep the literal words around it.
  .map(([key, text]) => [key, text.replace(/\{[^{}]*\}/g, " ").split(/\s{2,}|[{}]/)[0]?.trim() ?? ""] as const)
  .filter(([, phrase]) => phrase.includes(" ") && phrase.length >= 8);

const GREEK_PAGES = [
  "/el",
  "/el/c/lighting",
  "/el/c/seating",
  "/el/p/radford-modern-curved-arm-accent-chair-b07f2x8k62",
  "/el/cart",
  "/el/account",
  "/el/search",
  "/el/search?q=kanapes",
  "/el/c",
  "/el/c/seating?color=grey&stock=1",
  "/el/credits",
  "/el/stylist?template=reading-corner&budget=1500&swap=0:lamp",
  "/el/taste",
  "/el/room?product=canova-3-seater-maxi-b07g2h3l4l",
  "/el/shipping",
  "/el/offline",
  "/el/does-not-exist",
];

for (const path of GREEK_PAGES) {
  test(`@smoke ${path} shows no English interface text`, async ({ page }) => {
    // Server-rendered text is present at DOMContentLoaded; images are irrelevant.
    await page.goto(path, { waitUntil: "domcontentloaded" });

    await expect(page.locator("html")).toHaveAttribute("lang", "el");

    const body = await page.locator("body").innerText();
    const leaked = LEAKS.filter(([, phrase]) => body.includes(phrase)).map(
      ([key, phrase]) => `${key}: "${phrase}"`,
    );

    expect(leaked, `English strings on ${path}`).toEqual([]);
  });
}

test("the language switch lands on the same page in the other language", async ({ page }) => {
  await page.goto("/el/c/lighting", { waitUntil: "domcontentloaded" });

  await page.getByRole("link", { name: "English" }).click();
  // A whole page load, which under a full parallel run can take longer than the
  // default five seconds; the assertion is about where it lands, not how fast.
  await expect(page).toHaveURL(/\/en\/c\/lighting$/, { timeout: 15_000 });
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
});

test("an unprefixed path redirects to the default locale rather than failing", async ({
  request,
}) => {
  // Regression guard for ADR-006: before the proxy fix, /cart returned a 500.
  for (const path of ["/cart", "/c/lighting", "/search"]) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status(), path).toBe(307);
    expect(response.headers()["location"], path).toMatch(/^\/en\//);
  }
});

test("@smoke every internal link on the Greek storefront stays in Greek", async ({ page }) => {
  // Regression guard: ProductTile and ButtonLink once used `next/link`, which
  // drops the locale, so a Greek shopper clicking a product landed in English.
  for (const path of ["/el", "/el/c/lighting", "/el/p/radford-modern-curved-arm-accent-chair-b07f2x8k62", "/el/cart"]) {
    await page.goto(path, { waitUntil: "domcontentloaded" });

    const hrefs = await page
      .locator('a[href^="/"]')
      .evaluateAll((anchors) => anchors.map((a) => a.getAttribute("href") ?? ""));

    // The language switch is the one link that is meant to leave Greek.
    const leaving = hrefs.filter(
      (href) => !href.startsWith("/el") && !/^\/en(\/|$)/.test(href) && !href.startsWith("/_next"),
    );
    const toEnglish = hrefs.filter((href) => /^\/en(\/|$)/.test(href));

    expect(leaving, `unprefixed links on ${path}`).toEqual([]);
    expect(toEnglish.length, `links to English on ${path} (only the language switch)`).toBeLessThanOrEqual(1);
  }
});

test("clicking a product on the Greek storefront opens the Greek product page", async ({ page }) => {
  await page.goto("/el/c/lighting", { waitUntil: "domcontentloaded" });
  await page.locator('article[data-agent-id^="product:"] a').first().click();
  await expect(page).toHaveURL(/\/el\/p\//);
  await expect(page.locator("html")).toHaveAttribute("lang", "el");
});

test("no page gives two product tiles the same view-transition name", async ({ page }) => {
  // A duplicate name makes the browser abandon the whole transition, silently.
  // React only applies the CSS name mid-transition, so the tile mirrors it in
  // `data-transition-name` for this check (an earlier version of this test read
  // computed styles at rest, found no names at all, and could never fail).
  for (const path of ["/en", "/en/c", "/en/c/lighting", "/en/search?q=lamp", "/en/p/radford-modern-curved-arm-accent-chair-b07f2x8k62"]) {
    await page.goto(path, { waitUntil: "domcontentloaded" });
    const names = await page
      .locator("[data-transition-name]")
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-transition-name") ?? ""));

    expect(names.length, `${path} should name its tiles`).toBeGreaterThan(0);
    const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
    expect(duplicates, path).toEqual([]);
  }
});
