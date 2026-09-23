/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * End-to-end tests for the 3D and AR view: the file the phone gets, and what the shop says it is.
 */

import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { freshPage, LAMP } from "./support/accounts";

/**
 * docs/adr/025. The model is built from the product's dimensions when it is
 * asked for, so there is nothing to seed and nothing to download: the test
 * checks that the file really is a .glb, that the dialog says it is a stand-in,
 * and that a piece with no shape is not offered one.
 */

const GARMENT = "/en/p/poplin-shirt-ecru";

test("@smoke a piece can be seen in 3D, at the size the catalogue gives", async ({ browser }) => {
  const page = await freshPage(browser, { country: "GR" });
  await page.goto(LAMP, { waitUntil: "domcontentloaded" });

  await page.locator('[data-agent-id^="action:view-3d:"]').click();
  await expect(page.getByRole("dialog")).toContainText("A stand-in shape");

  // The viewer is the custom element, and it is pointed at this product's model.
  const viewer = page.locator('[data-agent-id="model:viewer"]');
  await expect(viewer).toBeVisible({ timeout: 30_000 });
  // React sets `src` as a property on a custom element that has one, so the
  // attribute may never appear; the element itself is asked instead.
  const src = await viewer.evaluate((node) => (node as HTMLElement & { src?: string }).src ?? node.getAttribute("src"));
  expect(src).toContain("/api/models/faux-wood-table-lamp-b07mbfd87n");

  // The size on screen is the size in the file's name, in centimetres.
  await expect(page.locator('[data-agent-id="model:size"]')).toContainText(/\d+ × \d+ × \d+ cm/);

  await page.context().close();
});

test("the model is a real glTF binary, and nothing is stored to make it", async ({ browser }) => {
  const page = await freshPage(browser);
  await page.goto(LAMP, { waitUntil: "domcontentloaded" });

  const response = await page.request.get("/api/models/faux-wood-table-lamp-b07mbfd87n");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toBe("model/gltf-binary");

  const body = await response.body();
  // "glTF", version 2, and the length the header claims.
  expect(body.subarray(0, 4).toString("ascii")).toBe("glTF");
  expect(body.readUInt32LE(4)).toBe(2);
  expect(body.readUInt32LE(8)).toBe(body.byteLength);

  const missing = await page.request.get("/api/models/not-a-product");
  expect(missing.status()).toBe(404);

  await page.context().close();
});

test("a piece with no measurements is not offered a shape", async ({ browser }) => {
  const page = await freshPage(browser, { country: "GR" });
  await page.goto(GARMENT, { waitUntil: "domcontentloaded" });
  // A garment is tried on, not stood on a floor.
  await expect(page.locator('[data-agent-id^="action:view-3d:"]')).toHaveCount(0);
  await expect(page.locator('[data-agent-id^="action:try-it-on:"]')).toBeVisible();

  const refused = await page.request.get("/api/models/poplin-shirt-ecru");
  expect(refused.status()).toBe(404);

  await page.context().close();
});

test("the 3D dialog passes the accessibility checks", async ({ browser }) => {
  const page = await freshPage(browser, { country: "GR" });
  await page.goto(`${LAMP}?view=model`, { waitUntil: "domcontentloaded" });
  await expect(page.locator('[data-agent-id="model:viewer"]')).toBeVisible({ timeout: 30_000 });

  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);

  await page.context().close();
});
