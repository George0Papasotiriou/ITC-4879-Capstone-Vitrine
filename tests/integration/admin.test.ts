/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Integration tests for running the shop: dashboard figures against the raw rows, staff edits, the audit log and search events.
 */

import { readFile } from "node:fs/promises";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { uuidv7 } from "uuidv7";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { productDetailsSchema, type ProductDetails } from "@/lib/admin/catalog";
import { createCatalogAdminStore, type CatalogAdminStore } from "@/lib/admin/catalog-store";
import { createDashboardStore } from "@/lib/admin/dashboard-store";
import { dayKey, funnel, inPeriod, periodFor, returnReasonCode, salesByDay, salesSummary, share } from "@/lib/admin/metrics";
import { pruneSearchEvents, recordSearch } from "@/lib/admin/search-events";
import { catalogFixtureSchema, type ProductInput } from "@/lib/catalog/input";
import { upsertCatalog } from "@/lib/catalog/write";
import { demoPlacedAt, planDemoOrder } from "@/lib/commerce/demo-orders";
import { createReviewStore } from "@/lib/commerce/review-store";
import { reviewInputSchema } from "@/lib/commerce/reviews";
import { createCommerceStore } from "@/lib/commerce/store";
import * as schema from "@/lib/db/schema";
import { seededRandom } from "@/lib/reco/simulate";

const url = process.env.DATABASE_URL;
const COUNTRIES = [
  { country: "GR", city: "Athens", postcode: "10563" },
  { country: "CY", city: "Nicosia", postcode: "1011" },
  { country: "DE", city: "Berlin", postcode: "10115" },
];

