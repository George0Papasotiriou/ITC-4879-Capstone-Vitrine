/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * End-to-end tests for running the shop: editing a product and its stock, the audit log, the dashboards, exports and access.
 */

import { randomInt } from "node:crypto";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { fillAndSubmit, freshPage, signUpAndConfirm, uniqueEmail } from "./support/accounts";
import { signInAdmin } from "./support/orders";

/**
 * docs/adr/018. Each device project edits its own product, found by SKU, and
 * puts it back afterwards, so the two projects and the other specs never see
 * each other's edits.
 */

const PRODUCTS = {
  desktop: { sku: "B001BQ1Q9G", slug: "pinzon-kinzie-leather-dining-chair-b001bq1q9g" },
  mobile: { sku: "B07SJ75Y1M", slug: "hayes-classic-fixed-solid-wood-dining-table-b07sj75y1m" },
};

async function openEditor(staff: Page, sku: string) {
  await staff.goto(`/en/staff/products?q=${sku}`, { waitUntil: "domcontentloaded" });
  const href = await staff.locator('[data-agent-id^="staff:product:"] a').first().getAttribute("href");
  await staff.goto(href!, { waitUntil: "domcontentloaded" });
  await expect(staff.locator('[data-agent-id="product-edit:form"]')).toBeVisible();
}

test("@smoke staff edit a product's title, price and stock; the shop, search and the audit log follow", async ({ browser }, info) => {
  const product = PRODUCTS[info.project.name as keyof typeof PRODUCTS];
  const staff = await freshPage(browser);
  await signInAdmin(staff, info);
  await openEditor(staff, product.sku);

  const original = {
    title: await staff.locator('[data-agent-id="product-edit:titleEn"]').inputValue(),
    price: await staff.locator('[data-agent-id="product-edit:price"]').inputValue(),
  };
  const marker = `quokka${randomInt(1e6)}`;
  const newPrice = (Number(original.price) + 0.5).toFixed(2);

  // A price that is not one is explained beside the field, and nothing is saved.
  await fillAndSubmit(staff, { "product-edit:price": "free" }, "product-edit:save");
  await expect(staff.getByText("Write a price in euros, for example 129 or 129,90.")).toBeVisible();

  await fillAndSubmit(staff, { "product-edit:titleEn": `${original.title} ${marker}`, "product-edit:price": newPrice.replace(".", ",") }, "product-edit:save");
  await expect(staff.getByText("Saved. The shop shows the change now.", { exact: true })).toBeVisible();
  await expect(staff.locator('[data-agent-id="product-edit:ownership"]')).toContainText("Edited by staff");

  // The shop and its search show the change at once.
  // Shopping from Greece, where the stored price is the price shown (VAT included).
  const shopper = await freshPage(browser, { country: "GR" });
  await shopper.goto(`/en/p/${product.slug}`, { waitUntil: "domcontentloaded" });
  await expect(shopper.locator("h1")).toContainText(marker);
  await expect(shopper.locator("main")).toContainText(newPrice);
  await shopper.goto(`/en/search?q=${marker}`, { waitUntil: "domcontentloaded" });
  await expect(shopper.locator("main")).toContainText(marker);

  // Stock set to the counted number, with the reason.
  const form = staff.locator('[data-agent-id^="stock:form:"]').first();
  const sku = (await form.getAttribute("data-agent-id"))!.replace("stock:form:", "");
  const before = await staff.locator(`[data-agent-id="stock:count:${sku}"]`).inputValue();
  const counted = before === "7" ? "8" : "7";
  await fillAndSubmit(staff, { [`stock:count:${sku}`]: counted, [`stock:reason:${sku}`]: "Counted the shelf" }, `stock:save:${sku}`);
  await expect(staff.getByText(`Stock set to ${counted}.`, { exact: true })).toBeVisible();
  await expect(staff.locator(`[data-agent-id="stock:current:${sku}"]`)).toHaveText(`${counted} in stock`);

  // The audit log names the change, the person and the reason.
  await staff.goto("/en/admin/audit?entity=variant", { waitUntil: "domcontentloaded" });
  const stockEntry = staff.locator('[data-agent-id^="audit:entry:"]').filter({ hasText: sku }).first();
  await expect(stockEntry).toContainText("Set stock");
  await expect(stockEntry).toContainText(`${before} → ${counted}`);
  await expect(stockEntry).toContainText("Reason: Counted the shelf");
  await staff.goto("/en/admin/audit?entity=product", { waitUntil: "domcontentloaded" });
  await expect(staff.locator('[data-agent-id^="audit:entry:"]').filter({ hasText: marker }).first()).toContainText("Edited a product");

  // Put everything back.
  await openEditor(staff, product.sku);
  await fillAndSubmit(staff, { "product-edit:titleEn": original.title, "product-edit:price": original.price }, "product-edit:save");
  await expect(staff.getByText("Saved. The shop shows the change now.", { exact: true })).toBeVisible();
  await fillAndSubmit(staff, { [`stock:count:${sku}`]: before, [`stock:reason:${sku}`]: "End of the test" }, `stock:save:${sku}`);
  await expect(staff.locator(`[data-agent-id="stock:current:${sku}"]`)).toHaveText(`${before} in stock`);
  await shopper.context().close();
  await staff.context().close();
});

