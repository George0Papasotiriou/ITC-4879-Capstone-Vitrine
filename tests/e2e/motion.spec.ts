/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * End-to-end tests for motion: the flight to the cart, the grid rearranging itself, the dock pulled away, and reduced motion honoured.
 */

import { expect, test, type Locator, type Page } from "@playwright/test";

import { freshPage } from "./support/accounts";

/**
 * docs/adr/031. Motion is checked for what it must guarantee rather than how
 * it looks: that it runs when it should, that it ends with the page in the
 * right state, and that it does not run at all for someone who asked for less
 * motion — whether they asked their system or the shop.
 */

test.describe.configure({ timeout: 90_000 });

const LAMP = "/en/p/faux-wood-table-lamp-b07mbfd87n";

/** Counts the view transitions the page starts, and the types each carried. */
async function watchTransitions(page: Page) {
  await page.addInitScript(() => {
    const started: string[][] = [];
    (window as unknown as { vitrineTransitions: string[][] }).vitrineTransitions = started;
    const original = document.startViewTransition?.bind(document);
    if (original === undefined) return;
    document.startViewTransition = ((argument: Parameters<typeof original>[0]) => {
      const types = typeof argument === "object" && argument !== null && "types" in argument ? [...((argument as { types?: Iterable<string> }).types ?? [])] : [];
      started.push(types);
      return original(argument);
    }) as typeof document.startViewTransition;
  });
}

/**
 * Waits until React has attached itself to an element: a link clicked before
 * that is followed by the browser as a full page load, with no transition.
 */
async function live(locator: Locator) {
  await expect.poll(() => locator.evaluate((element) => Object.keys(element).some((key) => key.startsWith("__reactFiber"))), { timeout: 20_000 }).toBe(true);
}

/**
 * Hovers a link, as a pointer does before a click, and waits for Next.js to
 * prefetch its page. The transition plays when the destination is ready at the
 * moment of the click; one that still has to load simply appears (docs/adr/031).
 */
async function prefetched(page: Page, link: Locator) {
  const href = await link.getAttribute("href");
  const fetched = page.waitForResponse((response) => href !== null && response.url().includes(href.split("?")[0]!) && response.request().headers()["next-router-prefetch"] !== undefined, { timeout: 8_000 }).catch(() => null);
  await link.hover();
  await fetched;
}

const transitions = (page: Page) => page.evaluate(() => (window as unknown as { vitrineTransitions?: string[][] }).vitrineTransitions ?? []);

/** Clicks add to cart once the page has hydrated, and returns whether a copy of the photograph flew. */
async function addLamp(page: Page): Promise<boolean> {
  const button = page.locator('[data-agent-id^="action:add-to-cart:"]');
  // Enabled once the page has hydrated; a page that has not after a while is loaded again, as the shop's other specs do.
  await expect(async () => {
    await page.goto(LAMP, { waitUntil: "domcontentloaded" });
    await expect(button).toBeEnabled({ timeout: 12_000 });
  }).toPass({ timeout: 45_000 });
  // Watch for the flying copy before it could appear: it is short-lived.
  const flew = page.evaluate(
    () =>
      new Promise<boolean>((resolve) => {
        const seen = new MutationObserver((records) => {
          for (const record of records)
            for (const node of record.addedNodes)
              if (node instanceof HTMLImageElement && node.style.position === "fixed" && node.getAttribute("aria-hidden") === "true") {
                seen.disconnect();
                resolve(true);
              }
        });
        seen.observe(document.body, { childList: true });
        window.setTimeout(() => {
          seen.disconnect();
          resolve(false);
        }, 6_000);
      }),
  );
  await button.click();
  return flew;
}

test("@smoke adding to the cart flies the piece to the cart, which ticks as it lands, and then the mini cart opens", async ({ browser }) => {
  const page = await freshPage(browser, { country: "GR" });
  expect(await addLamp(page)).toBe(true);
  // The button says what happened, with a drawn tick.
  await expect(page.locator('[data-agent-id$=":added"]')).toContainText("Added to cart");
  await expect(page.getByRole("dialog", { name: "Added to your cart" })).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('[data-agent-id="nav:cart-count"]:visible').first()).toHaveText("1");
  // The copy is gone once it has landed; nothing is left behind in the page.
  await expect(page.locator("body > img[aria-hidden='true']")).toHaveCount(0);
  await page.context().close();
});

test("nothing flies for someone whose system asks for reduced motion, and the cart still changes", async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  expect(await addLamp(page)).toBe(false);
  await expect(page.getByRole("dialog", { name: "Added to your cart" })).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('[data-agent-id="nav:cart-count"]:visible').first()).toHaveText("1");
  // No animation is left running anywhere on the page.
  const running = await page.evaluate(() => document.getAnimations().filter((animation) => animation.playState === "running").length);
  expect(running).toBe(0);
  await context.close();
});

