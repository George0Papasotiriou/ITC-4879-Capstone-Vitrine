/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * End-to-end tests for the outfit builder: a look completed on a dress's page, the capsule wardrobe's form, and a colour reading from a photograph that never leaves the device.
 */

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";

import { FACE_OUTLINE, IRISES, LEFT_EYE_OUTLINE, RIGHT_EYE_OUTLINE } from "../../src/lib/vision/mirror/face-model";
import { irisDiameterPx } from "../../src/lib/vision/mirror/iris";
import { scriptedLandmarks } from "../../src/lib/vision/mirror/scripted";

/** docs/adr/066. */

test.describe.configure({ timeout: 120_000 });

const DRESS = "/en/p/boatneck-sleeveless-vintage-tea-dress-b016xucyzo";
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function ready(page: Page, path: string) {
  await expect(async () => {
    await page.goto(path, { waitUntil: "domcontentloaded" });
    await page.locator("html[data-concierge-ready]").waitFor({ timeout: 15_000 });
  }).toPass({ timeout: 50_000 });
}

/**
 * A drawn face where the scripted landmarks put one: golden skin, white eyes
 * with brown irises, light brown hair above the forehead (the same drawing
 * the unit tests read as spring).
 */
async function drawnFace(): Promise<Buffer> {
  const width = 640;
  const height = 480;
  const points = scriptedLandmarks({ yaw: 0, pitch: 0, roll: 0, distanceMm: 450, size: 1 }, width, height);
  const faceWidth = points[454]![0] - points[234]![0];
  const polygon = (outline: readonly number[]) => outline.map((k) => points[k]!.join(",")).join(" ");
  const hair = FACE_OUTLINE.slice(0, 4)
    .concat(FACE_OUTLINE.slice(-4))
    .map((k) => `<circle cx="${points[k]![0]}" cy="${points[k]![1] - faceWidth * 0.1}" r="${faceWidth * 0.07}" fill="rgb(190,150,90)"/>`)
    .join("");
  const irises = IRISES.map((iris) => `<circle cx="${points[iris.centre]![0]}" cy="${points[iris.centre]![1]}" r="${irisDiameterPx(points, iris)! / 2}" fill="rgb(90,60,40)"/>`).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect width="${width}" height="${height}" fill="rgb(226,186,150)"/>${hair}
    <polygon points="${polygon(RIGHT_EYE_OUTLINE)}" fill="rgb(220,220,216)"/><polygon points="${polygon(LEFT_EYE_OUTLINE)}" fill="rgb(220,220,216)"/>${irises}
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

test("a dress's page completes the look with shoes for the same person, and says what the whole look costs", async ({ page }) => {
  await ready(page, DRESS);
  const look = page.locator('[data-agent-id="look:complete"]');
  await expect(look).toBeVisible();
  await expect(look.locator("h2")).toHaveText("Complete the look");
  await expect(look.locator('[data-agent-id="look:total"]')).toContainText(/The whole look, \d pieces: €/);
  // The dress is not repeated; the sandals (for anyone) or a women's piece complete it, never a men's.
  await expect(look.locator('a[href*="/p/"]').first()).toBeVisible();
  await expect(look.locator('a[href^="/en/p/men-s-"]')).toHaveCount(0);
});

test("the capsule wardrobe's form asks who it is for, the budget and the size, and says honestly when it cannot be done", async ({ page }) => {
  await ready(page, "/en/capsule");
  const results = await new AxeBuilder({ page }).include('[data-agent-id="capsule:form"]').withTags(TAGS).analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);
  await page.locator('label:has([data-agent-id="capsule:for:men"])').click();
  await page.locator('[data-agent-id="capsule:budget"]').selectOption("300");
  await page.locator('[data-agent-id="capsule:build"]').click();
  await expect(page).toHaveURL(/\/en\/capsule\?for=men&budget=300&size=small$/);
  // The test shop stocks no men's trousers, so no men's capsule can be made from it.
  await expect(page.locator('[data-agent-id="capsule:none"]')).toContainText("cannot buy a capsule of this size");
});

test("a colour reading from a photograph is made on the device, suggests colours to shop, and keeps them only when asked", async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { vitrineMirrorScripted: boolean; vitrineMirrorFace: unknown }).vitrineMirrorScripted = true;
    (window as unknown as { vitrineMirrorFace: unknown }).vitrineMirrorFace = { yaw: 0, pitch: 0, roll: 0, distanceMm: 450, size: 1 };
  });
  // Every request that carries a body. The page's own comfort sync (the Aa
  // settings, once per visit) is not about the photograph and is left out.
  const bodies: { path: string; bytes: number }[] = [];
  page.on("request", (request) => {
    if (request.method() !== "GET" && request.method() !== "HEAD") bodies.push({ path: new URL(request.url()).pathname, bytes: request.postDataBuffer()?.length ?? 0 });
  });
  const sent = () => bodies.filter((entry) => entry.path !== "/api/preferences/sync").map((entry) => entry.path);
  const large = () => bodies.filter((entry) => entry.bytes > 2_048);
  await ready(page, "/en/colours");
  await expect(page.locator('[data-agent-id="colours:intro"]')).toContainText("never sent or kept");
  await page.locator('[data-agent-id="colours:photo"]').setInputFiles({ name: "me.png", mimeType: "image/png", buffer: await drawnFace() });
  const result = page.locator('[data-agent-id="colours:result"]');
  await expect(result).toHaveAttribute("data-season", "spring");
  await expect(result.locator("h2")).toHaveText("Spring");
  await expect(page.locator('[data-agent-id="colours:shop:yellow"]')).toHaveAttribute("href", "/en/c/wear?color=yellow");
  // Nothing about the photograph was sent: no request, and no body the size of a picture.
  expect(sent()).toEqual([]);
  expect(large()).toEqual([]);

  await page.locator('[data-agent-id="colours:keep"]').click();
  await expect(page.locator('[data-agent-id="colours:kept"]')).toContainText("Kept in Your shop");
  const kept = (await (await page.request.get("/api/preferences")).json()) as { preferences: { like: { colors: string[] }; avoid: { colors: string[] } } };
  expect(kept.preferences.like.colors).toContain("yellow");
  expect(kept.preferences.avoid.colors).toContain("black");
  expect(sent()).toEqual(["/api/preferences"]);
  expect(large()).toEqual([]);
});

test("a refused camera is explained on the colour reading, and a photograph remains", async ({ page }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      throw new DOMException("Permission denied", "NotAllowedError");
    };
  });
  await ready(page, "/en/colours");
  await page.locator('[data-agent-id="colours:camera"]').click();
  await expect(page.locator('[data-agent-id="colours:problem"]')).toContainText("The camera was not allowed");
  await expect(page.locator('[data-agent-id="colours:photo"]')).toBeAttached();
});
