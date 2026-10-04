/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * End-to-end tests for AI pictures: a showroom picture made once for everyone, the shopper's own room and that room remembered, another piece in the same room, deciding from the picture, the planner and the Concierge.
 */

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { sampleRoomGeometry, SAMPLE_WIDTH } from "../../src/components/room/sample-room";
import { freshPage, LAMP, signUpAndConfirm, uniqueEmail } from "./support/accounts";

/**
 * docs/adr/053, docs/adr/060. The test server runs with PICTURES_PROVIDER=
 * fixture: the tests' stand-in for the image model, refused in production,
 * which hands back the first photograph it is given (the room, or the
 * piece's own) and passes its check. Every flow here is the production flow —
 * the route, the allowance, the job, the three stored files, the page —
 * minus the model's own work. Tests run on desktop and phone against one
 * database at once, so a showroom picture may already be made by the other:
 * both ways are accepted where it matters, and the cache is checked with a
 * second shopper.
 */

test.describe.configure({ timeout: 120_000 });

const SOFA = "canova-3-seater-maxi-b07g2h3l4l";
const OTHER_SOFA = "westview-extra-deep-down-filled-leather-sofa-couch-b082vlyqwx";
const ROOM = "tests/e2e/fixtures/room-scene.webp";

/** Counts requests that ask for a picture, so a test can show what was (not) sent. */
function countAsks(page: Page): { count: number; bodies: string[] } {
  const seen = { count: 0, bodies: [] as string[] };
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/pictures") {
      seen.count += 1;
      seen.bodies.push(request.postData() ?? "");
    }
  });
  return seen;
}

async function studio(page: Page, path = `/en/p/${SOFA}`) {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  const section = page.locator('[data-agent-id="pictures:studio"]');
  await section.scrollIntoViewIfNeeded();
  await expect(section).toBeVisible();
  return section;
}

test("@smoke a showroom picture is made once, shown to the next shopper at once and for free, and can be bought from", async ({ browser }) => {
  const first = await freshPage(browser, { country: "GR" });
  const section = await studio(first);
  await expect(section.locator('[data-agent-id="pictures:left"]')).toContainText("A guest can make 1 picture a day");

  await section.locator('[data-agent-id="pictures:style:dark-moody"]').click();
  const result = section.locator('[data-agent-id="picture:result"]');
  await expect(result).toBeVisible({ timeout: 60_000 });
  await expect(result).toHaveAttribute("alt", /in a Dark & moody room, an AI picture/);
  // One quiet label on the picture itself, and nothing that says "preview".
  await expect(section.locator('[data-agent-id="picture:label"]')).toHaveText("AI picture");
  await expect(section).not.toContainText("Preview without AI");
  await expect.poll(() => result.evaluate((image: HTMLImageElement) => image.naturalWidth), { timeout: 10_000 }).toBeGreaterThan(400);

  // Decided from the picture: the price and stock from the shop, Add to cart, a board, and Save.
  const decide = section.locator('[data-agent-id="picture:decide"]');
  await expect(decide).toContainText("Canova");
  await expect(decide).toContainText("€");
  await expect(decide).toContainText("In stock");
  await expect(decide.locator('[data-agent-id="picture:add-to-cart"]')).toBeVisible();
  await expect(decide.locator('[data-agent-id="board:add:picture"]')).toBeVisible();
  // Save gives the full-size JPEG from the shop's own address, as a download.
  const save = decide.locator('[data-agent-id="picture:save"]');
  const href = await save.getAttribute("href");
  expect(href).toMatch(/^\/api\/pictures\?download=/);
  const file = await first.request.get(href!);
  expect(file.status()).toBe(200);
  expect(file.headers()["content-type"]).toBe("image/jpeg");
  expect(file.headers()["content-disposition"]).toMatch(/^attachment; filename="vitrine-picture-[0-9a-f]{8}\.jpg"$/);
  await first.context().close();

  // The next shopper finds it ready: shown at once, nothing asked of the server, nothing taken from the day.
  const second = await freshPage(browser, { country: "GR" });
  const asks = countAsks(second);
  const again = await studio(second);
  const tile = again.locator('[data-agent-id="pictures:style:dark-moody"]');
  await expect(tile).toContainText("Ready · free to see");
  await tile.click();
  await expect(again.locator('[data-agent-id="picture:result"]')).toBeVisible();
  expect(asks.count).toBe(0);
  await expect(again.locator('[data-agent-id="pictures:left"]')).toContainText("A guest can make 1 picture a day");
  await second.context().close();
});