test("the shop's own reduced-motion choice is honoured too, even where the system asks for full motion", async ({ browser, baseURL }) => {
  const page = await freshPage(browser, { country: "GR" });
  // "Less motion" chosen in the shop's comfort settings: kept in the cookie, applied before the first paint.
  await page.context().addCookies([{ name: "vt_comfort", value: "motion_reduce", url: baseURL! }]);
  expect(await addLamp(page)).toBe(false);
  const duration = await page.evaluate(() => getComputedStyle(document.querySelector("[data-agent-id^='action:add-to-cart:']")!).transitionDuration);
  // Every transition collapses to (effectively) nothing.
  expect(Number.parseFloat(duration)).toBeLessThan(0.001);
  await page.context().close();
});

test("choosing a filter rearranges the grid in place: the pieces that stay glide, the new ones rise in", async ({ browser }) => {
  const page = await freshPage(browser, { country: "GR" });
  await page.goto("/en/c/lighting", { waitUntil: "domcontentloaded" });
  await page.locator("html[data-concierge-ready]").waitFor({ timeout: 30_000 });
  const grid = page.locator('[data-agent-id="listing:grid"]');
  const before = await page.locator('[data-agent-id^="product:"]').count();

  // On a phone the filters sit behind a disclosure.
  const disclosure = page.locator("details.listing-filters > summary");
  if (await disclosure.isVisible()) await disclosure.click();
  const filter = page.locator("fieldset a[href*='?']:visible").first();
  await live(filter);
  await filter.click();
  await expect(page).toHaveURL(/\?/, { timeout: 15_000 });
  // Whenever the new grid arrives, the rearrangement plays — once per change.
  await expect(grid).toHaveAttribute("data-flips", "1", { timeout: 15_000 });
  expect(await page.locator('[data-agent-id^="product:"]').count()).toBeLessThanOrEqual(before);
  await page.context().close();
});

test("opening a piece from its tile morphs the photograph, and the page itself does not fade underneath", async ({ browser }, info) => {
  // A view transition plays when the product page is ready at the click (prefetched, as on
  // hover); a touch screen has no hover to prefetch on, so the morph is checked on the wide layout.
  test.skip(info.project.name === "mobile", "Needs the hover prefetch a pointer gives.");
  const page = await freshPage(browser, { country: "GR" });
  await watchTransitions(page);
  await expect(async () => {
    await page.goto("/en/c/lighting", { waitUntil: "domcontentloaded" });
    await page.locator("html[data-concierge-ready]").waitFor({ timeout: 15_000 });
    const tile = page.locator('[data-agent-id^="product:"] a').first();
    await live(tile);
    await prefetched(page, tile);
    await tile.click();
    await expect(page).toHaveURL(/\/en\/p\//, { timeout: 10_000 });
    await expect.poll(async () => (await transitions(page)).some((types) => types.includes("morph")), { timeout: 4_000 }).toBe(true);
  }).toPass({ timeout: 70_000 });
  expect((await transitions(page)).some((types) => types.length === 0)).toBe(false);
  await page.context().close();
});

test("on a phone, the Concierge sheet can be pulled down by its handle, and settles back when not pulled far", async ({ browser }, info) => {
  test.skip(info.project.name !== "mobile", "The handle is a phone's; wider screens dock the Concierge at the side.");
  const page = await freshPage(browser, { country: "GR" });
  await page.goto("/en", { waitUntil: "domcontentloaded" });
  await page.locator("html[data-concierge-ready]").waitFor({ timeout: 30_000 });
  await page.locator('[data-agent-id="nav:concierge"]:visible').first().click();
  const dock = page.locator('[data-agent-id="concierge:dock"]');
  await expect(dock).toBeVisible();
  // A thumb reaches for the handle once the sheet has arrived.
  await dock.evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));
  const handle = page.locator('[data-agent-id="concierge:handle"]');
  const box = (await handle.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;

  // A short pull, let go slowly: it settles back.
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let step = 1; step <= 8; step += 1) {
    await page.mouse.move(x, y + step * 5);
    await page.waitForTimeout(40);
  }
  await page.mouse.up();
  await expect(dock).toHaveAttribute("data-state", "open");
  // It springs back to where it was.
  await expect.poll(() => dock.evaluate((element) => element.style.transform)).toBe("");
  // And the handle is back under the finger before the next pull.
  await expect.poll(async () => Math.abs((await handle.boundingBox())!.y - box.y)).toBeLessThan(1);

  // A long pull closes it.
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let step = 1; step <= 10; step += 1) await page.mouse.move(x, y + step * 40);
  await page.mouse.up();
  await expect(dock).toHaveCount(0, { timeout: 5_000 });
  await page.context().close();
});
