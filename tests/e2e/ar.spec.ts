/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * End-to-end tests for AR: what an Android phone and an iPhone are handed when the shopper taps "View in your space".
 */

import { expect, test, type Browser, type Page } from "@playwright/test";

import { E2E_COUNTRY_HEADER } from "../../playwright.config";
import { clientAddress, LAMP } from "./support/accounts";

/**
 * docs/adr/025, docs/adr/035, docs/adr/048. AR itself happens in the phone's
 * own viewer — Scene Viewer on Android, Quick Look on an iPhone — which no
 * browser test can open. What the shop controls is the hand-off, and that is
 * checked here, as each phone would receive it:
 *
 *   Android: an intent for Scene Viewer carrying the model's absolute https
 *   address, AR first, and `resizable=false` — the piece appears at its true
 *   size and cannot be pinched bigger or smaller.
 *
 *   iPhone: a USDZ file that model-viewer writes from the same model in the
 *   browser, opened with `allowsContentScaling=0` (true size again). The test
 *   checks it is a real USDZ: a zip archive whose first entry is a .usda scene.
 *
 * The phone in the hand is the last step, and George's: docs/report/ar-check.md.
 */

const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

async function phone(browser: Browser, userAgent: string): Promise<Page> {
  const context = await browser.newContext({ userAgent, hasTouch: true, extraHTTPHeaders: { "x-forwarded-for": clientAddress(), [E2E_COUNTRY_HEADER]: "GR" } });
  const page = await context.newPage();
  // Record what the viewer's AR link points at instead of leaving the page for the phone's AR app.
  await page.addInitScript(() => {
    const seen: { href: string; rel: string; bytes?: number[] }[] = [];
    (globalThis as { arHandoffs?: typeof seen }).arHandoffs = seen;
    // Quick Look is offered only where an <a> supports rel="ar", as Safari on an iPhone does.
    const supports = DOMTokenList.prototype.supports;
    DOMTokenList.prototype.supports = function (this: DOMTokenList, token: string) {
      return token === "ar" ? true : supports.call(this, token);
    };
    // The USDZ is a blob the viewer revokes right after the tap; keep it readable for the test.
    URL.revokeObjectURL = () => {};
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      const entry: { href: string; rel: string; bytes?: number[] } = { href: this.href, rel: this.rel };
      seen.push(entry);
      if (this.href.startsWith("blob:")) {
        void fetch(this.href)
          .then((response) => response.arrayBuffer())
          .then((buffer) => {
            entry.bytes = Array.from(new Uint8Array(buffer).slice(0, 120));
          });
      }
    };
  });
  return page;
}

async function tapViewInSpace(page: Page) {
  await page.goto(`${LAMP}?view=model`, { waitUntil: "domcontentloaded" });
  const viewer = page.locator('[data-agent-id="model:viewer"]');
  await expect(viewer).toBeVisible({ timeout: 30_000 });
  // The viewer shows its AR button only once it knows this phone can present AR.
  const button = page.locator('[data-agent-id="action:view-in-space"]');
  await expect(button).toBeVisible({ timeout: 30_000 });
  await button.click();
}

test.describe("AR hand-off", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "Scene Viewer and the USDZ export are checked in Chromium.");

  test("an Android phone is handed Scene Viewer, with the model's address, AR first and true scale", async ({ browser }) => {
    const page = await phone(browser, ANDROID);
    await tapViewInSpace(page);
    const handoff = await expect
      .poll(async () => page.evaluate(() => (globalThis as { arHandoffs?: { href: string }[] }).arHandoffs?.find((entry) => entry.href.startsWith("intent:"))?.href ?? null), { timeout: 20_000 })
      .not.toBeNull()
      .then(() => page.evaluate(() => (globalThis as { arHandoffs?: { href: string }[] }).arHandoffs!.find((entry) => entry.href.startsWith("intent:"))!.href));

    expect(handoff).toMatch(/^intent:\/\/arvr\.google\.com\/scene-viewer\/1\.2\?/);
    const query = new URLSearchParams(handoff.slice(handoff.indexOf("?") + 1, handoff.indexOf("#")));
    expect(query.get("mode")).toBe("ar_preferred");
    expect(query.get("resizable")).toBe("false");
    // An absolute address the phone's viewer can fetch: this shop's model of this lamp.
    const file = new URL(query.get("file")!);
    expect(file.pathname).toBe("/api/models/faux-wood-table-lamp-b07mbfd87n");
    expect(handoff).toContain("package=com.google.android.googlequicksearchbox");

    // The address Scene Viewer is given really is a binary glTF.
    const model = await page.request.get(file.pathname);
    expect(model.headers()["content-type"]).toContain("model/gltf-binary");
    expect(Buffer.from(await model.body()).subarray(0, 4).toString("latin1")).toBe("glTF");
    await page.context().close();
  });

  test("an iPhone is handed a real USDZ for Quick Look, at true scale", async ({ browser }) => {
    const page = await phone(browser, IPHONE);
    await tapViewInSpace(page);
    await expect
      .poll(async () => page.evaluate(() => (globalThis as { arHandoffs?: { rel: string; bytes?: number[] }[] }).arHandoffs?.find((entry) => entry.rel === "ar" && entry.bytes !== undefined)?.bytes?.length ?? 0), { timeout: 30_000 })
      .toBeGreaterThan(0);
    const handoff = await page.evaluate(() => (globalThis as { arHandoffs?: { href: string; rel: string; bytes?: number[] }[] }).arHandoffs!.find((entry) => entry.rel === "ar" && entry.bytes !== undefined)!);

    expect(handoff.href).toMatch(/^blob:/);
    // True size: Quick Look is told not to let the shopper scale the piece.
    expect(handoff.href).toContain("allowsContentScaling=0");
    const head = Buffer.from(handoff.bytes!);
    // A zip archive (PK\x03\x04) whose first file is the USD scene, as USDZ requires.
    expect(head.subarray(0, 4).toString("latin1")).toBe("PK\u0003\u0004");
    expect(head.toString("latin1")).toMatch(/\.usda/);
    await page.context().close();
  });
});