test("the dashboards show every panel and export the period's orders as CSV", async ({ browser }, info) => {
  const staff = await freshPage(browser);
  await signInAdmin(staff, info);
  // A search, so the search panel has at least one row.
  await staff.goto("/en/search?q=table+lamp", { waitUntil: "domcontentloaded" });
  await staff.goto("/en/admin?days=7", { waitUntil: "domcontentloaded" });
  for (const panel of ["sales", "by-day", "statuses", "funnel", "countries", "products", "returns", "reviews", "searches", "low-stock"]) {
    await expect(staff.locator(`[data-agent-id="dashboard:${panel}"]`)).toBeVisible();
  }
  await expect(staff.locator('[data-agent-id="dashboard:funnel-table"]')).toContainText("Started a cart");
  await expect(staff.locator('[data-agent-id="dashboard:top-searches"]')).toContainText("table lamp");
  await expect(staff.locator('[data-agent-id="dashboard:period:7"]')).toHaveAttribute("aria-current", "page");

  const csv = await staff.request.get("/api/admin/export/orders?days=7");
  expect(csv.status()).toBe(200);
  expect(csv.headers()["content-type"]).toContain("text/csv");
  expect(csv.headers()["content-disposition"]).toMatch(/attachment; filename="vitrine-orders-\d{4}-\d{2}-\d{2}-to-\d{4}-\d{2}-\d{2}\.csv"/);
  expect((await csv.text()).replace(String.fromCharCode(0xfeff), "").split("\r\n")[0]).toBe("number,placed_at,paid_at,status,email,country,items,subtotal,shipping,vat,total,currency");
  const stock = await staff.request.get("/api/admin/export/stock");
  expect((await stock.text()).split("\r\n").length).toBeGreaterThan(20);
  await staff.context().close();
});

test("a customer gets 404 on staff pages and cannot export or edit", async ({ browser }) => {
  const page = await freshPage(browser);
  const signedOut = await page.request.get("/api/admin/export/orders");
  expect(signedOut.status()).toBe(401);
  await signUpAndConfirm(page, uniqueEmail("customer"));
  for (const path of ["/en/staff", "/en/staff/products", "/en/admin", "/en/admin/audit"]) {
    expect((await page.goto(path))?.status(), path).toBe(404);
  }
  expect((await page.request.get("/api/admin/export/orders")).status()).toBe(403);
  const origin = new URL(page.url()).origin;
  // The AI switches and the weekly report are an admin's alone (docs/adr/020).
  expect((await page.request.post("/api/admin/reports", { headers: { origin }, data: {} })).status()).toBe(403);
  expect((await page.request.post("/api/admin/ai", { headers: { origin }, data: { killSwitch: true } })).status()).toBe(403);
  expect((await page.goto("/en/admin/ai"))?.status()).toBe(404);
  // A watch on a piece that does not exist is refused, whoever asks.
  const missingWatch = await page.request.post("/api/watch", {
    headers: { origin },
    data: { action: "set", productId: "01890000-0000-7000-8000-000000000000", targetCents: 1_000, locale: "en" },
  });
  expect(missingWatch.status()).toBe(404);
  const edit = await page.request.post("/api/staff/products/01890000-0000-7000-8000-000000000000", {
    headers: { origin },
    data: { kind: "stock", variantId: "01890000-0000-7000-8000-000000000000", stock: "0", reason: "Emptying the shelf" },
  });
  expect(edit.status()).toBe(403);
  await page.goto("/en/account", { waitUntil: "domcontentloaded" });
  await expect(page.locator('[data-agent-id="action:open-products"]')).toHaveCount(0);
  await page.context().close();
});

test("the staff pages pass the accessibility checks", async ({ browser }, info) => {
  const staff = await freshPage(browser);
  await signInAdmin(staff, info);
  await openEditor(staff, PRODUCTS[info.project.name as keyof typeof PRODUCTS].sku);
  const editor = staff.url();
  for (const path of ["/en/staff", "/en/staff/products", editor, "/en/admin", "/en/admin/audit", "/el/admin"]) {
    await staff.goto(path, { waitUntil: "networkidle" });
    const results = await new AxeBuilder({ page: staff }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    expect(results.violations, `${path}: ${results.violations.map((violation) => `${violation.id} (${violation.nodes[0]?.target.join(" ")})`).join(", ")}`).toEqual([]);
  }
  await staff.context().close();
});