describe.skipIf(url === undefined || url === "")("running the shop", () => {
  let connection: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let fixture: ProductInput[];
  let catalog: CatalogAdminStore;
  let staff: { userId: string; email: string };
  const now = new Date();

  const productId = async (sourceId: string) =>
    (await connection<{ id: string }[]>`SELECT id FROM products WHERE source_id = ${sourceId}`)[0]!.id;
  const auditCount = async () => (await connection<{ n: number }[]>`SELECT count(*)::int AS n FROM audit_log`)[0]!.n;
  const detailsOf = async (id: string): Promise<ProductDetails> => {
    const product = (await catalog.readProduct(id))!;
    return {
      titleEn: product.titleEn,
      titleEl: product.titleEl,
      descriptionEn: product.descriptionEn,
      descriptionEl: product.descriptionEl,
      highlightsEn: product.highlightsEn,
      highlightsEl: product.highlightsEl,
      priceCents: product.priceCents,
      compareAtCents: product.compareAtCents,
      status: product.status === "archived" ? "archived" : "active",
    };
  };

  beforeAll(async () => {
    connection = postgres(url as string, { max: 4, onnotice: () => {} });
    db = drizzle(connection, { schema });
    await migrate(db, { migrationsFolder: "./drizzle" });
    await connection`TRUNCATE products, brands, categories, carts, orders, reviews, search_events, audit_log CASCADE`;
    fixture = catalogFixtureSchema.parse(JSON.parse(await readFile("src/lib/catalog/fixtures/specimen.json", "utf8"))).products;
    await upsertCatalog(db, fixture);
    await connection`UPDATE product_variants SET stock = 60`;
    catalog = createCatalogAdminStore(connection);
    const id = uuidv7();
    staff = { userId: id, email: `merch.${id}@vitrine.test` };
    await connection`INSERT INTO users (id, name, email, email_verified, role) VALUES (${id}, 'Merch', ${staff.email}, true, 'merchandiser')`;
  });

  afterAll(async () => {
    await connection?.end();
  });

  describe("dashboard", () => {
    beforeAll(async () => {
      // Forty orders over 45 days, each living a planned life through the real store, dated as it happened.
      const store = createCommerceStore(connection);
      const reviews = createReviewStore(connection);
      const variants = await connection<{ id: string }[]>`SELECT id FROM product_variants ORDER BY sku`;
      const random = seededRandom(20260919);
      let hidden = 0;
      for (let index = 0; index < 40; index += 1) {
        const placedAt = demoPlacedAt(random, now, 45);
        const plan = planDemoOrder(random, placedAt, now);
        let cartId: string | null = null;
        for (let line = 0; line < 1 + Math.floor(random() * 2); line += 1) {
          const change = await store.changeLine(cartId, variants[Math.floor(random() * variants.length)]!.id, 1 + Math.floor(random() * 2), "add");
          if (change.ok) cartId = change.cartId;
        }
        await connection`UPDATE carts SET created_at = ${new Date(placedAt.getTime() - 60_000).toISOString()}::timestamptz WHERE id = ${cartId}`;
        const place = COUNTRIES[index % COUNTRIES.length]!;
        const placed = await store.placeOrder({
          cartId: cartId!,
          locale: "en",
          email: `shopper${index}@example.com`,
          address: { name: "Eleni Papadopoulou", line1: "Ermou 10", ...place },
          shipping: "standard",
          idempotencyKey: uuidv7(),
          paymentProvider: "local_test",
          now: placedAt,
        });
        if (!placed.ok) throw new Error(`order ${index} not placed: ${placed.reason}`);
        for (const step of plan.steps) {
          const applied = await store.applyEvent(placed.orderId, step.event, step.actor, { now: step.at, reason: step.reason ?? null });
          if (!applied.ok) throw new Error(`${step.event} refused: ${applied.reason}`);
        }
        if (plan.review !== null) {
          const [line] = await connection<{ id: string }[]>`SELECT id FROM order_items WHERE order_id = ${placed.orderId} ORDER BY id LIMIT 1`;
          const saved = await reviews.saveReview({
            orderId: placed.orderId,
            orderItemId: line!.id,
            input: reviewInputSchema.parse({ rating: plan.review.rating, body: "Well made and exactly as the photos show." }),
            userId: null,
            locale: "en",
            now: plan.review.at,
          });
          // Every third review is hidden, the first among them, so the panel counts both kinds.
          if (saved.ok && hidden++ % 3 === 0) await reviews.moderate(saved.reviewId, { status: "hidden", reason: "Test", actor: staff });
        }
      }
      // A cart that never became an order, and searches in and out of the period.
      await store.changeLine(null, variants[0]!.id, 1, "add");
      for (const [query, results, daysAgo] of [["oak chair", 4, 1], ["oak chair", 2, 2], ["velvet sofa", 0, 3], ["lamp", 7, 5], ["zebra rug", 0, 40]] as const) {
        await recordSearch(connection, { query, locale: "en", results, relaxed: false, corrected: false, tookMs: 12, source: "page" }, { now: new Date(now.getTime() - daysAgo * 86_400_000) });
      }
    });

    it("matches the figures summed from the raw rows, panel by panel", async () => {
      const period = periodFor(30, now);
      const overview = await createDashboardStore(connection).overview(period);

      const orders = await connection<{ id: string; status: string; total_cents: number; vat_cents: number; vat_country: string; created_at: Date; paid_at: Date | null; delivered_at: Date | null }[]>`
        SELECT id, status, total_cents, vat_cents, vat_country, created_at, paid_at, delivered_at FROM orders
      `;
      const events = await connection<{ order_id: string; event: string; to_status: string; reason: string | null; created_at: Date }[]>`SELECT order_id, event, to_status, reason, created_at FROM order_events`;
      const items = await connection<{ order_id: string; product_id: string; quantity: number; line_cents: number }[]>`SELECT order_id, product_id, quantity, line_cents FROM order_items`;
      const carts = await connection<{ created_at: Date }[]>`SELECT created_at FROM carts`;
      const reviewRows = await connection<{ status: string; rating: number; created_at: Date }[]>`SELECT status, rating, created_at FROM reviews`;
      const searches = await connection<{ query: string; results: number; occurred_at: Date }[]>`SELECT query, results, occurred_at FROM search_events`;
      const date = (value: Date | null) => (value === null ? null : new Date(value));
      const byId = new Map(orders.map((order) => [order.id, order]));

      // Sales and refunds.
      const sales = orders.map((order) => ({ totalCents: order.total_cents, vatCents: order.vat_cents, paidAt: date(order.paid_at) }));
      const refunds = events.filter((event) => event.to_status === "refunded").map((event) => ({ totalCents: byId.get(event.order_id)!.total_cents, refundedAt: new Date(event.created_at) }));
      expect(overview.sales).toEqual(salesSummary(sales, refunds, period));
      expect(overview.sales.orders).toBeGreaterThan(5);
      expect(overview.salesByDay).toEqual(salesByDay(sales, period));

      // Orders placed in the period, by status now.
      const placed = orders.filter((order) => inPeriod(date(order.created_at), period));
      const statuses = new Map<string, number>();
      for (const order of placed) statuses.set(order.status, (statuses.get(order.status) ?? 0) + 1);
      expect(new Map(overview.statuses.map((row) => [row.status, row.count]))).toEqual(statuses);

      // Countries.
      const paid = orders.filter((order) => inPeriod(date(order.paid_at), period));
      const countries = new Map<string, { orders: number; grossCents: number; vatCents: number }>();
      for (const order of paid) {
        const entry = countries.get(order.vat_country) ?? { orders: 0, grossCents: 0, vatCents: 0 };
        countries.set(order.vat_country, { orders: entry.orders + 1, grossCents: entry.grossCents + order.total_cents, vatCents: entry.vatCents + order.vat_cents });
      }
      expect(new Map(overview.countries.map(({ country, ...rest }) => [country, rest]))).toEqual(countries);

      // Top products.
      const paidIds = new Set(paid.map((order) => order.id));
      const products = new Map<string, { units: number; revenueCents: number }>();
      for (const item of items.filter((line) => paidIds.has(line.order_id))) {
        const entry = products.get(item.product_id) ?? { units: 0, revenueCents: 0 };
        products.set(item.product_id, { units: entry.units + item.quantity, revenueCents: entry.revenueCents + item.line_cents });
      }
      const top = [...products].sort(([idA, a], [idB, b]) => b.revenueCents - a.revenueCents || b.units - a.units || (idA < idB ? -1 : 1)).slice(0, 8);
      expect(overview.topProducts.map(({ productId, units, revenueCents }) => [productId, { units, revenueCents }])).toEqual(top);

      // Funnel.
      expect(overview.funnel).toEqual(
        funnel([
          { key: "carts", count: carts.filter((cart) => inPeriod(date(cart.created_at), period)).length },
          { key: "placed", count: placed.length },
          { key: "paid", count: placed.filter((order) => order.paid_at !== null).length },
          { key: "delivered", count: placed.filter((order) => order.delivered_at !== null).length },
        ]),
      );

      // Returns.
      const inside = events.filter((event) => inPeriod(date(event.created_at), period));
      const requested = inside.filter((event) => event.event === "request_return");
      const deliveries = inside.filter((event) => event.event === "deliver").length;
      expect(overview.returns.requested).toBe(requested.length);
      expect(overview.returns.deliveries).toBe(deliveries);
      expect(overview.returns.rate).toBe(share(requested.length, deliveries));
      const reasons = new Map<string, number>();
      for (const event of requested) reasons.set(returnReasonCode(event.reason), (reasons.get(returnReasonCode(event.reason)) ?? 0) + 1);
      expect(new Map(overview.returns.reasons.map((row) => [row.reason, row.count]))).toEqual(reasons);

      // Reviews.
      const recent = reviewRows.filter((review) => inPeriod(date(review.created_at), period));
      const published = recent.filter((review) => review.status === "published");
      expect(overview.reviews.published).toBe(published.length);
      expect(overview.reviews.hidden).toBe(recent.filter((review) => review.status === "hidden").length);
      if (published.length > 0) expect(overview.reviews.average).toBeCloseTo(published.reduce((sum, review) => sum + review.rating, 0) / published.length, 10);

      // Searches: the one from 40 days ago is outside the period.
      const periodSearches = searches.filter((search) => inPeriod(date(search.occurred_at), period));
      expect(overview.searches.total).toBe(periodSearches.length);
      expect(overview.searches.total).toBe(4);
      expect(overview.searches.zeroResults).toBe(1);
      expect(overview.searches.top[0]).toEqual({ query: "oak chair", count: 2, averageResults: 3 });
      expect(overview.searches.zero).toEqual([{ query: "velvet sofa", count: 1 }]);
    });

    it("puts each sale in its UTC day", async () => {
      const period = periodFor(7, now);
      const overview = await createDashboardStore(connection).overview(period);
      expect(overview.salesByDay.map((entry) => entry.day)).toEqual(period.dayKeys);
      expect(overview.salesByDay.at(-1)!.day).toBe(dayKey(now));
      expect(overview.salesByDay.reduce((sum, entry) => sum + entry.value, 0)).toBe(overview.sales.grossCents);
    });

    it("records hiding a review in the audit log, with the reason", async () => {
      const [entry] = await connection<{ action: string; actor_email: string; reason: string; changes: Record<string, unknown> }[]>`
        SELECT action, actor_email, reason, changes FROM audit_log WHERE action = 'review.hide' LIMIT 1
      `;
      expect(entry).toMatchObject({ action: "review.hide", actor_email: staff.email, reason: "Test", changes: { status: { before: "published", after: "hidden" } } });
    });
  });

  describe("catalogue edits", () => {
    it("rebuilds the search text and marks the product as edited, and the audit keeps only what changed", async () => {
      const id = await productId(fixture[0]!.sourceId);
      const before = await detailsOf(id);
      const result = await catalog.updateProduct(id, { ...before, titleEn: "Lighthouse Reading Lamp", priceCents: before.priceCents + 1000 }, staff);
      expect(result).toEqual({ ok: true, changed: ["priceCents", "titleEn"] });

      const [row] = await connection<{ search_title: string; staff_edited_at: Date | null; price_cents: number }[]>`SELECT search_title, staff_edited_at, price_cents FROM products WHERE id = ${id}`;
      expect(row!.search_title).toContain("lighthouse reading lamp");
      expect(row!.staff_edited_at).not.toBeNull();
      const [found] = await connection<{ id: string }[]>`SELECT id FROM products WHERE search_tsv @@ plainto_tsquery('english', 'lighthouse')`;
      expect(found?.id).toBe(id);

      const [entry] = await connection<{ actor_user_id: string; action: string; entity_id: string; changes: Record<string, unknown> }[]>`
        SELECT actor_user_id, action, entity_id, changes FROM audit_log WHERE entity_id = ${id} AND action = 'product.update'
      `;
      expect(entry).toEqual({
        actor_user_id: staff.userId,
        action: "product.update",
        entity_id: id,
        changes: { priceCents: { before: before.priceCents, after: before.priceCents + 1000 }, titleEn: { before: before.titleEn, after: "Lighthouse Reading Lamp" } },
      });
    });

    it("writes nothing for an edit that changes nothing", async () => {
      const id = await productId(fixture[1]!.sourceId);
      const count = await auditCount();
      expect(await catalog.updateProduct(id, await detailsOf(id), staff)).toEqual({ ok: true, changed: [] });
      expect(await auditCount()).toBe(count);
      expect((await catalog.readProduct(id))!.staffEditedAt).toBeNull();
    });

    it("leaves no audit entry when the database refuses the edit", async () => {
      const id = await productId(fixture[2]!.sourceId);
      const before = await detailsOf(id);
      const count = await auditCount();
      // Past the form's own check: the database refuses a "was" price below the price too.
      await expect(catalog.updateProduct(id, { ...before, compareAtCents: before.priceCents - 1, titleEn: "Changed" }, staff)).rejects.toThrow();
      expect(await auditCount()).toBe(count);
      expect((await catalog.readProduct(id))!.titleEn).toBe(before.titleEn);
    });

    it("marks Greek text staff wrote as reviewed", async () => {
      const id = await productId(fixture[3]!.sourceId);
      const before = await detailsOf(id);
      await catalog.updateProduct(id, productDetailsSchema.parse({
        titleEn: before.titleEn,
        titleEl: "Δρύινη καρέκλα",
        descriptionEn: before.descriptionEn ?? "",
        descriptionEl: before.descriptionEl ?? "",
        highlightsEn: before.highlightsEn.join("\n"),
        highlightsEl: (before.highlightsEl ?? []).join("\n"),
        price: String(before.priceCents / 100),
        compareAt: before.compareAtCents === null ? "" : String(before.compareAtCents / 100),
        status: "active",
      }), staff);
      expect((await catalog.readProduct(id))!.translation).toBe("reviewed");
    });

    it("keeps a staff edit through the next catalogue sync, while an untouched product still refreshes", async () => {
      const edited = await productId(fixture[0]!.sourceId);
      const untouched = await productId(fixture[5]!.sourceId);
      const changedFixture = fixture.map((product, index) =>
        index === 0 || index === 5 ? { ...product, titleEn: `${product.titleEn} (new copy from the dataset)`, priceCents: product.priceCents + 1 } : product,
      );
      const summary = await upsertCatalog(db, changedFixture, { preserveStock: true });
      expect(summary.keptStaffEdits).toBeGreaterThanOrEqual(1);

      const [kept] = await connection<{ title_en: string; media: number }[]>`
        SELECT title_en, (SELECT count(*)::int FROM product_media m WHERE m.product_id = p.id) AS media FROM products p WHERE id = ${edited}
      `;
      expect(kept).toEqual({ title_en: "Lighthouse Reading Lamp", media: fixture[0]!.media.length });
      const [refreshed] = await connection<{ title_en: string; price_cents: number }[]>`SELECT title_en, price_cents FROM products WHERE id = ${untouched}`;
      expect(refreshed).toEqual({ title_en: `${fixture[5]!.titleEn} (new copy from the dataset)`, price_cents: fixture[5]!.priceCents + 1 });
    });

    it("sets stock to the counted number with a reason, and ignores a count that changes nothing", async () => {
      const id = await productId(fixture[6]!.sourceId);
      const variant = (await catalog.readProduct(id))!.variants[0]!;
      expect(await catalog.setStock(id, variant.id, 2, "Counted the shelf", staff)).toEqual({ ok: true, changed: true });
      const [entry] = await connection<{ action: string; changes: unknown; reason: string }[]>`SELECT action, changes, reason FROM audit_log WHERE entity_id = ${variant.id}`;
      expect(entry).toEqual({ action: "stock.set", changes: { stock: { before: variant.stock, after: 2 } }, reason: "Counted the shelf" });

      const count = await auditCount();
      expect(await catalog.setStock(id, variant.id, 2, "Counted again", staff)).toEqual({ ok: true, changed: false });
      expect(await auditCount()).toBe(count);
      // A variant of another product is not this product's.
      expect(await catalog.setStock(await productId(fixture[7]!.sourceId), variant.id, 5, "Wrong product", staff)).toEqual({ ok: false, reason: "not_found" });
    });

    it("lists products by title or SKU, and the low-stock view shows the ones running out", async () => {
      const lamp = await catalog.listProducts({ query: "lighthouse" });
      expect(lamp.rows.map((row) => row.titleEn)).toEqual(["Lighthouse Reading Lamp"]);
      const sku = (await catalog.readProduct(await productId(fixture[8]!.sourceId)))!.variants[0]!.sku;
      expect((await catalog.listProducts({ query: sku.toLowerCase() })).rows).toHaveLength(1);
      expect((await catalog.listProducts({ query: "100%_" })).total).toBe(0);

      const low = await catalog.listProducts({ lowStock: true });
      expect(low.rows.length).toBeGreaterThan(0);
      expect(low.rows.every((row) => row.stock <= 3 && row.status === "active")).toBe(true);
    });
  });

  describe("search events", () => {
    it("stores the masked query and nothing about the person", async () => {
      await recordSearch(connection, { query: "Call 690 000 0000 about the SOFA", locale: "el", results: 3, relaxed: true, corrected: false, tookMs: 20.4, source: "api" });
      const [row] = await connection`SELECT * FROM search_events WHERE locale = 'el' ORDER BY occurred_at DESC LIMIT 1`;
      expect(row).toMatchObject({ query: "call # about the sofa", results: 3, relaxed: true, corrected: false, took_ms: 20, source: "api" });
      expect(Object.keys(row!).sort()).toEqual(["corrected", "id", "locale", "occurred_at", "query", "relaxed", "results", "source", "took_ms"]);
    });

    it("does not record a query that was only a number or an address", async () => {
      const before = (await connection<{ n: number }[]>`SELECT count(*)::int AS n FROM search_events`)[0]!.n;
      await recordSearch(connection, { query: "6900000000", locale: "en", results: 0, relaxed: false, corrected: false, tookMs: 1, source: "page" });
      await recordSearch(connection, { query: "someone@example.com", locale: "en", results: 0, relaxed: false, corrected: false, tookMs: 1, source: "page" });
      expect((await connection<{ n: number }[]>`SELECT count(*)::int AS n FROM search_events`)[0]!.n).toBe(before);
    });

    it("deletes searches older than 90 days", async () => {
      await recordSearch(connection, { query: "ancient query", locale: "en", results: 1, relaxed: false, corrected: false, tookMs: 1, source: "page" }, { now: new Date(now.getTime() - 91 * 86_400_000) });
      expect(await pruneSearchEvents(connection, now)).toBeGreaterThanOrEqual(1);
      expect(await connection`SELECT 1 FROM search_events WHERE query = 'ancient query'`).toHaveLength(0);
    });
  });
});
