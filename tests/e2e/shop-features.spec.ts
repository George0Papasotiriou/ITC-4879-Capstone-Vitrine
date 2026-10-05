/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * End-to-end tests for the shop features of docs/adr/034: instant search, size advice, complete the set, rooms, price drops, staff products and the dashboards.
 */

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

import { TEST_DB_PORT } from "../../playwright.config";
import { addLampToCart, freshPage, LAMP, signUpAndConfirm, uniqueEmail } from "./support/accounts";
import { signInAdmin } from "./support/orders";

/** docs/adr/034. */

test.describe.configure({ timeout: 120_000 });

/** A real tee from the clothes specimen (docs/adr/062): a top, with M in stock. */
const TEE = "/en/p/short-sleeve-pocket-tee-b00blo0cqq";
const SOFA = "canova-3-seater-maxi-b07g2h3l4l";
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function ready(page: Page, path: string) {
  await expect(async () => {
    await page.goto(path, { waitUntil: "domcontentloaded" });
    await page.locator("html[data-concierge-ready]").waitFor({ timeout: 15_000 });
  }).toPass({ timeout: 50_000 });
}

async function axe(page: Page, selector: string) {
  const results = await new AxeBuilder({ page }).include(selector).withTags(TAGS).analyze();
  expect(results.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`)).toEqual([]);
}

test("@smoke instant search: results while typing, arrows and Enter open a piece, and recent searches stay on the device", async ({ browser }) => {
  const page = await freshPage(browser, { country: "GR" });
  await ready(page, "/en");
  const trigger = page.locator('header [data-agent-id="nav:search"]');
  const field = page.locator('[data-agent-id="input:instant-search"]');
  await expect(async () => {
    await trigger.click({ timeout: 2_000 });
    await expect(field).toBeFocused({ timeout: 3_000 });
  }).toPass({ timeout: 20_000 });

  await field.fill("lamp");
  const options = page.locator('[data-agent-id="search:instant"] [role="option"]');
  await expect(options.first()).toBeVisible();
  await expect(page.locator('[data-agent-id="search:see-all"]')).toContainText("lamp");
  await axe(page, '[data-agent-id="search:instant"]');

  await field.press("ArrowDown");
  await expect(options.first()).toHaveAttribute("aria-selected", "true");
  await expect(field).toHaveAttribute("aria-activedescendant", (await options.first().getAttribute("id"))!);
  await field.press("Enter");
  await expect(page).toHaveURL(/\/en\/p\//);

  // Kept on this device only, newest first.
  await trigger.click();
  await expect(page.locator('[data-agent-id="search:recent-0"]')).toHaveText("lamp");
  await page.keyboard.press("Escape");
  await expect(field).toHaveCount(0);
  await expect(trigger).toBeFocused();

  // The "/" shortcut opens it too; Enter with nothing chosen searches in full.
  await page.keyboard.press("/");
  await expect(field).toBeFocused();
  await field.fill("oak table");
  await field.press("Enter");
  await expect(page).toHaveURL(/\/en\/search\?q=oak\+table/);

  // Clearing forgets them.
  await trigger.click();
  await page.locator('[data-agent-id="search:forget-recent"]').click();
  await expect(page.locator('[data-agent-id="search:recent-0"]')).toHaveCount(0);
  await page.context().close();
});

test("find your size: two measurements give a size with the reason, which can be chosen and kept", async ({ browser }) => {
  const page = await freshPage(browser, { country: "GR" });
  await ready(page, TEE);
  await page.locator('[data-agent-id="sizes:finder"]').click();
  const dialog = page.locator('[data-agent-id="sizes:finder-dialog"]');
  await expect(dialog.locator('[data-agent-id="sizes:advice"]')).toContainText("Type a measurement");

  // Chest 95 fits M, waist 88 needs L: the larger wins, and the dialog says which measurement decided.
  await dialog.locator('[data-agent-id="sizes:measure-0"]').fill("95");
  await dialog.locator('[data-agent-id="sizes:measure-1"]').fill("88");
  await expect(dialog.locator('[data-agent-id="sizes:advised"]')).toHaveText("L");
  await expect(dialog.locator('[data-agent-id="sizes:advice"]')).toContainText("Waist 88 cm fits L (up to 90 cm).");
  await expect(dialog.locator('[data-agent-id="sizes:advice"]')).toContainText("closes around your waist");
  await axe(page, '[role="dialog"]');

  // Inches are caught rather than sized.
  await dialog.locator('[data-agent-id="sizes:measure-0"]').fill("38");
  await expect(dialog.locator('[data-agent-id="sizes:advice"]')).toContainText("multiply by 2.54");
  await dialog.locator('[data-agent-id="sizes:measure-0"]').fill("95");

  await dialog.locator('[data-agent-id="sizes:keep-advised"]').click();
  await expect(dialog).toContainText("Kept in Your shop");
  await dialog.locator('[data-agent-id="sizes:choose-advised"]').click();
  await expect(page.locator('[data-agent-id="size:L"]')).toHaveAttribute("aria-pressed", "true");
  const kept = (await (await page.request.get("/api/preferences")).json()) as { preferences: { sizes: Record<string, string> } };
  expect(kept.preferences.sizes.upper).toBe("L");
  await page.context().close();
});

test("the cart suggests pieces that complete the set, each with the piece it goes with", async ({ browser }) => {
  // The test shop has no shopping history, so its neighbour lists are look-alikes only (lamps next to
  // lamps). Two "bought together" lists are written for the lamp, as the nightly rebuild would from sales.
  test.skip(process.env.BASE_URL !== undefined, "needs the local test database");
  const sql = postgres(`postgres://postgres:postgres@127.0.0.1:${TEST_DB_PORT}/postgres`, { max: 1, onnotice: () => {} });
  try {
    await sql`
      INSERT INTO item_neighbors (product_id, kind, neighbor_id, score, rank)
      SELECT lamp.id, 'behavior', other.id, 0.5, other.rank
      FROM (SELECT id FROM products WHERE slug = 'faux-wood-table-lamp-b07mbfd87n') lamp,
           (SELECT DISTINCT ON (c.slug) p.id, CASE c.slug WHEN 'seating' THEN 1 ELSE 2 END AS rank
              FROM products p JOIN categories c ON c.id = p.category_id
              WHERE c.slug IN ('seating', 'tables') AND p.status = 'active'
                AND EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id AND v.stock > 0)
              ORDER BY c.slug, p.source_id) other
      ON CONFLICT DO NOTHING
    `;
  } finally {
    await sql.end();
  }
  const page = await freshPage(browser, { country: "GR" });
  await addLampToCart(page);
  await ready(page, "/en/cart");
  const shelf = page.locator('[data-agent-id="cart:complete-set"]');
  await expect(shelf).toBeVisible();
  await expect(shelf.locator('[data-agent-id^="product:"]').first()).toBeVisible();
  await expect(shelf).toContainText("Goes with Faux Wood Table Lamp");
  // Up to four, one per category (complements, never more lamps: tests/integration/shop-features.test.ts).
  expect(await shelf.locator('[data-agent-id^="product:"]').count()).toBeLessThanOrEqual(4);
  await axe(page, '[data-agent-id="cart:complete-set"]');
  await page.context().close();
});

