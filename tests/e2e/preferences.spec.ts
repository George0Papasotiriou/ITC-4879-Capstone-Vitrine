/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * End-to-end tests for personal preferences: told once and used everywhere, remembered by the Concierge only with approval, and shown and deleted line by line.
 */

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { freshPage, signUpAndConfirm } from "./support/accounts";

/** docs/adr/033. */

test.describe.configure({ timeout: 120_000 });

const TEE = "/en/p/heavy-cotton-tee-ecru";
const SOFA = "/en/p/westview-extra-deep-down-filled-leather-sofa-couch-b082vlyqwx";
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function ready(page: Page, path: string) {
  await expect(async () => {
    await page.goto(path, { waitUntil: "domcontentloaded" });
    await page.locator("html[data-concierge-ready]").waitFor({ timeout: 15_000 });
  }).toPass({ timeout: 50_000 });
}

const preferences = async (page: Page) => ((await (await page.request.get("/api/preferences")).json()) as { preferences: { sizes: Record<string, string>; rooms: { name: string }[] }; source: string }).preferences;

test("@smoke told once, used everywhere: the size picker starts at your size and a sofa says whether it fits your room", async ({ browser }) => {
  const page = await freshPage(browser, { country: "GR" });
  await ready(page, "/en/account/preferences");
  await expect(page.locator('[data-agent-id="prefs:kept"]')).toContainText("this device");

  await page.locator('[data-agent-id="prefs:size:upper:M"]').click();
  await expect(page.locator('[data-agent-id="prefs:size:upper:M"]')).toHaveAttribute("aria-pressed", "true");
  const room = page.locator('[data-agent-id="prefs:add-room"]');
  for (const [name, wall] of [["Living room", "260"], ["Hall", "150"]] as const) {
    await room.getByLabel("Room").fill(name);
    await room.getByLabel("Wall, cm").fill(wall);
    await room.getByRole("button", { name: "Add room" }).click();
    await expect(page.locator('[data-agent-id="prefs:rooms"]')).toContainText(name);
  }
  await page.locator('[data-agent-id="prefs:like:colors:green"]').click();
  await expect(page.locator('[data-agent-id="prefs:like:colors:green"]')).toHaveAttribute("aria-pressed", "true");

  const results = await new AxeBuilder({ page }).include("main").withTags(TAGS).analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);

  // A top starts at size M, and says why.
  await ready(page, TEE);
  await expect(page.locator('[data-agent-id="size:M"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-agent-id="sizes:yours"]')).toContainText("Your size, M");

  // A 226 cm sofa, with 20 cm to walk past: it fits a 260 cm wall, not a 150 cm one.
  await ready(page, SOFA);
  const fit = page.locator('[data-agent-id="product:room-fit"]');
  await expect(fit).toContainText("Fits your Living room wall (260 cm)");
  await expect(fit).toContainText("Too big for your Hall (150 cm wall)");
  await page.context().close();
});

test("what the shop knows is shown line by line, each can be deleted, and all of it downloaded", async ({ browser }) => {
  const page = await freshPage(browser, { country: "GR" });
  await ready(page, "/en/account/preferences");
  await page.locator('[data-agent-id="prefs:size:lower:L"]').click();
  await expect(page.locator('[data-agent-id="prefs:size:lower:L"]')).toHaveAttribute("aria-pressed", "true");

  await ready(page, "/en/account/data");
  const listed = page.locator('[data-agent-id="ledger:preferences"]');
  await expect(listed).toContainText("Size L for trousers and skirts");

  // The download is the same data, as a file.
  const file = await page.request.get("/api/my-data");
  expect(file.headers()["content-disposition"]).toContain("attachment");
  expect((await file.json()) as { preferences: { sizes: Record<string, string> } }).toMatchObject({ preferences: { sizes: { lower: "L" } } });

  const results = await new AxeBuilder({ page }).include("main").withTags(TAGS).analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);

  // One line deleted, and it is gone from where it was kept.
  await page.locator('[data-agent-id="ledger:remove:size-lower"]').click();
  await expect(page.locator('[data-agent-id="ledger:preferences-empty"]')).toBeVisible({ timeout: 15_000 });
  expect((await preferences(page)).sizes).toEqual({});

  // Everything, after one question in words.
  await ready(page, "/en/account/preferences");
  await page.locator('[data-agent-id="prefs:size:dress:S"]').click();
  await expect(page.locator('[data-agent-id="prefs:size:dress:S"]')).toHaveAttribute("aria-pressed", "true");
  await ready(page, "/en/account/data");
  await page.locator('[data-agent-id="ledger:delete-everything"]').click();
  await page.locator('[data-agent-id="ledger:confirm-delete"]').click();
  await expect(page.locator('[data-agent-id="ledger:preferences-empty"]')).toBeVisible({ timeout: 15_000 });
  expect((await preferences(page)).sizes).toEqual({});
  await page.context().close();
});

test("the Concierge keeps a size only after the shopper approves exactly what it will keep, and it can be undone", async ({ browser }) => {
  const page = await freshPage(browser, { country: "GR" });
  await ready(page, "/en");
  await page.locator('[data-agent-id="nav:concierge-panel"]:visible, [data-agent-id="nav:concierge"]:visible').first().click();
  await page.locator('[data-agent-id="concierge:input"]').fill("I'm a medium");
  await page.locator('[data-agent-id="concierge:send"]').click();

  const card = page.locator('[data-agent-id="concierge:approval:remember_preference"]');
  await expect(card).toBeVisible({ timeout: 20_000 });
  await expect(card.locator('[data-agent-id="concierge:remember-summary"]')).toContainText("Size M for tops, shirts, knitwear and coats");
  // Nothing is kept before the answer.
  expect((await preferences(page)).sizes).toEqual({});

  await card.locator('[data-agent-id="concierge:approve"]').click();
  await expect.poll(async () => (await preferences(page)).sizes, { timeout: 20_000 }).toEqual({ upper: "M", lower: "M", dress: "M" });

  // On the actions list, with its undo.
  await page.getByRole("button", { name: /Undo/ }).last().click();
  await expect.poll(async () => (await preferences(page)).sizes, { timeout: 15_000 }).toEqual({});
  await page.context().close();
});

test("signing up carries a guest's preferences into the new account, and they leave the device", async ({ browser }, info) => {
  const page = await freshPage(browser, { country: "GR" });
  await ready(page, "/en/account/preferences");
  await page.locator('[data-agent-id="prefs:size:upper:S"]').click();
  await expect(page.locator('[data-agent-id="prefs:size:upper:S"]')).toHaveAttribute("aria-pressed", "true");

  await signUpAndConfirm(page, `prefs-${info.project.name}-${Date.now()}@example.com`);
  // The confirmed account's first page moves them over.
  await expect.poll(async () => (await page.context().cookies()).some((cookie) => cookie.name === "vt_prefs"), { timeout: 20_000 }).toBe(false);
  const kept = (await (await page.request.get("/api/preferences")).json()) as { source: string; preferences: { sizes: Record<string, string> } };
  expect(kept).toMatchObject({ source: "account", preferences: { sizes: { upper: "S" } } });
  await page.context().close();
});
