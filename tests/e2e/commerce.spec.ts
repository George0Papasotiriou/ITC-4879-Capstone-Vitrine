/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * End-to-end cart, checkout and guest order flows.
 */

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * Cart, checkout and a guest order with the local test payment (Phase 5).
 * The lamps below have plenty of stock in the specimen catalogue, so the
 * desktop and mobile runs can both place orders against the same database.
 */

const LAMP = "/en/p/faux-wood-table-lamp-b07mbfd87n";
const FLOOR_LAMP = "/en/p/swing-arm-living-room-floor-lamp-with-led-b07dbdv3fh";

async function addToCart(page: Page, path: string, sheetName = "Added to your cart") {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  const button = page.locator('[data-agent-id^="action:add-to-cart:"]');
  const sheet = page.getByRole("dialog", { name: sheetName });
  // Retry until hydrated: a click before hydration has no handler. Never click
  // again once the sheet is open (its overlay covers the button), and give a
  // real addition time to answer so it is not added twice.
  await expect(async () => {
    if (!(await sheet.isVisible())) await button.click({ timeout: 2_000 });
    await expect(sheet).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 25_000 });
}

async function fillAddress(page: Page, overrides: Partial<Record<"email" | "postcode", string>> = {}) {
  await page.getByLabel("Email").fill(overrides.email ?? "eleni@example.com");
  await page.getByLabel("Full name").fill("Eleni Papadopoulou");
  await page.getByLabel("Street and number").fill("Ermou 10");
  await page.getByLabel("City").fill("Athens");
  await page.getByLabel("Postcode").fill(overrides.postcode ?? "105 63");
}

/** Presses an order-page button once the page is hydrated, and waits for the new status. */
async function orderAction(page: Page, name: string, status: string) {
  const button = page.getByRole("button", { name });
  await expect(async () => {
    await button.click();
    await expect(page.locator('[data-agent-id="order:status"]')).toHaveText(status, { timeout: 2_000 });
  }).toPass();
}

/** Checks out whatever is in the cart and lands on the order page. */
async function placeOrder(page: Page) {
  await page.goto("/en/checkout", { waitUntil: "domcontentloaded" });
  await fillAddress(page);
  // The button is disabled until the form is hydrated, and click() waits for it
  // to be enabled, so one click is enough; a retry would submit twice.
  await page.locator('[data-agent-id="action:place-order"]').click();
  await expect(page).toHaveURL(/\/en\/orders\/[0-9a-f-]{36}\?t=/, { timeout: 15_000 });
  await expect(page.locator('[data-agent-id="order:status"]')).toHaveText("Waiting for payment");
}

test("@smoke a guest adds to the cart, checks out, and pays with the test payment", async ({ page }) => {
  // The whole purchase in one test: seven pages and four writes. Allow for a busy machine.
  test.slow();
  await addToCart(page, LAMP);
  const sheet = page.getByRole("dialog", { name: "Added to your cart" });
  await expect(sheet.getByText("Faux Wood Table Lamp", { exact: false })).toBeVisible();
  await expect(sheet.getByText("Subtotal")).toBeVisible();
  // The sheet slides in; retry until the link has taken the shopper to the cart.
  await expect(async () => {
    if (await sheet.isVisible()) await sheet.getByRole("link", { name: "View cart" }).click({ timeout: 2_000 });
    await expect(page).toHaveURL(/\/en\/cart$/, { timeout: 2_000 });
  }).toPass();
  await expect(page.locator('header [data-agent-id="nav:cart"]')).toHaveAccessibleName(/Open your cart\s*,\s*1 item in your cart/);
  const line = page.locator('[data-agent-id^="cart-line:"]');
  await expect(line).toHaveCount(1);
  await line.getByRole("combobox").selectOption("2");
  const totals = page.locator('[data-agent-id="cart:totals"]');
  // €94.00 × 2 = €188.00, which ships free.
  await expect(totals.getByText("€188.00")).toHaveCount(2);
  await expect(totals.getByText("Free")).toBeVisible();

  // The quantity change refreshes the page; a click that lands during the refresh is dropped, so retry.
  await expect(async () => {
    await page.locator('[data-agent-id="action:checkout"]').click();
    await expect(page.getByRole("heading", { name: "Checkout" })).toBeVisible({ timeout: 2_000 });
  }).toPass();

  // A Cypriot postcode for a Greek address is refused, next to the field.
  await expect(page.locator('[data-agent-id="action:place-order"]')).toBeEnabled();
  await fillAddress(page, { postcode: "1056" });
  const place = page.locator('[data-agent-id="action:place-order"]');
  await place.click();
  await expect(page.getByText("Enter a postcode in the format used in Greece.")).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "Some details need attention" })).toBeVisible();

  // Express shipping changes the total the server already priced.
  await page.getByRole("radio", { name: "Express, next working day" }).click();
  await expect(place).toHaveText("Place order, €202.90");

  await page.getByLabel("Postcode").fill("10563");
  await place.click();
  await expect(page).toHaveURL(/\/en\/orders\/[0-9a-f-]{36}\?t=/, { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: /^Order VT-[0-9A-Z]{4}-[0-9A-Z]{4}$/ })).toBeVisible();
  await expect(page.locator('[data-agent-id="order:status"]')).toHaveText("Waiting for payment");
  await expect(page.locator('[data-agent-id="order:totals"]').getByText("€202.90")).toBeVisible();
  await expect(page.locator("address")).toContainText("Eleni Papadopoulou");
  // Stored in the way Greek addresses are written.
  await expect(page.locator("address")).toContainText("105 63 Athens, GR");

  const testPayment = page.locator('[data-agent-id="order:test-payment"]');
  await expect(testPayment.getByRole("heading", { name: "Test payment" })).toBeVisible();
  await orderAction(page, "Pay €202.90 (test)", "Paid");
  await expect(page.locator('[data-agent-id="order:history"]')).toContainText("Payment received automatically");
  await expect(testPayment).toHaveCount(0);

  // The cart is empty now, and remembers the order.
  await page.goto("/en/cart", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Your cart is empty")).toBeVisible();
  // A client-side navigation clicked while the page is still starting up can be dropped: retry until it lands.
  await expect(async () => {
    if (page.url().includes("/en/cart")) await page.getByRole("link", { name: "View your last order" }).click({ timeout: 2_000 });
    await expect(page.locator('[data-agent-id="order:status"]')).toHaveText("Paid", { timeout: 3_000 });
  }).toPass();
});