test("a room saved beside the planner is used everywhere: the planner says what fits, the home page shows what fits", async ({ browser }) => {
  const page = await freshPage(browser, { country: "GR" });
  await ready(page, `/en/room?product=${SOFA}`);
  const rooms = page.locator('[data-agent-id="room:your-rooms"]');
  await expect(rooms.locator('[data-agent-id="room:no-rooms"]')).toBeVisible();
  await rooms.locator('[data-agent-id="room:save-name"]').fill("Living room");
  await rooms.locator('[data-agent-id="room:save-wall"]').fill("330");
  await rooms.locator('[data-agent-id="room:save"]').click();
  await expect(rooms.locator('[data-agent-id="room:fits"]')).toContainText("Living room");
  await expect(rooms.locator('[data-agent-id="room:fits"]')).toContainText("Fits the 330 cm wall");
  // The same name again corrects the room rather than adding a second one.
  await rooms.locator('[data-agent-id="room:save-name"]').fill("living room");
  await rooms.locator('[data-agent-id="room:save-wall"]').fill("120");
  await rooms.locator('[data-agent-id="room:save"]').click();
  await expect(rooms.locator('[data-agent-id="room:fits"]')).toContainText("Too wide for the 120 cm wall");
  await expect(rooms.locator('[data-agent-id="room:fits"] li')).toHaveCount(1);
  await axe(page, '[data-agent-id="room:your-rooms"]');

  await rooms.locator('[data-agent-id="room:save-name"]').fill("Study");
  await rooms.locator('[data-agent-id="room:save-wall"]').fill("260");
  await rooms.locator('[data-agent-id="room:save"]').click();
  await expect(rooms.locator('[data-agent-id="room:fits"] li')).toHaveCount(2);

  await ready(page, "/en");
  const shelf = page.locator('[data-agent-id="home:fits-your-space"]');
  await expect(shelf).toBeVisible();
  await expect(shelf).toContainText(/Fits the (living room|Study) wall/);
  await page.context().close();
});

