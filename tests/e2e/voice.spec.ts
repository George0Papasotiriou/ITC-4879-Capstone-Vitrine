/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * End-to-end tests for talking to the Concierge: a spoken turn, its captions, and interrupting the answer.
 */

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { freshPage } from "./support/accounts";

/**
 * docs/adr/026. Chromium has no speech recognition, so the tests drive the
 * scripted driver: `window.vitrineVoice.hear("…")` plays a sentence into the
 * session, and what the Concierge would say out loud is recorded instead of
 * spoken. Everything between those two points — the state machine, the turn at
 * `/api/concierge`, the tools, the captions, the interruption — is the code
 * that runs for a real microphone.
 */

test.describe.configure({ timeout: 90_000 });

/** A page whose Concierge speaks through the scripted driver. */
async function withVoice(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.vitrineVoiceScripted = true;
  });
  await page.goto("/en", { waitUntil: "domcontentloaded" });
  // The toggle is pressed once, after hydration, as in concierge.spec.ts.
  await page.locator("html[data-concierge-ready]").waitFor({ timeout: 30_000 });
  await page.locator('[data-agent-id="nav:concierge-panel"]:visible, [data-agent-id="nav:concierge"]:visible').first().click();
  await expect(page.locator('[data-agent-id="voice:bar"]')).toBeVisible({ timeout: 15_000 });
}

/** What the Concierge has said out loud in this session. */
const said = (page: Page) => page.evaluate(() => window.vitrineVoice?.said ?? []);

test("@smoke a spoken question becomes an ordinary turn, and the answer is spoken and written", async ({ browser }) => {
  const page = await freshPage(browser, { country: "GR" });
  await withVoice(page);

  await expect(page.locator('[data-agent-id="voice:state"]')).toHaveText("Voice is off");
  await page.locator('[data-agent-id="voice:start"]').click();
  await expect(page.locator('[data-agent-id="voice:state"]')).toHaveText("Listening", { timeout: 20_000 });

  await page.evaluate(() => window.vitrineVoice?.hear("show me green rugs"));

  // What was heard is on screen, as captions, whether or not anyone is listening.
  await expect(page.locator('[data-agent-id="voice:caption"]')).toContainText("show me green rugs");
  // And the turn went to the Concierge itself: the conversation has the answer.
  await expect(page.locator('[data-agent-id="concierge:message:assistant"]').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-agent-id="voice:state"]')).toHaveText("Speaking");

  const spoken = await said(page);
  expect(spoken.length).toBe(1);
  expect(spoken[0]!.length).toBeGreaterThan(0);
  // Nothing is read out that was meant for the eye.
  expect(spoken[0]).not.toContain("*");
  expect(spoken[0]).not.toContain("](");

  await page.context().close();
});

test("speaking over the Concierge stops it, and it listens again", async ({ browser }) => {
  const page = await freshPage(browser, { country: "GR" });
  await withVoice(page);
  await page.locator('[data-agent-id="voice:start"]').click();
  await expect(page.locator('[data-agent-id="voice:state"]')).toHaveText("Listening", { timeout: 20_000 });

  await page.evaluate(() => window.vitrineVoice?.hear("show me green rugs"));
  await expect(page.locator('[data-agent-id="voice:state"]')).toHaveText("Speaking", { timeout: 30_000 });

  // A word over the answer stops it mid-sentence.
  await page.evaluate(() => window.vitrineVoice?.hear("no, the blue one", { final: false }));
  await expect(page.locator('[data-agent-id="voice:state"]')).toHaveText("Listening");
  expect(await page.evaluate(() => window.vitrineVoice?.speaking)).toBe(false);
  await expect(page.locator('[data-agent-id="voice:caption"]')).toContainText("no, the blue one");

  // And "Stop" ends the session from wherever it is.
  await page.locator('[data-agent-id="voice:stop"]').click();
  await expect(page.locator('[data-agent-id="voice:state"]')).toHaveText("Voice is off");

  await page.context().close();
});

test("voice asks the shop before it starts, and is told how it will run", async ({ browser }) => {
  const page = await freshPage(browser);
  await page.goto("/en", { waitUntil: "domcontentloaded" });

  const session = await page.request.post("/api/concierge/voice/session", {
    headers: { origin: new URL(page.url()).origin, "content-type": "application/json" },
    data: { locale: "el" },
  });
  expect(session.status()).toBe(200);
  const body = (await session.json()) as { ok: boolean; mode: string; locale: string; maxTurns: number };
  expect(body).toMatchObject({ ok: true, mode: "browser", locale: "el-GR" });
  expect(body.maxTurns).toBeGreaterThan(0);

  await page.context().close();
});

test("the spoken controls pass the accessibility checks", async ({ browser }) => {
  const page = await freshPage(browser, { country: "GR" });
  await withVoice(page);
  await page.locator('[data-agent-id="voice:start"]').click();
  await expect(page.locator('[data-agent-id="voice:state"]')).toHaveText("Listening", { timeout: 20_000 });

  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);

  await page.context().close();
});
