/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * End-to-end tests for the Wear capsule and the Fitting Room: sizes, a photograph, a try-on, and deleting it.
 */

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { freshPage } from "./support/accounts";

/**
 * docs/adr/022 and docs/adr/023. The test server has no try-on key, so the
 * result is the piece drawn over the photograph — the same path, the same
 * storage, the same day to live, and labelled as a drawing in the interface.
 *
 * The photograph used here is a drawn figure in tests/e2e/fixtures: nobody's
 * likeness, so nobody's privacy.
 */

test.describe.configure({ timeout: 90_000 });

const PERSON = "tests/e2e/fixtures/person.webp";
const PIECE = "/en/p/poplin-shirt-ecru";

async function giveAPhotograph(page: Page): Promise<void> {
  await page.goto("/en/fitting-room", { waitUntil: "domcontentloaded" });
  await page.locator('[data-agent-id="fitting:consent"]').check();
  await page.locator('[data-agent-id="fitting:file"]').setInputFiles(PERSON);
  await expect(page.locator('[data-agent-id="fitting:photo"]')).toBeVisible({ timeout: 20_000 });
}

test("@smoke a shopper picks a size, and the cart says which one", async ({ browser }) => {
  const page = await freshPage(browser, { country: "GR" });
  await page.goto(PIECE, { waitUntil: "domcontentloaded" });

  // Nothing can be added until a size is chosen.
  await expect(page.locator(`[data-agent-id^="action:add-to-cart"]`)).toContainText("Choose a size first");
  await expect(page.locator('[data-agent-id="product:size-chart"]')).toContainText("Chest");

  await page.locator('[data-agent-id="size:M"]').click();
  await expect(page.locator('[data-agent-id="sizes:state"]')).toContainText("Size M");
  await page.locator(`[data-agent-id^="action:add-to-cart"]`).click();
  // The mini cart opens on success; a refusal would be a message instead.
  await expect(page.locator('[data-agent-id="mini-cart"]')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[data-agent-id="mini-cart"]')).toContainText("Poplin Shirt, M");

  const cart = (await (await page.request.get("/api/cart?locale=en")).json()) as { lines: { title: string }[] };
  expect(cart.lines[0]!.title).toBe("Poplin Shirt, M");
  await page.context().close();
});

test("a size that has sold out is shown, and cannot be chosen", async ({ browser }) => {
  const page = await freshPage(browser, { country: "GR" });
  // Every capsule piece has five sizes; the shop sells a few of them out.
  await page.goto("/en/c/wear", { waitUntil: "domcontentloaded" });
  const links = await page.locator('[data-agent-id^="product-tile:"] a, main a[href*="/p/"]').evaluateAll((nodes) =>
    [...new Set(nodes.map((node) => (node as HTMLAnchorElement).getAttribute("href")))].filter((href): href is string => href !== null),
  );

  let found = false;
  for (const href of links.slice(0, 12)) {
    await page.goto(href, { waitUntil: "domcontentloaded" });
    // By the label, not by `disabled`: every size is inert for the moment before the page hydrates.
    const soldOut = page.locator('[data-agent-id^="size:"][aria-label*="sold out"]');
    if ((await soldOut.count()) > 0) {
      await expect(soldOut.first()).toBeDisabled();
      await expect(soldOut.first()).toHaveAttribute("aria-label", /sold out/i);
      found = true;
      break;
    }
  }
  expect(found, "no capsule piece had a size that had sold out").toBe(true);
  await page.context().close();
});

test("@smoke the Fitting Room takes a photograph, tries a piece on it, and deletes both", async ({ browser }) => {
  const page = await freshPage(browser, { country: "GR" });

  // Nothing is accepted before the shopper agrees.
  await page.goto("/en/fitting-room", { waitUntil: "domcontentloaded" });
  await expect(page.locator('[data-agent-id="fitting:file"]')).toBeHidden();
  await expect(page.locator('[data-agent-id="fitting:page"]')).toContainText("Kept for 24 hours");

  await giveAPhotograph(page);
  await expect(page.locator('[data-agent-id="fitting:countdown"]')).toContainText("Deleted in");

  // One piece, tried on: it is made as a job, so the page waits for it.
  await page.locator('[data-agent-id^="action:try-on:"]').first().click();
  await expect(page.locator('[data-agent-id="fitting:result:done"]')).toBeVisible({ timeout: 45_000 });
  await expect(page.locator('[data-agent-id="fitting:results"]')).toContainText("Drawn over the photograph");

  // "Delete now" takes the photograph and everything made from it.
  await page.locator('[data-agent-id="action:delete-photo"]').click();
  await expect(page.locator('[data-agent-id="fitting:photo"]')).toHaveCount(0);
  const photos = (await (await page.request.get("/api/photos")).json()) as { photos: unknown[] };
  expect(photos.photos).toEqual([]);
  await page.context().close();
});

test("a photograph is refused without consent, and so is anything that is not one", async ({ browser }) => {
  const page = await freshPage(browser);
  await page.goto("/en/fitting-room", { waitUntil: "domcontentloaded" });
  const origin = new URL(page.url()).origin;

  const withoutConsent = await page.request.post("/api/photos", {
    headers: { origin },
    multipart: { kind: "try_on", consent: "no", file: { name: "person.webp", mimeType: "image/webp", buffer: Buffer.from([1, 2, 3]) } },
  });
  expect(withoutConsent.status()).toBe(400);
  expect((await withoutConsent.json()).reason).toBe("no_consent");

  const notAPhoto = await page.request.post("/api/photos", {
    headers: { origin },
    multipart: { kind: "try_on", consent: "yes", file: { name: "map.svg", mimeType: "image/svg+xml", buffer: Buffer.from("<svg/>") } },
  });
  expect(notAPhoto.status()).toBe(400);
  expect((await notAPhoto.json()).reason).toBe("type");

  const wrongPurpose = await page.request.post("/api/photos", {
    headers: { origin },
    multipart: { kind: "passport", consent: "yes", file: { name: "person.webp", mimeType: "image/webp", buffer: Buffer.from([1, 2, 3]) } },
  });
  expect(wrongPurpose.status()).toBe(400);
  expect((await wrongPurpose.json()).reason).toBe("kind");

  await page.context().close();
});

test("one shopper cannot see or delete another's photograph", async ({ browser }) => {
  const owner = await freshPage(browser);
  await giveAPhotograph(owner);
  const photos = (await (await owner.request.get("/api/photos")).json()) as { photos: { id: string }[] };
  const id = photos.photos[0]!.id;

  const stranger = await freshPage(browser);
  await stranger.goto("/en/fitting-room", { waitUntil: "domcontentloaded" });
  const mine = (await (await stranger.request.get("/api/photos")).json()) as { photos: unknown[] };
  expect(mine.photos).toEqual([]);

  const stolen = await stranger.request.delete(`/api/photos/${id}`, { headers: { origin: new URL(stranger.url()).origin } });
  expect(stolen.status()).toBe(404);
  // And the owner still has it.
  const still = (await (await owner.request.get("/api/photos")).json()) as { photos: unknown[] };
  expect(still.photos).toHaveLength(1);

  await stranger.context().close();
  await owner.context().close();
});

test("the capsule and the Fitting Room pass the accessibility checks", async ({ browser }) => {
  const page = await freshPage(browser, { country: "GR" });
  for (const path of ["/en/c/wear", PIECE, "/en/fitting-room", "/el/fitting-room"]) {
    // Not `networkidle`: a listing page prefetches every tile, so it never goes quiet.
    await page.goto(path, { waitUntil: "domcontentloaded" });
    await page.locator("main").waitFor();
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    expect(results.violations, `${path}: ${results.violations.map((violation) => violation.id).join(", ")}`).toEqual([]);
  }
  await page.context().close();
});
