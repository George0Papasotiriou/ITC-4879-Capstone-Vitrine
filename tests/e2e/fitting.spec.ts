/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * End-to-end tests for the clothes and the Fitting Room: sizes, a photograph, a try-on, and deleting it.
 */

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { freshPage, signUpAndConfirm, uniqueEmail } from "./support/accounts";

/**
 * docs/adr/023, docs/adr/062 and docs/adr/063. The test server talks to the
 * tests' FASHN (FASHN_PROVIDER=fixture): it answers try-ons, videos and model
 * shots as the service would, from what it was given, with no key and no bill —
 * the same jobs, storage and day to live as the real thing.
 *
 * The photograph used here is a drawn figure in tests/e2e/fixtures: nobody's
 * likeness, so nobody's privacy.
 */

test.describe.configure({ timeout: 90_000 });

const PERSON = "tests/e2e/fixtures/person.webp";
/** A real men's shirt from the clothes specimen (docs/adr/062), every size in stock. */
const PIECE = "/en/p/short-sleeve-woven-shirt-b01b48nssw";

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
  await expect(page.locator('[data-agent-id="mini-cart"]')).toContainText("Short Sleeve Woven Shirt, M");

  const cart = (await (await page.request.get("/api/cart?locale=en")).json()) as { lines: { title: string }[] };
  expect(cart.lines[0]!.title).toBe("Short Sleeve Woven Shirt, M");
  await page.context().close();
});

test("a size that has sold out is shown, and cannot be chosen", async ({ browser }) => {
  const page = await freshPage(browser, { country: "GR" });
  // Every garment has five sizes; the shop sells a few of them out.
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
  expect(found, "no garment had a size that had sold out").toBe(true);
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
  await expect(page.locator('[data-agent-id="fitting:results"]')).toContainText("Virtual try-on");

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

test("the clothes and the Fitting Room pass the accessibility checks", async ({ browser }) => {
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

/* ---------------------------- the studio (docs/adr/063) ---------------------------- */

const TEE = "short-sleeve-pocket-tee-b00blo0cqq";
const JEAN = "relaxed-fit-straight-leg-jean-b0041g5sec";
const SNAP_SHIRT = "sport-western-two-pocket-long-sleeve-snap-shirt-b07w4cfnfg";

test("an account tries a whole outfit on, in dressing order, and makes it move", async ({ browser }) => {
  const page = await freshPage(browser, { country: "GR" });
  await signUpAndConfirm(page, uniqueEmail("outfit"));
  await giveAPhotograph(page);

  // A tee, jeans and a pair of shoes: three places on the body.
  await page.locator(`[data-agent-id="action:outfit:${TEE}"]`).click();
  await page.locator(`[data-agent-id="action:outfit:${JEAN}"]`).click();
  await page.locator('[data-agent-id="fitting:group:shoes"] [data-agent-id^="action:outfit:"]').first().click();
  const tray = page.locator('[data-agent-id="fitting:outfit-pieces"] li');
  await expect(tray).toHaveCount(3);
  // Put on as a person dresses: the jeans before the tee, the shoes last.
  await expect(tray.nth(0)).toContainText("Jean");
  await expect(tray.nth(1)).toContainText("Tee");
  await expect(page.locator('[data-agent-id="fitting:outfit"]')).toContainText("Uses 9 credits");

  await page.locator('[data-agent-id="action:try-outfit"]').click();
  const outfit = page.locator('[data-agent-id="fitting:result:done"]').filter({ hasText: "Outfit of 3 pieces" });
  await expect(outfit).toBeVisible({ timeout: 60_000 });

  await outfit.locator('[data-agent-id^="action:see-it-move:"]').click();
  await expect(outfit.locator('[data-agent-id="fitting:video"]')).toBeVisible({ timeout: 60_000 });
  const src = await outfit.locator('[data-agent-id="fitting:video"]').getAttribute("src");
  expect((await page.request.get(src!)).headers()["content-type"]).toBe("video/webm");
  await page.context().close();
});

test("an outfit that cannot be put on says why, and a guest is asked to sign in to see a try-on move", async ({ browser }) => {
  const page = await freshPage(browser, { country: "GR" });
  await giveAPhotograph(page);
  await page.locator(`[data-agent-id="action:outfit:${TEE}"]`).click();
  await page.locator(`[data-agent-id="action:outfit:${SNAP_SHIRT}"]`).click();
  await expect(page.locator('[data-agent-id="fitting:outfit-problem"]')).toHaveText("Two of these go in the same place on the body: keep one.");
  await expect(page.locator('[data-agent-id="action:try-outfit"]')).toBeDisabled();

  await page.locator(`[data-agent-id="action:try-on:${TEE}"]`).click();
  await expect(page.locator('[data-agent-id="fitting:result:done"]')).toBeVisible({ timeout: 45_000 });
  await expect(page.locator('[data-agent-id="fitting:move-sign-in"]')).toHaveText("Sign in to see it move");
  await page.context().close();
});

test("on a model like you: made once by the first shopper, then shown free to the next", async ({ browser }, info) => {
  // Each device project its own model: they share one database, and the second would find the first one's shot already made.
  const preset = info.project.name === "mobile" ? "curvy-deep" : "tall-olive";
  const first = await freshPage(browser, { country: "GR" });
  await first.goto(`/en/p/${JEAN}`, { waitUntil: "domcontentloaded" });
  const panel = first.locator('[data-agent-id="product:model-shots"]');
  await expect(panel.getByRole("heading", { name: "On a model like you" })).toBeVisible();
  await panel.locator(`[data-agent-id="model-shots:preset:${preset}"]`).click();
  await expect(panel).toContainText("Uses 3 credits from today, once");
  await panel.locator('[data-agent-id="action:make-model-shot"]').click();
  await expect(panel.locator('[data-agent-id="model-shots:image"]')).toBeVisible({ timeout: 45_000 });
  await expect(panel).toContainText("AI picture");
  await first.context().close();

  const next = await freshPage(browser, { country: "GR" });
  await next.goto(`/en/p/${JEAN}`, { waitUntil: "domcontentloaded" });
  const theirs = next.locator('[data-agent-id="product:model-shots"]');
  await theirs.locator(`[data-agent-id="model-shots:preset:${preset}"]`).click();
  await expect(theirs.locator('[data-agent-id="model-shots:image"]')).toBeVisible({ timeout: 15_000 });
  await expect(theirs.locator('[data-agent-id="action:make-model-shot"]')).toHaveCount(0);
  await next.context().close();
});