test("a watched price that dropped shows as a quiet dot and a notice, then goes once seen", async ({ browser }) => {
  // The nightly pass itself is tested against the database (tests/integration/price-watches.test.ts);
  // here its result is written straight into the local test database, which a deployed shop does not offer.
  test.skip(process.env.BASE_URL !== undefined, "needs the local test database");
  const page = await freshPage(browser, { country: "GR" });
  await signUpAndConfirm(page, uniqueEmail("dropper"));
  await ready(page, LAMP);
  const productId = (await page.locator('[data-agent-id^="product-detail:"]').getAttribute("data-agent-id"))!.split(":")[1]!;
  expect((await page.request.post("/api/watch", { data: { action: "set", productId, targetCents: 100, locale: "en" } })).ok()).toBe(true);

  const sql = postgres(`postgres://postgres:postgres@127.0.0.1:${TEST_DB_PORT}/postgres`, { max: 1, onnotice: () => {} });
  try {
    // As if the price had reached the target and the pass had emailed: the product's own price is left alone.
    await sql`UPDATE price_watches w SET target_cents = p.price_cents, notified_at = now() FROM products p WHERE p.id = w.product_id AND w.product_id = ${productId} AND w.target_cents = 100`;
  } finally {
    await sql.end();
  }

  await ready(page, "/en/c");
  await expect(page.locator('header [data-agent-id="nav:price-drops"]')).toBeAttached();
  await expect(page.locator('header [data-agent-id="nav:account"]')).toContainText("1 price drop");
  await ready(page, "/en/account");
  const notice = page.locator('[data-agent-id="account:drops"]');
  await expect(notice).toContainText("A price you were waiting for");
  await expect(notice).toContainText("Faux Wood Table Lamp");
  // Seen: the dot goes at once, and the notice is not shown again.
  await expect(page.locator('header [data-agent-id="nav:price-drops"]')).toHaveCount(0);
  await ready(page, "/en/account");
  await expect(page.locator('[data-agent-id="account:drops"]')).toHaveCount(0);
  await page.context().close();
});

