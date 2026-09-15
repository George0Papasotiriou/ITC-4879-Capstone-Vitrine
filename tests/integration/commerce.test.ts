/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Integration tests for carts, stock holds and orders against PostgreSQL.
 */

import { readFile } from "node:fs/promises";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { uuidv7 } from "uuidv7";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { catalogFixtureSchema } from "@/lib/catalog/input";
import { upsertCatalog } from "@/lib/catalog/write";
import { PAYMENT_WINDOW_MINUTES } from "@/lib/commerce/order-state";
import { includedVat, SHIPPING_RATES } from "@/lib/commerce/pricing";
import { createCommerceStore, type CommerceStore } from "@/lib/commerce/store";
import { localizeCents } from "@/lib/commerce/vat";
import * as schema from "@/lib/db/schema";

/**
 * Carts, checkout and order events against the database: stock caps, the
 * idempotent checkout, the race for the last item, and stock that comes back
 * when an order is cancelled or expires.
 */

const url = process.env.DATABASE_URL;

const ADDRESS = { name: "Eleni Papadopoulou", line1: "Ermou 10", city: "Athens", postcode: "10563", country: "GR" };

describe.skipIf(url === undefined || url === "")("commerce", () => {
  let connection: ReturnType<typeof postgres>;
  let store: CommerceStore;
  /** Variants by source id, with their product price. */
  let variants: Map<string, { id: string; priceCents: number }>;

  const stockOf = async (variantId: string) =>
    (await connection<{ stock: number }[]>`SELECT stock FROM product_variants WHERE id = ${variantId}`)[0]!.stock;
  const setStock = (variantId: string, stock: number) => connection`UPDATE product_variants SET stock = ${stock} WHERE id = ${variantId}`;

  const cartWith = async (lines: [variantId: string, quantity: number][]) => {
    let cartId: string | null = null;
    for (const [variantId, quantity] of lines) {
      const change = await store.changeLine(cartId, variantId, quantity, "add");
      if (!change.ok) throw new Error(change.reason);
      cartId = change.cartId;
    }
    return cartId!;
  };
  const checkout = (cartId: string, extra: Partial<Parameters<CommerceStore["placeOrder"]>[0]> = {}) =>
    store.placeOrder({ cartId, locale: "en", email: "Eleni@Example.com", address: ADDRESS, shipping: "standard", idempotencyKey: uuidv7(), paymentProvider: "local_test", ...extra });

  beforeAll(async () => {
    connection = postgres(url as string, { max: 4, onnotice: () => {} });
    const db = drizzle(connection, { schema });
    await migrate(db, { migrationsFolder: "./drizzle" });
    await connection`TRUNCATE products, brands, categories, carts, orders CASCADE`;
    const fixture = catalogFixtureSchema.parse(JSON.parse(await readFile("src/lib/catalog/fixtures/specimen.json", "utf8"))).products;
    await upsertCatalog(db, fixture);
    const rows = await connection<{ id: string; source_id: string; price_cents: number }[]>`
      SELECT v.id, p.source_id, p.price_cents FROM product_variants v JOIN products p ON p.id = v.product_id
    `;
    variants = new Map(rows.map((row) => [row.source_id, { id: row.id, priceCents: row.price_cents }]));
    store = createCommerceStore(connection);
  });

  beforeEach(async () => {
    await connection`TRUNCATE carts, orders CASCADE`;
  });

  afterAll(async () => {
    await connection?.end();
  });

  const pick = (index: number) => [...variants.values()][index]!;

  describe("cart", () => {
    it("adds, accumulates, sets and removes lines, with totals from current prices", async () => {
      const a = pick(0);
      const b = pick(1);
      await setStock(a.id, 20);
      await setStock(b.id, 20);
      const cartId = await cartWith([
        [a.id, 1],
        [b.id, 2],
        [a.id, 2],
      ]);
      let view = await store.viewCart(cartId, "en");
      expect(view.lines.map((line) => [line.variantId, line.quantity])).toEqual([
        [a.id, 3],
        [b.id, 2],
      ]);
      const subtotal = a.priceCents * 3 + b.priceCents * 2;
      expect(view.totals.subtotal.cents).toBe(subtotal);
      expect(await store.itemCount(cartId)).toBe(5);

      await store.changeLine(cartId, b.id, 0, "set");
      view = await store.viewCart(cartId, "en");
      expect(view.lines).toHaveLength(1);

      // A price change shows up in the cart immediately: carts never store prices.
      await connection`UPDATE products SET price_cents = price_cents + 100 WHERE id = (SELECT product_id FROM product_variants WHERE id = ${a.id})`;
      view = await store.viewCart(cartId, "en");
      expect(view.totals.subtotal.cents).toBe((a.priceCents + 100) * 3);
      await connection`UPDATE products SET price_cents = price_cents - 100 WHERE id = (SELECT product_id FROM product_variants WHERE id = ${a.id})`;
    });

    it("caps a line at the stock and at ten, and says so", async () => {
      const a = pick(2);
      await setStock(a.id, 3);
      const first = await store.changeLine(null, a.id, 5, "add");
      expect(first).toMatchObject({ ok: true, quantity: 3, limitedTo: 3 });
      await setStock(a.id, 50);
      const second = await store.changeLine(first.ok ? first.cartId : null, a.id, 25, "set");
      expect(second).toMatchObject({ ok: true, quantity: 10, limitedTo: 10 });
    });

    it("refuses sold-out and unknown variants, and ignores a forged cart id", async () => {
      const a = pick(3);
      await setStock(a.id, 0);
      expect(await store.changeLine(null, a.id, 1, "add")).toEqual({ ok: false, reason: "out_of_stock" });
      expect(await store.changeLine(null, uuidv7(), 1, "add")).toEqual({ ok: false, reason: "not_found" });
      await setStock(a.id, 5);
      const unknownCart = uuidv7();
      const change = await store.changeLine(unknownCart, a.id, 1, "add");
      expect(change.ok && change.cartId).not.toBe(unknownCart);
    });

    it("marks a line unavailable when its product is archived, and leaves it out of the totals", async () => {
      const a = pick(4);
      const b = pick(5);
      await setStock(a.id, 5);
      await setStock(b.id, 5);
      const cartId = await cartWith([
        [a.id, 1],
        [b.id, 1],
      ]);
      await connection`UPDATE products SET status = 'archived' WHERE id = (SELECT product_id FROM product_variants WHERE id = ${b.id})`;
      const view = await store.viewCart(cartId, "en");
      expect(view.lines.find((line) => line.variantId === b.id)?.available).toBe(false);
      expect(view.totals.subtotal.cents).toBe(a.priceCents);
      await connection`UPDATE products SET status = 'active' WHERE id = (SELECT product_id FROM product_variants WHERE id = ${b.id})`;
    });
  });

  describe("checkout", () => {
    it("places an order: snapshot totals, reserved stock, history, and an empty cart", async () => {
      const a = pick(6);
      await setStock(a.id, 4);
      const cartId = await cartWith([[a.id, 2]]);
      const result = await checkout(cartId);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.number).toMatch(/^VT-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
      expect(result.accessToken).not.toBeNull();

      expect(await stockOf(a.id)).toBe(2);
      expect(await store.itemCount(cartId)).toBe(0);

      const order = (await store.orderForToken(result.orderId, result.accessToken!))!;
      const subtotal = a.priceCents * 2;
      const shipping = subtotal >= SHIPPING_RATES.domestic.standard.freeFromBaseCents! ? 0 : SHIPPING_RATES.domestic.standard.baseCents;
      expect(order.status).toBe("pending_payment");
      expect(order.email).toBe("eleni@example.com");
      // Stored as a JSON object, not a JSON-encoded string.
      expect(order.address).toEqual(ADDRESS);
      const [stored] = await connection<{ kind: string }[]>`SELECT jsonb_typeof(shipping_address) AS kind FROM orders WHERE id = ${result.orderId}`;
      expect(stored?.kind).toBe("object");
      expect(order.subtotal.cents).toBe(subtotal);
      expect(order.total.cents).toBe(subtotal + shipping);
      expect(order.vat.cents).toBe(includedVat(subtotal + shipping));
      expect(order.items).toHaveLength(1);
      expect(order.events).toEqual([expect.objectContaining({ from: null, to: "pending_payment", event: "checkout", actor: "customer" })]);
      expect(order.paymentExpiresAt.getTime() - order.createdAt.getTime()).toBe(PAYMENT_WINDOW_MINUTES * 60_000);
    });

    it("stores the address as a JSON object whether or not Drizzle has wrapped the client", async () => {
      // Drizzle replaces postgres.js's JSON serialiser only on clients it wraps.
      // The app's shared client may or may not have been wrapped in a given
      // process, so the insert must not depend on it: this client never is.
      const plain = postgres(url as string, { max: 2, onnotice: () => {} });
      try {
        const plainStore = createCommerceStore(plain);
        const a = pick(6);
        await setStock(a.id, 4);
        const change = await plainStore.changeLine(null, a.id, 1, "add");
        if (!change.ok) throw new Error(change.reason);
        const result = await plainStore.placeOrder({ cartId: change.cartId, locale: "en", email: "a@example.com", address: ADDRESS, shipping: "standard", idempotencyKey: uuidv7(), paymentProvider: "local_test" });
        if (!result.ok) throw new Error(result.reason);
        const [stored] = await plain<{ kind: string }[]>`SELECT jsonb_typeof(shipping_address) AS kind FROM orders WHERE id = ${result.orderId}`;
        expect(stored?.kind).toBe("object");
        expect((await plainStore.readOrder(result.orderId))?.address).toEqual(ADDRESS);
      } finally {
        await plain.end();
      }
    });

    it("returns the same order for a repeated submission and reserves stock once", async () => {
      const a = pick(7);
      await setStock(a.id, 5);
      const cartId = await cartWith([[a.id, 1]]);
      const key = uuidv7();
      const first = await checkout(cartId, { idempotencyKey: key });
      const second = await checkout(cartId, { idempotencyKey: key });
      expect(first.ok && second.ok).toBe(true);
      if (!first.ok || !second.ok) return;
      expect(second.orderId).toBe(first.orderId);
      expect(second.replayed).toBe(true);
      expect(second.accessToken).toBeNull();
      expect(await stockOf(a.id)).toBe(4);
      expect((await connection`SELECT id FROM orders`).length).toBe(1);
    });

    it("gives the last item to exactly one of two shoppers checking out at once", async () => {
      const a = pick(8);
      await setStock(a.id, 1);
      const first = await cartWith([[a.id, 1]]);
      const second = await cartWith([[a.id, 1]]);
      const results = await Promise.all([checkout(first), checkout(second)]);
      expect(results.filter((result) => result.ok)).toHaveLength(1);
      expect(results.find((result) => !result.ok)).toMatchObject({ ok: false, reason: "unavailable", variantIds: [a.id] });
      expect(await stockOf(a.id)).toBe(0);
      expect((await connection`SELECT id FROM orders`).length).toBe(1);
    });

    it("rolls back every reservation when one line is short", async () => {
      const a = pick(9);
      const b = pick(10);
      await setStock(a.id, 5);
      await setStock(b.id, 5);
      const cartId = await cartWith([
        [a.id, 2],
        [b.id, 2],
      ]);
      await setStock(b.id, 1);
      const result = await checkout(cartId);
      expect(result).toMatchObject({ ok: false, reason: "unavailable", variantIds: [b.id] });
      expect(await stockOf(a.id)).toBe(5);
      expect(await store.itemCount(cartId)).toBe(4);
    });

    it("refuses an empty cart", async () => {
      const a = pick(11);
      await setStock(a.id, 5);
      const cartId = await cartWith([[a.id, 1]]);
      await store.changeLine(cartId, a.id, 0, "set");
      expect(await checkout(cartId)).toEqual({ ok: false, reason: "empty_cart" });
    });
  });

  describe("VAT by delivery country", () => {
    it("prices, taxes and records an order for Germany in German prices and 19% VAT", async () => {
      const a = pick(6);
      await setStock(a.id, 5);
      const cartId = await cartWith([[a.id, 2]]);
      const result = await checkout(cartId, { address: { ...ADDRESS, city: "Berlin", postcode: "10115", country: "DE" } });
      if (!result.ok) throw new Error(result.reason);
      const order = (await store.readOrder(result.orderId))!;
      const unit = localizeCents(a.priceCents, "DE");
      expect(order.vatCountry).toBe("DE");
      expect(order.vatRatePerMille).toBe(190);
      expect(order.items[0]!.unitPrice.cents).toBe(unit);
      expect(order.subtotal.cents).toBe(unit * 2);
      expect(order.vat.cents).toBe(includedVat(order.total.cents, 190));
      // Ordinary road freight to the rest of the EU.
      const expectedShipping = a.priceCents * 2 >= SHIPPING_RATES.eu.standard.freeFromBaseCents! ? 0 : localizeCents(SHIPPING_RATES.eu.standard.baseCents, "DE");
      expect(order.shipping.cents).toBe(expectedShipping);
    });

    it("keeps Greek prices and 24% VAT for a Greek address", async () => {
      const a = pick(7);
      await setStock(a.id, 5);
      const result = await checkout(await cartWith([[a.id, 1]]));
      if (!result.ok) throw new Error(result.reason);
      const order = (await store.readOrder(result.orderId))!;
      expect(order.vatCountry).toBe("GR");
      expect(order.vatRatePerMille).toBe(240);
      expect(order.items[0]!.unitPrice.cents).toBe(a.priceCents);
    });

    it("refuses delivery outside the EU and to places outside the EU VAT area, reserving nothing", async () => {
      const a = pick(8);
      await setStock(a.id, 5);
      const cartId = await cartWith([[a.id, 1]]);
      expect(await checkout(cartId, { address: { ...ADDRESS, postcode: "90210", country: "US" } })).toEqual({ ok: false, reason: "not_deliverable" });
      expect(await checkout(cartId, { address: { ...ADDRESS, city: "Las Palmas", postcode: "35001", country: "ES" } })).toEqual({
        ok: false,
        reason: "outside_vat_area",
        place: "canary_islands",
      });
      expect(await stockOf(a.id)).toBe(5);
      expect(await store.itemCount(cartId)).toBe(1);
    });

    it("shows a cart in the browsing country's prices without changing what is stored", async () => {
      const a = pick(9);
      await setStock(a.id, 5);
      const cartId = await cartWith([[a.id, 1]]);
      const swedish = await store.viewCart(cartId, "en", { country: "SE" });
      expect(swedish.lines[0]!.unitPrice.cents).toBe(localizeCents(a.priceCents, "SE"));
      expect(swedish.lines[0]!.baseUnitCents).toBe(a.priceCents);
      expect(swedish.totals.vatRatePerMille).toBe(250);
    });
  });

  describe("order events", () => {
    const placed = async (stock = 5, quantity = 2) => {
      const a = pick(12);
      await setStock(a.id, stock);
      const result = await checkout(await cartWith([[a.id, quantity]]));
      if (!result.ok) throw new Error(result.reason);
      return { variantId: a.id, ...result };
    };

    it("pays, packs, ships and delivers, recording each step", async () => {
      const order = await placed();
      for (const [type, actor] of [
        ["payment_succeeded", "system"],
        ["pack", "staff"],
        ["ship", "staff"],
        ["deliver", "staff"],
      ] as const) {
        expect(await store.applyEvent(order.orderId, type, actor)).toMatchObject({ ok: true });
      }
      const view = (await store.readOrder(order.orderId))!;
      expect(view.status).toBe("delivered");
      expect(view.paid).toBe(true);
      expect(view.deliveredAt).not.toBeNull();
      expect(view.events.map((event) => event.to)).toEqual(["pending_payment", "paid", "packed", "shipped", "delivered"]);
      expect(await stockOf(order.variantId)).toBe(3);
    });

    it("refuses a replayed payment and a customer shipping their own order, changing nothing", async () => {
      const order = await placed();
      await store.applyEvent(order.orderId, "payment_succeeded", "system");
      expect(await store.applyEvent(order.orderId, "payment_succeeded", "system")).toEqual({ ok: false, reason: "not_allowed" });
      expect(await store.applyEvent(order.orderId, "pack", "customer")).toEqual({ ok: false, reason: "wrong_actor" });
      expect((await store.readOrder(order.orderId))!.events).toHaveLength(2);
    });

    it("puts the stock back when a payment fails or the customer cancels", async () => {
      const failed = await placed(5, 2);
      expect(await stockOf(failed.variantId)).toBe(3);
      expect(await store.applyEvent(failed.orderId, "payment_failed", "system")).toMatchObject({ ok: true, to: "cancelled" });
      expect(await stockOf(failed.variantId)).toBe(5);

      const cancelled = await placed(5, 1);
      await store.applyEvent(cancelled.orderId, "payment_succeeded", "system");
      const result = await store.applyEvent(cancelled.orderId, "cancel", "customer");
      expect(result).toMatchObject({ ok: true, to: "cancelled" });
      expect(result.ok && result.effects).toContain("issue_refund");
      expect(await stockOf(cancelled.variantId)).toBe(5);
    });

    it("expires an unpaid order after the payment window, and not before", async () => {
      const order = await placed(5, 2);
      const created = (await store.readOrder(order.orderId))!.createdAt.getTime();
      expect(await store.expireIfDue(order.orderId, new Date(created + (PAYMENT_WINDOW_MINUTES - 1) * 60_000))).toBe(false);
      expect(await store.expireIfDue(order.orderId, new Date(created + (PAYMENT_WINDOW_MINUTES + 1) * 60_000))).toBe(true);
      expect((await store.readOrder(order.orderId))!.status).toBe("cancelled");
      expect(await stockOf(order.variantId)).toBe(5);
      expect(await store.expireIfDue(order.orderId, new Date(created + 60 * 60_000))).toBe(false);
    });

    it("shows an order only with its link's token", async () => {
      const order = await placed();
      expect(await store.orderForToken(order.orderId, order.accessToken!)).not.toBeNull();
      expect(await store.orderForToken(order.orderId, "wrong-token")).toBeNull();
      expect(await store.orderForToken(uuidv7(), order.accessToken!)).toBeNull();
    });
  });
});