test("a declined test payment cancels the order, and a customer can cancel with confirmation", async ({ page }) => {
  await addToCart(page, FLOOR_LAMP);
  await placeOrder(page);
  await orderAction(page, "Decline the payment (test)", "Cancelled");
  await expect(page.locator('[data-agent-id="order:history"]')).toContainText("Payment declined");
  await expect(page.getByRole("button", { name: "Cancel order" })).toHaveCount(0);

  await addToCart(page, FLOOR_LAMP);
  await placeOrder(page);
  const dialog = page.getByRole("dialog", { name: "Cancel this order?" });
  await expect(async () => {
    await page.getByRole("button", { name: "Cancel order" }).click();
    await expect(dialog).toBeVisible({ timeout: 1_500 });
  }).toPass();
  await expect(dialog).toContainText("The pieces go back on sale.");
  await dialog.getByRole("button", { name: "Keep the order" }).click();
  await expect(page.locator('[data-agent-id="order:status"]')).toHaveText("Waiting for payment");

  await page.getByRole("button", { name: "Cancel order" }).click();
  await page.getByRole("dialog", { name: "Cancel this order?" }).getByRole("button", { name: "Cancel order" }).click();
  await expect(page.locator('[data-agent-id="order:status"]')).toHaveText("Cancelled");
  await expect(page.locator('[data-agent-id="order:history"]')).toContainText("Cancelled by you");
});

test("an order link with a wrong token is not found, and the order API refuses it", async ({ page, request }) => {
  await addToCart(page, LAMP);
  await placeOrder(page);
  const url = new URL(page.url());
  const orderId = url.pathname.split("/").pop()!;

  const wrong = await page.goto(`/en/orders/${orderId}?t=not-the-right-token-at-all`);
  expect(wrong?.status()).toBe(404);
  const api = await request.post(`/api/orders/${orderId}/events`, { data: { token: "not-the-right-token-at-all", action: "test_pay" } });
  expect(api.status()).toBe(404);
});

test("the cart and checkout APIs validate input and never take prices from the browser", async ({ request }) => {
  expect((await request.post("/api/cart", { data: { action: "add", quantity: 50 } })).status()).toBe(400);
  expect((await request.post("/api/cart", { data: { action: "add", productId: "0191e2c4-5b6a-7c8d-9e0f-a1b2c3d4e5f6" } })).status()).toBe(404);

  const checkout = await request.post("/api/checkout", {
    data: { email: "x", name: "", line1: "", city: "", postcode: "", country: "GR", shipping: "standard", idempotencyKey: "0191e2c4-5b6a-7c8d-9e0f-a1b2c3d4e5f6", locale: "en", totalCents: 1 },
  });
  expect(checkout.status()).toBe(422);
  const body = (await checkout.json()) as { fields: Record<string, string> };
  expect(body.fields).toMatchObject({ email: "email", name: "required", postcode: "postcode" });
});

test("the Greek cart and checkout speak Greek", async ({ page }) => {
  await addToCart(page, "/el/p/faux-wood-table-lamp-b07mbfd87n", "Προστέθηκε στο καλάθι σου");
  await page.goto("/el/checkout", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Ολοκλήρωση παραγγελίας" })).toBeVisible();
  await expect(page.getByLabel("Ταχυδρομικός κώδικας")).toBeVisible();
  // Greek formatting puts a no-break space before the euro sign.
  await expect(page.getByText(/Περιλαμβάνει ΦΠΑ 19,53\s€/)).toBeVisible();
});

test("the mini cart, cart, checkout and order pages have no accessibility violations", async ({ page }) => {
  const audit = async (label: string) => {
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    const summary = results.violations.map((violation) => ({ rule: violation.id, nodes: violation.nodes.map((node) => node.target.join(" ")) }));
    expect(summary, `${label}: ${JSON.stringify(summary, null, 2)}`).toEqual([]);
  };

  await addToCart(page, LAMP);
  await audit("mini cart");
  await page.goto("/en/cart", { waitUntil: "load" });
  await audit("cart");
  await page.goto("/en/checkout", { waitUntil: "load" });
  await audit("checkout");
  await placeOrder(page);
  await page.waitForLoadState("load");
  await audit("order page");
});
