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
import { createOrderNotifier } from "@/lib/commerce/notify";
import { createCommerceStore, type CommerceStore } from "@/lib/commerce/store";
import { orderLinkToken } from "@/lib/commerce/tokens";
import { localizeCents } from "@/lib/commerce/vat";
import * as schema from "@/lib/db/schema";
import { createMailer, firstLink } from "@/lib/email/mailer";

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
    await connection`TRUNCATE carts, orders, users, email_outbox CASCADE`;
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

    it("refuses countries the shop does not deliver to and places outside the EU VAT area, reserving nothing", async () => {
      const a = pick(8);
      await setStock(a.id, 5);
      const cartId = await cartWith([[a.id, 1]]);
      expect(await checkout(cartId, { address: { ...ADDRESS, postcode: "01310-100", country: "BR" } })).toEqual({ ok: false, reason: "not_deliverable" });
      expect(await checkout(cartId, { address: { ...ADDRESS, city: "Las Palmas", postcode: "35001", country: "ES" } })).toEqual({
        ok: false,
        reason: "outside_vat_area",
        place: "canary_islands",
      });
      expect(await stockOf(a.id)).toBe(5);
      expect(await store.itemCount(cartId)).toBe(1);
    });

    it("exports to Switzerland without VAT, leaving the import VAT to be paid on delivery (docs/adr/015)", async () => {
      const a = pick(12);
      await setStock(a.id, 5);
      const result = await checkout(await cartWith([[a.id, 1]]), {
        address: { ...ADDRESS, city: "Zürich", postcode: "8001", country: "CH" },
      });
      if (!result.ok) throw new Error(result.reason);
      const order = (await store.readOrder(result.orderId))!;
      expect(order.vatCountry).toBe("CH");
      expect(order.vatRatePerMille).toBe(0);
      expect(order.vat.cents).toBe(0);
      // The price without Greek VAT, and export delivery to the rest of Europe.
      expect(order.items[0]!.unitPrice.cents).toBe(localizeCents(a.priceCents, "CH"));
      expect(order.total.cents).toBe(order.subtotal.cents + order.shipping.cents);
    });

    it("collects UK VAT itself on a small parcel to the United Kingdom", async () => {
      // The cheapest specimen piece is well under £135.
      const cheapest = [...variants.values()].sort((x, y) => x.priceCents - y.priceCents)[0]!;
      await setStock(cheapest.id, 5);
      const result = await checkout(await cartWith([[cheapest.id, 1]]), {
        address: { ...ADDRESS, city: "London", postcode: "SW1A 1AA", country: "GB" },
      });
      if (!result.ok) throw new Error(result.reason);
      const order = (await store.readOrder(result.orderId))!;
      expect(order.vatCountry).toBe("GB");
      expect(order.vatRatePerMille).toBe(200);
      expect(order.vat.cents).toBe(includedVat(order.total.cents, 200));
    });

    it("keeps the state on an address in the United States", async () => {
      const a = pick(13);
      await setStock(a.id, 5);
      const result = await checkout(await cartWith([[a.id, 1]]), {
        address: { ...ADDRESS, city: "Springfield", postcode: "62701", country: "US", region: "IL" },
      });
      if (!result.ok) throw new Error(result.reason);
      const order = (await store.readOrder(result.orderId))!;
      expect(order.address).toMatchObject({ city: "Springfield", postcode: "62701", country: "US", region: "IL" });
      expect(order.vatRatePerMille).toBe(0);
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

  describe("accounts (docs/adr/016)", () => {
    const newUser = async (email: string) => {
      const id = uuidv7();
      await connection`INSERT INTO users (id, name, email, email_verified) VALUES (${id}, 'Test Shopper', ${email}, true)`;
      return id;
    };

    it("turns the guest cart into the account's cart on sign-in, and keeps it from the next guest on that browser", async () => {
      const a = pick(0);
      await setStock(a.id, 20);
      const guest = await cartWith([[a.id, 2]]);
      const userId = await newUser("cart-owner@example.com");

      expect(await store.claimCart(userId, guest)).toBe(guest);
      expect((await store.viewCart(guest, "en")).lines.map((line) => line.quantity)).toEqual([2]);
      // Signed out, the same cookie no longer opens it.
      expect(await store.guestCart(guest)).toBeNull();
      // Signed in again, with no guest cart, the account's cart comes back.
      expect(await store.claimCart(userId, null)).toBe(guest);
    });

    it("adds a guest cart's lines to the account's own cart, capped per line, and deletes the guest cart", async () => {
      const a = pick(0);
      const b = pick(1);
      await setStock(a.id, 20);
      await setStock(b.id, 20);
      const userId = await newUser("merge@example.com");
      const owned = (await store.changeLine(null, a.id, 7, "add", userId)) as { ok: true; cartId: string };
      const guest = await cartWith([
        [a.id, 5],
        [b.id, 1],
      ]);

      expect(await store.claimCart(userId, guest)).toBe(owned.cartId);
      const view = await store.viewCart(owned.cartId, "en");
      expect(view.lines.map((line) => [line.variantId, line.quantity])).toEqual([
        [a.id, 10],
        [b.id, 1],
      ]);
      expect(await store.viewCart(guest, "en")).toMatchObject({ lines: [] });
      const [row] = await connection<{ count: number }[]>`SELECT count(*)::int AS count FROM carts WHERE id = ${guest}`;
      expect(row?.count).toBe(0);
    });

    it("never merges another account's cart", async () => {
      const a = pick(0);
      await setStock(a.id, 20);
      const first = await newUser("first@example.com");
      const second = await newUser("second@example.com");
      const theirs = (await store.changeLine(null, a.id, 1, "add", first)) as { ok: true; cartId: string };
      expect(await store.claimCart(second, theirs.cartId)).toBeNull();
      expect(await store.claimCart(first, null)).toBe(theirs.cartId);
    });

    it("lists an account's orders: those placed signed in, and guest orders only under a confirmed address", async () => {
      const a = pick(0);
      await setStock(a.id, 20);
      const userId = await newUser("history@example.com");
      const signedIn = await checkout(await cartWith([[a.id, 1]]), { userId, email: "history@example.com" });
      const asGuest = await checkout(await cartWith([[a.id, 2]]), { email: "History@Example.com" });
      const someoneElse = await checkout(await cartWith([[a.id, 1]]), { email: "other@example.com" });
      if (!signedIn.ok || !asGuest.ok || !someoneElse.ok) throw new Error("checkout failed");

      const confirmed = await store.ordersForOwner({ userId, verifiedEmail: "history@example.com" });
      expect(confirmed.map((order) => order.id).sort()).toEqual([signedIn.orderId, asGuest.orderId].sort());
      expect(confirmed.find((order) => order.id === asGuest.orderId)?.itemCount).toBe(2);

      const unconfirmed = await store.ordersForOwner({ userId, verifiedEmail: null });
      expect(unconfirmed.map((order) => order.id)).toEqual([signedIn.orderId]);

      expect(await store.orderForOwner(asGuest.orderId, { userId, verifiedEmail: "history@example.com" })).not.toBeNull();
      expect(await store.orderForOwner(asGuest.orderId, { userId, verifiedEmail: null })).toBeNull();
      expect(await store.orderForOwner(someoneElse.orderId, { userId, verifiedEmail: "history@example.com" })).toBeNull();
    });

    it("keeps an order when its account is deleted, and deletes the account's cart", async () => {
      const a = pick(0);
      await setStock(a.id, 20);
      const userId = await newUser("leaving@example.com");
      const order = await checkout(await cartWith([[a.id, 1]]), { userId });
      const cart = (await store.changeLine(null, a.id, 1, "add", userId)) as { ok: true; cartId: string };
      if (!order.ok) throw new Error("checkout failed");

      await connection`DELETE FROM users WHERE id = ${userId}`;
      const [kept] = await connection<{ user_id: string | null }[]>`SELECT user_id FROM orders WHERE id = ${order.orderId}`;
      expect(kept).toEqual({ user_id: null });
      const [row] = await connection<{ count: number }[]>`SELECT count(*)::int AS count FROM carts WHERE id = ${cart.cartId}`;
      expect(row?.count).toBe(0);
    });
  });

  describe("order desk and order emails (docs/adr/016)", () => {
    const SECRET = "c".repeat(40);

    it("derives each order's link from its id, so it can be rebuilt without being stored", async () => {
      const a = pick(0);
      await setStock(a.id, 20);
      const derived = createCommerceStore(connection, { orderToken: (orderId) => orderLinkToken(orderId, SECRET) });
      const cartId = (await derived.changeLine(null, a.id, 1, "add")) as { ok: true; cartId: string };
      const order = await derived.placeOrder({
        cartId: cartId.cartId,
        locale: "el",
        email: "eleni@example.com",
        address: ADDRESS,
        shipping: "standard",
        idempotencyKey: uuidv7(),
        paymentProvider: "local_test",
      });
      if (!order.ok) throw new Error("checkout failed");
      expect(order.accessToken).toBe(orderLinkToken(order.orderId, SECRET));
      expect(await derived.orderForToken(order.orderId, orderLinkToken(order.orderId, SECRET))).not.toBeNull();
    });

    it("lists orders by queue, oldest first, finds them by number or email, and counts them", async () => {
      const a = pick(0);
      await setStock(a.id, 50);
      const first = await checkout(await cartWith([[a.id, 1]]), { email: "first@example.com", now: new Date("2026-09-10T10:00:00Z") });
      const second = await checkout(await cartWith([[a.id, 1]]), { email: "second@example.com", now: new Date("2026-09-11T10:00:00Z") });
      const waiting = await checkout(await cartWith([[a.id, 1]]), { email: "waiting@example.com", now: new Date() });
      if (!first.ok || !second.ok || !waiting.ok) throw new Error("checkout failed");
      for (const order of [first, second]) await store.applyEvent(order.orderId, "payment_succeeded", "system");

      const toPack = await store.deskOrders({ statuses: ["paid"], oldestFirst: true });
      expect(toPack.map((order) => order.id)).toEqual([first.orderId, second.orderId]);
      expect(toPack[0]).toMatchObject({ email: "first@example.com", name: "Eleni Papadopoulou", country: "GR", itemCount: 1 });

      expect((await store.deskOrders({ statuses: null, query: "SECOND@example" })).map((order) => order.id)).toEqual([second.orderId]);
      expect((await store.deskOrders({ statuses: null, query: second.number.slice(-4) })).map((order) => order.id)).toEqual([second.orderId]);
      // A typed wildcard is a character, not "anything".
      expect(await store.deskOrders({ statuses: null, query: "%" })).toEqual([]);

      expect(await store.statusCounts()).toEqual({ paid: 2, pending_payment: 1 });
    });

    it("records which person moved an order, and why", async () => {
      const a = pick(0);
      await setStock(a.id, 20);
      const staffId = uuidv7();
      await connection`INSERT INTO users (id, name, email, email_verified, role) VALUES (${staffId}, 'Sofia Staff', 'sofia@vitrine.test', true, 'support')`;
      const order = await checkout(await cartWith([[a.id, 1]]));
      if (!order.ok) throw new Error("checkout failed");
      await store.applyEvent(order.orderId, "payment_succeeded", "system");
      await store.applyEvent(order.orderId, "cancel", "staff", { actorUserId: staffId, reason: "Customer phoned to cancel" });

      const view = await store.readOrder(order.orderId);
      expect(view?.events.at(-1)).toMatchObject({ event: "cancel", actor: "staff", actorName: "Sofia Staff", reason: "Customer phoned to cancel" });
    });

    it("emails the customer on payment and shipping, in the order's language, with the guest's own link", async () => {
      const a = pick(0);
      await setStock(a.id, 20);
      const derived = createCommerceStore(connection, { orderToken: (orderId) => orderLinkToken(orderId, SECRET) });
      const mailer = createMailer({ sql: connection, from: "Vitrine <test@example.com>" });
      const notifier = createOrderNotifier({ store: derived, mailer, appUrl: "http://localhost:3000", secret: SECRET });
      const cart = (await derived.changeLine(null, a.id, 1, "add")) as { ok: true; cartId: string };
      const order = await derived.placeOrder({
        cartId: cart.cartId,
        locale: "el",
        email: "Guest@Example.com",
        address: ADDRESS,
        shipping: "standard",
        idempotencyKey: uuidv7(),
        paymentProvider: "local_test",
      });
      if (!order.ok) throw new Error("checkout failed");

      const paid = await derived.applyEvent(order.orderId, "payment_succeeded", "system");
      if (!paid.ok) throw new Error("payment failed");
      expect(await notifier.notify(order.orderId, paid.effects)).toEqual(["confirmed"]);
      const packed = await derived.applyEvent(order.orderId, "pack", "staff");
      // Packing is internal: no email.
      expect(await notifier.notify(order.orderId, packed.ok ? packed.effects : [])).toEqual([]);
      const shipped = await derived.applyEvent(order.orderId, "ship", "staff");
      expect(await notifier.notify(order.orderId, shipped.ok ? shipped.effects : [])).toEqual(["shipped"]);

      const emails = await mailer.recent({ to: "guest@example.com" });
      expect(emails.map((email) => email.kind)).toEqual(["order_shipped", "order_confirmed"]);
      expect(emails[0]!.subject).toBe(`Η παραγγελία ${order.number} είναι καθ’ οδόν`);
      const link = new URL(firstLink(emails[0]!.text)!);
      expect(link.pathname).toBe(`/el/orders/${order.orderId}`);
      expect(await derived.orderForToken(order.orderId, link.searchParams.get("t")!)).not.toBeNull();
    });

    it("links to the order page without a token when the order's link cannot be rebuilt", async () => {
      const a = pick(0);
      await setStock(a.id, 20);
      // An order placed with a random token (before links were derived).
      const order = await checkout(await cartWith([[a.id, 1]]), { email: "older@example.com" });
      if (!order.ok) throw new Error("checkout failed");
      const mailer = createMailer({ sql: connection, from: "Vitrine <test@example.com>" });
      const notifier = createOrderNotifier({ store, mailer, appUrl: "http://localhost:3000", secret: SECRET });
      await notifier.notify(order.orderId, ["email_order_cancelled"]);
      const [email] = await mailer.recent({ to: "older@example.com" });
      expect(firstLink(email!.text)).toBe(`http://localhost:3000/en/orders/${order.orderId}`);
      expect(email!.text).toContain("Sign in to see the order in your account.");
    });
  });
});
