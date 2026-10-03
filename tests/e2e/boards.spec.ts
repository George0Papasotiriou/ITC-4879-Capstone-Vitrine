/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * End-to-end tests for room boards: made from a piece, shared by link, changed together live, and kept apart by role.
 */

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";

import { freshPage } from "./support/accounts";

/**
 * docs/adr/056. Two browsers are two people: the owner shares the edit link,
 * the friend changes the board, and the owner's page — never reloaded — shows
 * the change and says two people are here. A view link sees the board but not
 * its controls; new links retire the old ones.
 */

test.describe.configure({ timeout: 120_000 });

const SOFA = "canova-3-seater-maxi-b07g2h3l4l";
const LAMP = "faux-wood-table-lamp-b07mbfd87n";

/** A guest starts a board from a piece's page and opens it. */
async function startBoard(browser: Browser, name: string): Promise<Page> {
  const page = await freshPage(browser, { country: "GR" });
  await page.goto(`/en/p/${SOFA}`, { waitUntil: "domcontentloaded" });
  await page.locator('[data-agent-id^="action:add-to-board:"]').click();
  await page.locator('[data-agent-id="board:add-new-name"]').fill(name);
  await page.locator('[data-agent-id="board:add-new"]').click();
  await expect(page.locator('[data-agent-id="board:add-result"]')).toContainText(`Added to ${name}`);
  await page.locator('[data-agent-id="board:add-result"] a').click();
  await expect(page.locator('[data-agent-id="board:title"]')).toHaveText(name);
  return page;
}

test("@smoke a board shared by its edit link is changed together, live, and both see who is here", async ({ browser }) => {
  const owner = await startBoard(browser, "Living room");
  await expect(owner.locator(`[data-agent-id="board:piece:${SOFA}"]`)).toBeVisible();
  const editLink = await owner.locator('[data-agent-id="board:link:edit"]').inputValue();
  expect(editLink).toMatch(/\/en\/b\/[0-9a-f-]{36}\?k=[A-Za-z0-9_-]{32}$/);
  await expect(owner.locator('[data-agent-id="board:presence"]')).toContainText("Live", { timeout: 15_000 });

  const friend = await freshPage(browser, { country: "GR" });
  await friend.goto(editLink, { waitUntil: "domcontentloaded" });
  await expect(friend.locator('[data-agent-id="board:title"]')).toHaveText("Living room");
  await expect(friend.getByText("You can change this board with its owner.")).toBeVisible();
  // The owner's page counts the friend without being reloaded.
  await expect(owner.locator('[data-agent-id="board:presence"]')).toContainText("2 people here", { timeout: 20_000 });

  await friend.locator(`[data-agent-id="board:more:${SOFA}"]`).click();
  await expect(owner.locator(`[data-agent-id="board:piece:${SOFA}"]`)).toContainText("2 ×", { timeout: 15_000 });
  await friend.locator(`[data-agent-id="board:note:${SOFA}"]`).fill("under the window");
  await friend.locator(`[data-agent-id="board:note:${SOFA}"]`).blur();
  await expect(owner.locator(`[data-agent-id="board:note:${SOFA}"]`)).toHaveValue("under the window", { timeout: 15_000 });

  // The friend leaves; the owner is alone again.
  await friend.context().close();
  await expect(owner.locator('[data-agent-id="board:presence"]')).toContainText("Only you here", { timeout: 20_000 });
  await owner.context().close();
});

test("a view link shows the board without its controls, and its pieces go into the visitor's own cart", async ({ browser }) => {
  const owner = await startBoard(browser, "Reading corner");
  const viewLink = await owner.locator('[data-agent-id="board:link:view"]').inputValue();

  const visitor = await freshPage(browser, { country: "GR" });
  await visitor.goto(viewLink, { waitUntil: "domcontentloaded" });
  await expect(visitor.locator(`[data-agent-id="board:piece:${SOFA}"]`)).toBeVisible();
  await expect(visitor.getByText("You can look at this board.", { exact: false })).toBeVisible();
  await expect(visitor.locator(`[data-agent-id="board:remove:${SOFA}"]`)).toHaveCount(0);
  await expect(visitor.locator('[data-agent-id="board:share"]')).toHaveCount(0);
  // The API agrees with the page: a view link cannot change the board.
  const id = new URL(viewLink).pathname.split("/").at(-1);
  const refused = await visitor.request.patch(`/api/boards/${id}${new URL(viewLink).search}`, { data: { title: "Mine now" } });
  expect(refused.status()).toBe(403);

  // The board's total and its button stay reachable from the top of the page: on a phone, above the bottom bar.
  const reachable = await visitor.locator('[data-agent-id="board:add-all"]').evaluate((button) => {
    const box = button.getBoundingClientRect();
    return button.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2));
  });
  expect(reachable).toBe(true);
  await visitor.locator('[data-agent-id="board:add-all"]').click();
  await expect(visitor.locator('[data-agent-id="board:cart-note"]')).toContainText("1 piece added to your cart");
  const cart = (await (await visitor.request.get("/api/cart?locale=en")).json()) as { itemCount: number };
  expect(cart.itemCount).toBe(1);

  // New links: the old one stops working at once.
  await owner.locator('[data-agent-id="board:new-links"]').click();
  await expect(owner.locator('[data-agent-id="board:link:view"]')).not.toHaveValue(viewLink, { timeout: 10_000 });
  const old = await visitor.goto(viewLink, { waitUntil: "domcontentloaded" });
  expect(old?.status()).toBe(404);
  await visitor.context().close();
  await owner.context().close();
});

