/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * End-to-end tests for AI pictures: a showroom scene made once for everyone, the shopper's own room with consent, the planner's picture, and the Concierge.
 */

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { sampleRoomGeometry, SAMPLE_WIDTH } from "../../src/components/room/sample-room";
import { freshPage } from "./support/accounts";

/**
 * docs/adr/053. Without a key the shop draws each picture itself (labelled
 * "Preview without AI"), through the same route, allowance, job and storage a
 * real picture takes, so every flow here is the production flow minus the
 * model call. Tests run on desktop and phone against one database at once, so
 * a scene may already be made by the other: both ways are accepted where it
 * matters, and the cache is checked with a second shopper.
 */

test.describe.configure({ timeout: 90_000 });

const SOFA = "canova-3-seater-maxi-b07g2h3l4l";
const ROOM = "tests/e2e/fixtures/room-scene.webp";

/** Counts requests that ask for a picture, so a test can show what was (not) sent. */
function countAsks(page: Page): { count: number } {
  const seen = { count: 0 };
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/pictures") seen.count += 1;
  });
  return seen;
}

async function studio(page: Page) {
  await page.goto(`/en/p/${SOFA}`, { waitUntil: "domcontentloaded" });
  const section = page.locator('[data-agent-id="pictures:studio"]');
  await section.scrollIntoViewIfNeeded();
  await expect(section).toBeVisible();
  return section;
}

test("@smoke a showroom picture is made once, then shown to the next shopper at once and for free", async ({ browser }) => {
  const first = await freshPage(browser, { country: "GR" });
  const section = await studio(first);
  await expect(section.locator('[data-agent-id="pictures:left"]')).toContainText("A guest can make 1 picture a day");

  await section.locator('[data-agent-id="pictures:style:dark-moody"]').click();
  const result = section.locator('[data-agent-id="picture:result"]');
  await expect(result).toBeVisible({ timeout: 45_000 });
  await expect(result).toHaveAttribute("alt", /in a Dark & moody room, an AI picture/);
  await expect(section.locator('[data-agent-id="picture:label"]')).toHaveText("Preview without AI");
  // The picture is an image the browser can really show.
  await expect.poll(() => result.evaluate((image: HTMLImageElement) => image.naturalWidth), { timeout: 10_000 }).toBeGreaterThan(400);
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

test("a photo of the shopper's own room is sent only after consent, and the picture says its size is approximate", async ({ browser }) => {
  const page = await freshPage(browser, { country: "GR" });
  const asks = countAsks(page);
  const section = await studio(page);
  await section.locator('[data-agent-id="pictures:tab:own"]').click();
  await section.locator('[data-agent-id="pictures:file"]').setInputFiles(ROOM);

  const go = section.locator('[data-agent-id="pictures:own-go"]');
  await expect(go).toBeDisabled();
  expect(asks.count).toBe(0);

  await section.locator('[data-agent-id="pictures:consent"]').check();
  await go.click();
  await expect(section.locator('[data-agent-id="picture:result"]')).toBeVisible({ timeout: 45_000 });
  await expect(section.locator('[data-agent-id="picture:label"]')).toHaveText("Preview without AI · Approximate size");
  expect(asks.count).toBe(1);

  // Before and after: the slider is a range input, so the keyboard moves it too.
  const compare = section.locator('[data-agent-id="picture:compare"]');
  await compare.focus();
  await page.keyboard.press("Home");
  await expect(compare).toHaveValue("0");

  // A guest's one picture of the day is spent: the next is refused before the photo is even kept.
  await expect(section.locator('[data-agent-id="pictures:left"]')).toContainText("No pictures left today");
  await go.click();
  await expect(section.locator('[data-agent-id="pictures:error"]')).toContainText("That's today's pictures");
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

  await expect(panel.locator('[data-agent-id="picture:result"]')).toBeVisible({ timeout: 45_000 });
  await expect(panel.locator('[data-agent-id="picture:label"]')).toHaveText("Preview without AI · Placed at true size");
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
  await page.locator('[data-agent-id="concierge:input"]').fill("Picture the Canova sofa in a Scandinavian room");
  await page.locator('[data-agent-id="concierge:send"]').click();

  const approval = page.locator('[data-agent-id="concierge:approval:picture_in_room"]');
  await expect(approval).toContainText("Make an AI picture of this piece?", { timeout: 30_000 });
  await approval.locator('[data-agent-id="concierge:approve"]').click();

  const card = page.locator('[data-agent-id^="concierge:picture:"]');
  await expect(card.locator('[data-agent-id="picture:result"]')).toBeVisible({ timeout: 45_000 });
  await expect(card.locator('[data-agent-id="picture:label"]')).toHaveText("Preview without AI");
  await expect(page.locator('[data-agent-id="concierge:log"]')).toContainText(/twenty seconds|free/);
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