test("the shopper's own room is sent only after consent, and is remembered for the next piece", async ({ browser }) => {
  const page = await freshPage(browser, { country: "GR" });
  await signUpAndConfirm(page, uniqueEmail("pictures-room"));
  const asks = countAsks(page);
  const section = await studio(page);
  await section.locator('[data-agent-id="pictures:tab:own"]').click();
  await section.locator('[data-agent-id="pictures:file"]').setInputFiles(ROOM);

  const go = section.locator('[data-agent-id="pictures:own-go"]');
  await expect(go).toBeDisabled();
  expect(asks.count).toBe(0);

  await section.locator('[data-agent-id="pictures:consent"]').check();
  await go.click();
  await expect(section.locator('[data-agent-id="picture:result"]')).toBeVisible({ timeout: 60_000 });
  await expect(section.locator('[data-agent-id="picture:label"]')).toHaveText("AI picture · Approximate size");
  expect(asks.count).toBe(1);

  // Before and after: the picture shows from the left, the room as it was to the right; the keyboard moves the slider.
  const after = (await section.locator('[data-agent-id="picture:label-after"]').boundingBox())!;
  const before = (await section.locator('[data-agent-id="picture:label-before"]').boundingBox())!;
  expect(after.x).toBeLessThan(before.x);
  const compare = section.locator('[data-agent-id="picture:compare"]');
  await compare.focus();
  await page.keyboard.press("Home");
  await expect(compare).toHaveValue("0");
  await expect(section.locator('[data-agent-id="pictures:left"]')).toContainText("2 pictures left today");

  // Another piece: the room is remembered, so one tap pictures it there — no new photo, no new consent.
  const lamp = await studio(page, LAMP);
  await lamp.locator('[data-agent-id="pictures:tab:own"]').click();
  const remembered = lamp.locator('[data-agent-id="pictures:remembered"]');
  await expect(remembered).toContainText("Your room");
  await expect(remembered).toContainText(/Kept 2[34] more hours, then deleted/);
  await remembered.locator('[data-agent-id="pictures:remembered-go"]').click();
  await expect(lamp.locator('[data-agent-id="picture:result"]')).toBeVisible({ timeout: 60_000 });
  await expect(lamp.locator('[data-agent-id="picture:label"]')).toHaveText("AI picture · Approximate size");
  const sent = JSON.parse(asks.bodies.at(-1)!) as Record<string, unknown>;
  expect(sent).toMatchObject({ kind: "quick", productSlug: "faux-wood-table-lamp-b07mbfd87n" });
  expect(sent.uploadId).toMatch(/^[0-9a-f-]{36}$/);
  await expect(lamp.locator('[data-agent-id="pictures:left"]')).toContainText("1 picture left today");
  await page.context().close();
});

test("another piece is pictured in the same room in one tap, and two pictures can be compared side by side", async ({ browser }) => {
  const page = await freshPage(browser, { country: "GR" });
  await signUpAndConfirm(page, uniqueEmail("pictures-try"));
  const section = await studio(page);
  await section.locator('[data-agent-id="pictures:style:scandinavian"]').click();
  await expect(section.locator('[data-agent-id="picture:result"]')).toBeVisible({ timeout: 60_000 });

  const others = section.locator('[data-agent-id="pictures:alternatives"]');
  await expect(others).toContainText("Try another in this room");
  await expect(others).toContainText("In the Scandinavian room");
  await others.locator(`[data-agent-id="pictures:try:${OTHER_SOFA}"]`).click();
  const decide = section.locator('[data-agent-id="picture:decide"]');
  await expect(decide).toContainText("Westview", { timeout: 60_000 });
  await expect(section.locator('[data-agent-id="picture:result"]')).toHaveAttribute("alt", /Westview.*Scandinavian room/);
  await expect(decide.locator('[data-agent-id="picture:open-piece"]')).toHaveAttribute("href", new RegExp(`/p/${OTHER_SOFA}$`));

  // Both pictures of this visit, and the two side by side, each with its own price and Add to cart.
  const visit = section.locator('[data-agent-id="pictures:visit"]');
  await expect(visit.locator('[data-agent-id^="pictures:shot:"]')).toHaveCount(2);
  await visit.locator('[data-agent-id="pictures:compare"]').click();
  const both = section.locator('[data-agent-id="pictures:compare-view"] figure');
  await expect(both).toHaveCount(2);
  await expect(both.nth(0)).toContainText("Westview");
  await expect(both.nth(1)).toContainText("Canova");
  await expect(section.locator('[data-agent-id^="picture:compare-add:"]')).toHaveCount(2);
  await page.context().close();
});

test("a picture opens full size and at actual size, and closes with Escape", async ({ browser }) => {
  const page = await freshPage(browser, { country: "GR" });
  const section = await studio(page);
  // A style the smoke test makes: ready, or made now by this guest's one picture.
  await section.locator('[data-agent-id="pictures:style:dark-moody"]').click();
  await expect(section.locator('[data-agent-id="picture:result"]')).toBeVisible({ timeout: 60_000 });
  await section.locator('[data-agent-id="picture:zoom"]').click();
  const box = page.locator('[data-agent-id="picture:lightbox"]');
  await expect(box).toBeVisible();
  const actual = page.locator('[data-agent-id="picture:actual-size"]');
  await actual.click();
  await expect(actual).toHaveAttribute("aria-pressed", "true");
  await expect(box.locator("img")).toHaveClass(/max-w-none/);
  await page.keyboard.press("Escape");
  await expect(box).toHaveCount(0);
  await page.context().close();
});

