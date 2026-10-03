/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * End-to-end tests for the ways into the Concierge besides typing: the home page's microphone, and a photograph pasted, dropped or chosen.
 */

import { readFileSync } from "node:fs";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { freshPage } from "./support/accounts";

/**
 * docs/adr/051. The home page's prompt said "Describe it, show a photo, or just
 * say it", and only typing worked. Now the microphone opens the Concierge
 * already listening (the scripted voice driver stands in for a microphone,
 * docs/adr/026), and a photograph goes with a question — but only once the
 * shopper ticks its consent line: before that nothing is uploaded at all.
 * The Concierge runs on its rules here (no key), which read the photograph's
 * colours (find_by_photo) and say so.
 */

test.describe.configure({ timeout: 90_000 });

const SCENE = "tests/e2e/fixtures/room-scene.webp";

async function home(page: Page, { voice = false } = {}): Promise<void> {
  if (voice) {
    await page.addInitScript(() => {
      window.vitrineVoiceScripted = true;
    });
  }
  await page.goto("/en", { waitUntil: "domcontentloaded" });
  await page.locator("html[data-concierge-ready]").waitFor({ timeout: 30_000 });
}

/** Counts uploads to the photo route, so a test can show nothing left the page before consent. */
function countUploads(page: Page): { count: number } {
  const seen = { count: 0 };
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/photos") seen.count += 1;
  });
  return seen;
}

test("@smoke the home page's microphone opens the Concierge already listening, and what is heard is answered", async ({ browser }) => {
  const page = await freshPage(browser, { country: "GR" });
  await home(page, { voice: true });

  await page.locator('[data-agent-id="home:prompt-speak"]').click();
  await expect(page.locator('[data-agent-id="concierge:dock"]')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('[data-agent-id="voice:state"]')).toHaveText("Listening", { timeout: 20_000 });

  await page.evaluate(() => window.vitrineVoice?.hear("show me green rugs"));
  await expect(page.locator('[data-agent-id="voice:caption"]')).toContainText("show me green rugs");
  await expect(page.locator('[data-agent-id="concierge:message:assistant"]').first()).toBeVisible({ timeout: 30_000 });
  await page.context().close();
});

test("@smoke a photo chosen on the home page goes with the question only after its consent, and the Concierge answers from it", async ({ browser }) => {
  const page = await freshPage(browser, { country: "GR" });
  const uploads = countUploads(page);
  await home(page);
  const prompt = page.locator('[data-agent-id="home:prompt"]');

  await prompt.locator('[data-agent-id="photo:input"]').setInputFiles(SCENE);
  await expect(prompt.locator('[data-agent-id="photo:chip"] img')).toBeVisible();

  // Without the tick nothing is sent, and the shopper is told why.
  await prompt.locator('[data-agent-id="home:prompt-send"]').click();
  await expect(prompt.locator('[data-agent-id="photo:error"]')).toContainText("Tick the box first");
  expect(uploads.count).toBe(0);
  await expect(page.locator('[data-agent-id="concierge:dock"]')).toHaveCount(0);

  await new AxeBuilder({ page }).include('[data-agent-id="home:prompt"]').analyze().then((result) => expect(result.violations).toEqual([]));

  await prompt.locator('[data-agent-id="photo:consent"]').check();
  await prompt.locator("textarea").fill("find a table that matches my room");
  await prompt.locator('[data-agent-id="home:prompt-send"]').click();

  // The question arrives with its photograph, and the answer comes from it.
  const dock = page.locator('[data-agent-id="concierge:dock"]');
  await expect(dock.locator('[data-agent-id="concierge:message-photo"] img')).toBeVisible({ timeout: 30_000 });
  await expect(dock.locator('[data-agent-id="concierge:message:assistant"]').last()).toContainText("in your photograph", { timeout: 30_000 });
  await expect(dock.locator('[data-agent-id^="concierge-product:"]').first()).toBeVisible();
  expect(uploads.count).toBe(1);

  // The shop kept it as a photograph to search by, for a day.
  const listed = (await (await page.request.get("/api/photos")).json()) as { photos: { kind: string; minutesLeft: number }[] };
  expect(listed.photos.map((photo) => photo.kind)).toContain("snap");
  expect(listed.photos[0]!.minutesLeft).toBeGreaterThan(23 * 60);
  await page.context().close();
});

test("a photo pasted or dropped into the dock is attached, and anything that is not a photo is refused at once", async ({ browser }) => {
  const page = await freshPage(browser, { country: "GR" });
  await home(page);
  await page.locator('[data-agent-id="nav:concierge-panel"]:visible, [data-agent-id="nav:concierge"]:visible').first().click();
  const composer = page.locator('[data-agent-id="concierge:composer"]');
  await expect(composer).toBeVisible({ timeout: 15_000 });
  const scene = readFileSync(SCENE).toString("base64");

  // Paste, as Ctrl+V with an image on the clipboard would.
  await composer.locator("textarea").evaluate((field, base64) => {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    const data = new DataTransfer();
    data.items.add(new File([bytes], "pasted.webp", { type: "image/webp" }));
    field.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  }, scene);
  await expect(composer.locator('[data-agent-id="photo:chip"] img')).toBeVisible();
  await expect(composer.locator('[data-agent-id="photo:idea:style"]')).toBeVisible();
  await composer.locator('[data-agent-id="photo:remove"]').click();
  await expect(composer.locator('[data-agent-id="photo:chip"]')).toHaveCount(0);

  // Drop.
  await composer.evaluate((form, base64) => {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    const data = new DataTransfer();
    data.items.add(new File([bytes], "dropped.webp", { type: "image/webp" }));
    for (const type of ["dragenter", "dragover", "drop"]) form.dispatchEvent(new DragEvent(type, { dataTransfer: data, bubbles: true, cancelable: true }));
  }, scene);
  await expect(composer.locator('[data-agent-id="photo:chip"] img')).toBeVisible();

  // A file that is not a photograph never gets as far as the shop.
  await composer.locator('[data-agent-id="photo:input"]').setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("not a photo") });
  await expect(composer.locator('[data-agent-id="photo:error"]')).toContainText("isn't a photo");
  await page.context().close();
});