test("the owner arranges the board: pieces reordered, removed and put back, the board renamed", async ({ browser }) => {
  const owner = await startBoard(browser, "Hall");
  // A second piece, from its own page.
  await owner.goto(`/en/p/${LAMP}`, { waitUntil: "domcontentloaded" });
  await owner.locator('[data-agent-id^="action:add-to-board:"]').click();
  await owner.locator('[data-agent-id^="board:add-to:"]').first().click();
  await expect(owner.locator('[data-agent-id="board:add-result"]')).toContainText("Added to Hall");
  await owner.locator('[data-agent-id="board:add-result"] a').click();

  const order = () => owner.locator('[data-agent-id^="board:piece:"]').evaluateAll((items) => items.map((item) => item.getAttribute("data-agent-id")));
  await expect.poll(order).toEqual([`board:piece:${SOFA}`, `board:piece:${LAMP}`]);
  await owner.locator(`[data-agent-id="board:earlier:${LAMP}"]`).click();
  await expect.poll(order).toEqual([`board:piece:${LAMP}`, `board:piece:${SOFA}`]);

  await owner.locator(`[data-agent-id="board:remove:${LAMP}"]`).click();
  await expect.poll(order).toEqual([`board:piece:${SOFA}`]);
  await owner.locator('[data-agent-id="board:undo"]').click();
  await expect.poll(order).toEqual([`board:piece:${LAMP}`, `board:piece:${SOFA}`]);

  await owner.locator('[data-agent-id="board:rename"]').click();
  // Renaming never pushes the page sideways, on a phone either.
  expect(await owner.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await owner.locator('[data-agent-id="board:title-input"]').fill("Front hall");
  await owner.locator('[data-agent-id="board:title-save"]').click();
  await expect(owner.locator('[data-agent-id="board:title"]')).toHaveText("Front hall");

  await owner.goto("/en/boards", { waitUntil: "domcontentloaded" });
  await expect(owner.locator('[data-agent-id="boards:list"]')).toContainText("Front hall");
  await expect(owner.locator('[data-agent-id="boards:list"]')).toContainText("2 pieces");
  await owner.context().close();
});

test("the Concierge puts a piece on a board, and its undo takes it off", async ({ browser }) => {
  const page = await freshPage(browser, { country: "GR" });
  await page.goto("/en", { waitUntil: "domcontentloaded" });
  await page.locator("html[data-concierge-ready]").waitFor({ timeout: 30_000 });
  await page.locator('[data-agent-id="nav:concierge-panel"]:visible, [data-agent-id="nav:concierge"]:visible').first().click();
  await page.locator('[data-agent-id="concierge:input"]').fill("Add the Canova sofa to my living room board");
  await page.locator('[data-agent-id="concierge:send"]').click();
  const card = page.locator('[data-agent-id="concierge:board"]');
  await expect(card).toContainText("on “living room”", { timeout: 30_000 });
  const href = await card.locator("a").getAttribute("href");
  const boardId = href!.split("/").at(-1)!;
  const pieces = async () => ((await (await page.request.get(`/api/boards/${boardId}?locale=en`)).json()) as { board: { pieces: unknown[] } }).board.pieces.length;
  expect(await pieces()).toBe(1);

  await page.locator('[data-agent-id="concierge:log"]').getByRole("button", { name: "Undo" }).click();
  await expect.poll(pieces).toBe(0);
  await page.context().close();
});

test("a board passes axe, for its owner and through a view link", async ({ browser }) => {
  const owner = await startBoard(browser, "Study");
  const audit = async (page: Page) => (await new AxeBuilder({ page }).include('[data-agent-id="board:page"]').analyze()).violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`);
  expect(await audit(owner)).toEqual([]);
  const viewLink = await owner.locator('[data-agent-id="board:link:view"]').inputValue();
  const visitor = await freshPage(browser, { country: "GR" });
  await visitor.goto(viewLink, { waitUntil: "domcontentloaded" });
  await expect(visitor.locator('[data-agent-id="board:title"]')).toBeVisible();
  expect(await audit(visitor)).toEqual([]);
  await visitor.context().close();
  await owner.context().close();
});