test("staff make a product as a draft, add its photograph and publish it", async ({ browser }, info) => {
  const page = await freshPage(browser, { country: "GR" });
  await signInAdmin(page, info);
  await ready(page, "/en/staff/products/new");
  const title = `Oak sideboard ${Date.now()} ${info.project.name}`;
  await page.locator('[data-agent-id="product-new:kind"]').selectOption("CABINET");
  await page.locator('[data-agent-id="product-new:titleEn"]').fill(title);
  await page.locator('[data-agent-id="product-new:price"]').fill("689");
  await page.locator('[data-agent-id="product-new:stock"]').fill("3");
  // Measurements are all three or none.
  await page.locator('[data-agent-id="product-new:width"]').fill("160");
  await page.locator('[data-agent-id="product-new:create"]').click();
  await expect(page.locator('[data-agent-id="product-new:form"]')).toContainText("Give all three measurements, or none.");
  await page.locator('[data-agent-id="product-new:depth"]').fill("45");
  await page.locator('[data-agent-id="product-new:height"]').fill("80");
  await axe(page, "main");
  await page.locator('[data-agent-id="product-new:create"]').click();

  await expect(page).toHaveURL(/\/en\/staff\/products\/[0-9a-f-]{36}\?created=1/, { timeout: 15_000 });
  await expect(page.locator('[data-agent-id="product-edit:created"]')).toBeVisible();
  await expect(page.locator('[data-agent-id="product-edit:no-photos"]')).toBeVisible();

  // Publishing without a photograph is refused, and says why.
  await page.locator('[data-agent-id="product-edit:status:active"]').check();
  await page.locator('[data-agent-id="product-edit:save"]').click();
  await expect(page.locator('[data-agent-id="form:error"]')).toContainText("only with a photograph");

  await page.locator('[data-agent-id="product-edit:photo-file"]').setInputFiles("tests/e2e/fixtures/room-scene.webp");
  await expect(page.locator('[data-agent-id="product-edit:photo-status"]')).toContainText("Photograph added", { timeout: 20_000 });
  await expect(page.locator('[data-agent-id="product-edit:photos"] img')).toHaveCount(1);

  await page.locator('[data-agent-id="product-edit:status:active"]').check();
  await page.locator('[data-agent-id="product-edit:save"]').click();
  await expect(page.getByText("Saved. The shop shows the change now.", { exact: true })).toBeVisible();
  const href = await page.getByRole("link", { name: "See it in the shop" }).getAttribute("href");
  await ready(page, href!);
  await expect(page.locator("h1")).toHaveText(title);
  await page.context().close();
});