test("the room planner makes a picture from the piece placed at its true size", async ({ browser }) => {
  const page = await freshPage(browser, { country: "GR" });
  await page.goto(`/en/room?product=${SOFA}`, { waitUntil: "domcontentloaded" });
  const stage = page.locator('canvas[data-agent-id="room:stage"]');
  await expect(async () => {
    await page.getByRole("button", { name: "Try the sample room" }).click();
    await expect(stage).toBeVisible({ timeout: 1_000 });
  }).toPass();
  await stage.scrollIntoViewIfNeeded();
  const box = (await stage.boundingBox())!;
  const scale = box.width / SAMPLE_WIDTH;
  for (const [index, [x, y]] of sampleRoomGeometry().sheetImage.entries()) {
    await page.mouse.click(box.x + x * scale, box.y + y * scale);
    await expect(page.getByText(`${index + 1} of 4 corners marked`)).toBeVisible();
  }
  await page.getByRole("button", { name: "Place it" }).click();

  const panel = page.locator('[data-agent-id="room:picture"]');
  await panel.scrollIntoViewIfNeeded();
  const go = panel.locator('[data-agent-id="room:picture-go"]');
  await expect(go).toBeDisabled();

  const sent = page.waitForRequest((request) => request.method() === "POST" && new URL(request.url()).pathname === "/api/pictures");
  await panel.locator('[data-agent-id="room:picture-consent"]').check();
  await go.click();
  expect((await sent).headers()["content-type"]).toMatch(/^multipart\/form-data/);

  // What was sent rests in the frame while the picture develops (the same file): the photograph with the
  // piece placed, as a JPEG no larger than the model reads, in the photograph's own proportions.
  const shown = await panel.locator('[data-agent-id="picture:stage"] img[aria-hidden="true"]').evaluate(async (image: HTMLImageElement) => {
    await image.decode();
    const file = await (await fetch(image.src)).blob();
    return { type: file.type, width: image.naturalWidth, height: image.naturalHeight };
  });
  expect(shown.type).toBe("image/jpeg");
  expect(Math.max(shown.width, shown.height)).toBeLessThanOrEqual(1600);
  const frame = (await panel.locator('[data-agent-id="picture:stage"] > div').boundingBox())!;
  expect(Math.abs(frame.width / frame.height - shown.width / shown.height)).toBeLessThan(0.02);

  await expect(panel.locator('[data-agent-id="picture:result"]')).toBeVisible({ timeout: 60_000 });
  await expect(panel.locator('[data-agent-id="picture:label"]')).toHaveText("AI picture · Placed at true size");
  await expect(panel.locator('[data-agent-id="picture:compare"]')).toHaveCount(1);
  await page.context().close();
});

test("the Concierge asks before making a picture, then it develops in the conversation", async ({ browser }) => {
  const page = await freshPage(browser, { country: "GR" });
  await page.goto("/en", { waitUntil: "domcontentloaded" });
  await page.locator("html[data-concierge-ready]").waitFor({ timeout: 30_000 });
  await page.locator('[data-agent-id="nav:concierge-panel"]:visible, [data-agent-id="nav:concierge"]:visible').first().click();
  await expect(page.locator('[data-agent-id="concierge:dock"]')).toBeVisible({ timeout: 15_000 });

  const asks = countAsks(page);
  await page.locator('[data-agent-id="concierge:input"]').fill("Picture the Canova sofa in a Mediterranean room");
  await page.locator('[data-agent-id="concierge:send"]').click();

  const approval = page.locator('[data-agent-id="concierge:approval:picture_in_room"]');
  await expect(approval).toContainText("Make an AI picture of this piece?", { timeout: 30_000 });
  await approval.locator('[data-agent-id="concierge:approve"]').click();

  const card = page.locator('[data-agent-id^="concierge:picture:"]');
  await expect(card.locator('[data-agent-id="picture:result"]')).toBeVisible({ timeout: 60_000 });
  await expect(card.locator('[data-agent-id="picture:label"]')).toHaveText("AI picture");
  await expect(page.locator('[data-agent-id="concierge:log"]')).toContainText(/under a minute|free/);
  // The tool started it on the server: the page itself asked for nothing.
  expect(asks.count).toBe(0);
  await page.context().close();
});

test("the picture studio passes axe on its dark band", async ({ browser }) => {
  const page = await freshPage(browser, { country: "GR" });
  await studio(page);
  // Colours are read once the tabs have finished changing: halfway through a fade every pair is low-contrast.
  const settled = () => page.waitForFunction(() => document.querySelector('[data-agent-id="pictures:studio"]')!.getAnimations({ subtree: true }).length === 0);
  const audit = async () => {
    await settled();
    const results = await new AxeBuilder({ page }).include('[data-agent-id="pictures:studio"]').analyze();
    return results.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`);
  };
  expect(await audit()).toEqual([]);
  await page.locator('[data-agent-id="pictures:tab:own"]').click();
  await expect(page.locator('[data-agent-id="pictures:tab:own"]')).toHaveAttribute("aria-selected", "true");
  expect(await audit()).toEqual([]);
  await page.context().close();
});