test("the Concierge and recommendation dashboards count what happened, without words", async ({ browser }, info) => {
  // A shopper uses the Concierge and a shelf.
  const shopper = await freshPage(browser, { country: "GR" });
  await ready(shopper, "/en");
  const shelf = shopper.locator('[data-shelf="popular"], [data-shelf="for-you"]').first();
  await shelf.scrollIntoViewIfNeeded();
  // The batch goes a few seconds later, or when the page is hidden.
  const sent = shopper.waitForResponse((response) => response.url().endsWith("/api/reco-events"), { timeout: 20_000 });
  await shelf.locator('[data-agent-id^="product:"] a').first().click();
  await expect(shopper).toHaveURL(/\/en\/p\//);
  expect((await sent).status()).toBe(204);
  await shopper.context().close();

  const admin = await freshPage(browser, { country: "GR" });
  await signInAdmin(admin, info);
  await expect(async () => {
    await admin.goto("/en/admin/recommendations?days=7", { waitUntil: "domcontentloaded" });
    await expect(admin.locator('[data-agent-id="reco:shelves"]')).toContainText(/Popular|For you/, { timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  await axe(admin, "main");

  await ready(admin, "/en/admin/concierge?days=7");
  await expect(admin.locator('[data-agent-id="concierge:turns"]')).toBeVisible();
  await expect(admin.locator('[data-agent-id="concierge:cost-per-turn"]')).toContainText("Cost per turn");
  await axe(admin, "main");
  const csv = await admin.request.get("/api/admin/export/concierge?days=7");
  expect(csv.headers()["content-type"]).toContain("text/csv");
  // The file opens in Excel as UTF-8 (a byte-order mark first) with Windows line ends.
  expect((await csv.text()).replace(/^\uFEFF/, "").split(/\r?\n/)[0]).toBe("tool,runs,refused_input,approvals_asked,approved,declined,undone");
  await admin.context().close();
});

test("staff grade search results for E1 by key, and each version of the search is scored", async ({ browser }, info) => {
  const page = await freshPage(browser, { country: "GR" });
  await signInAdmin(page, info);
  await ready(page, "/en/admin/labeling?q=0");
  await expect(page.locator('[data-agent-id="labeling:query"]')).toHaveText("“sofa”");
  const product = page.locator('[data-agent-id^="labeling:product:"]');
  await expect(product).toBeVisible();
  const first = await product.getAttribute("data-agent-id");
  await axe(page, "main");
  // A key grades it and the next product comes up.
  await page.keyboard.press("3");
  await expect(product).not.toHaveAttribute("data-agent-id", first!, { timeout: 15_000 });

  await ready(page, "/en/admin/labeling?view=results");
  const scores = page.locator('[data-agent-id="labeling:scores"]');
  await expect(scores).toContainText("The shop’s search");
  await expect(scores).toContainText("NDCG@10");
  await axe(page, "main");
  await page.context().close();
});

test("a piece with turntable photographs turns round by drag and by the arrow keys", async ({ browser }) => {
  // The test shop has no turntable photographs (they come from the ABO download), so eight frames are
  // written for the lamp from its own photograph: the viewer is what is tested here, not the import.
  test.skip(process.env.BASE_URL !== undefined, "needs the local test database");
  const sql = postgres(`postgres://postgres:postgres@127.0.0.1:${TEST_DB_PORT}/postgres`, { max: 1, onnotice: () => {} });
  try {
    await sql`
      INSERT INTO product_media (id, product_id, kind, src, width, height, alt_en, position)
      SELECT gen_random_uuid(), p.id, 'spin', m.src, m.width, m.height, 'frame', frame
      FROM products p JOIN product_media m ON m.product_id = p.id AND m.kind = 'image' AND m.position = 0, generate_series(0, 7) AS frame
      WHERE p.slug = 'faux-wood-table-lamp-b07mbfd87n' AND NOT EXISTS (SELECT 1 FROM product_media s WHERE s.product_id = p.id AND s.kind = 'spin')
    `;
  } finally {
    await sql.end();
  }
  const page = await freshPage(browser, { country: "GR" });
  await ready(page, LAMP);
  await page.locator('[data-agent-id^="action:spin:"]').click();
  const spin = page.locator('[role="slider"][data-agent-id^="spin:"]');
  await expect(spin).toHaveAttribute("aria-valuetext", "Turned 0°");
  await spin.focus();
  await page.keyboard.press("ArrowRight");
  await expect(spin).toHaveAttribute("aria-valuetext", "Turned 45°");
  await page.keyboard.press("End");
  await expect(spin).toHaveAttribute("aria-valuenow", "7");
  // A drag to the left turns it on.
  const box = (await spin.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 30, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect(spin).toHaveAttribute("aria-valuenow", "1");
  await axe(page, '[role="dialog"]');
  await page.context().close();
});

test("a user-study session shows its tasks one at a time and records only the code, the task and the time", async ({ browser }) => {
  const page = await freshPage(browser, { country: "GR" });
  await ready(page, "/en/study");
  await page.locator('[data-agent-id="study:code"]').fill("maria");
  await page.locator('[data-agent-id="study:begin"]').click();
  await expect(page.locator('[data-agent-id="study:form"]')).toContainText("Write a code like P07.");
  await page.locator('[data-agent-id="study:code"]').fill("p42");
  await page.locator('[data-agent-id="study:begin"]').click();
  await expect(page).toHaveURL(/\/en$/);
  const panel = page.locator('[data-agent-id="study:panel"]');
  await expect(panel).toContainText("Study session P42");
  await expect(panel.locator('[data-agent-id="study:task"]')).toContainText("table lamp that costs less than €100");
  await axe(page, '[data-agent-id="study:panel"]');

  const recorded = page.waitForRequest((request) => request.url().endsWith("/api/study") && request.method() === "POST");
  await panel.locator('[data-agent-id="study:start"]').click();
  expect((await recorded).postDataJSON()).toEqual({ participant: "P42", task: "find", event: "start" });
  await panel.locator('[data-agent-id="study:success"]').click();
  await expect(panel).toContainText("Task 2 of 6");
  // The panel keeps its place across pages.
  await ready(page, "/en/c");
  await expect(page.locator('[data-agent-id="study:panel"]')).toContainText("Task 2 of 6");
  await page.context().close();
});
