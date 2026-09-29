/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Integration tests for Stripe payments: signed webhooks against real orders, with no network.
 */

import { readFile } from "node:fs/promises";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import Stripe from "stripe";
import { uuidv7 } from "uuidv7";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { catalogFixtureSchema } from "@/lib/catalog/input";
import { upsertCatalog } from "@/lib/catalog/write";
import type { SideEffect } from "@/lib/commerce/order-state";
import { createCommerceStore, type CommerceStore } from "@/lib/commerce/store";
import * as schema from "@/lib/db/schema";
import { createStripePayments, type StripeLike } from "@/lib/payments/stripe-payments";

/**
 * docs/adr/038. Events are signed here with the Stripe SDK's own test helper
 * and a made-up secret, then checked by the same SDK in the webhook: the
 * signature rule is Stripe's, and nothing leaves the machine. PaymentIntents and
 * refunds are a stand-in that records what the shop asked for.
 */

const url = process.env.DATABASE_URL;
const SECRET = "whsec_test_integration_secret_0123456789";
const ADDRESS = { name: "Eleni Papadopoulou", line1: "Ermou 10", city: "Athens", postcode: "10563", country: "GR" };

describe.skipIf(url === undefined || url === "")("Stripe payments", () => {
  let connection: ReturnType<typeof postgres>;
  let store: CommerceStore;
  let variantId: string;
  const sdk = new Stripe("sk_test_not_used_for_any_request");
  const calls: { method: string; args: unknown[] }[] = [];
  let intentStatus = "requires_payment_method";
  const effectsSeen: SideEffect[][] = [];

  const fakeStripe: StripeLike = {
    paymentIntents: {
      create: async (params, options) => {
        calls.push({ method: "paymentIntents.create", args: [params, options] });
        return { id: `pi_${calls.length}`, client_secret: `pi_${calls.length}_secret_x`, status: "requires_payment_method" };
      },
      retrieve: async (id) => {
        calls.push({ method: "paymentIntents.retrieve", args: [id] });
        return { id, client_secret: `${id}_secret_x`, status: intentStatus };
      },
      cancel: async (id) => {
        calls.push({ method: "paymentIntents.cancel", args: [id] });
        return { id, status: "canceled" };
      },
    },
    refunds: {
      create: async (params, options) => {
        calls.push({ method: "refunds.create", args: [params, options] });
        return { id: "re_1", status: "succeeded" };
      },
    },
    // The real verification, so a wrong signature is refused exactly as in production.
    webhooks: { constructEvent: (payload, header, secret) => sdk.webhooks.constructEvent(payload, header, secret) },
  };

  const payments = () =>
    createStripePayments({
      sql: connection,
      stripe: async () => fakeStripe,
      webhookSecret: SECRET,
      applyEvent: (orderId, type, reason) => store.applyEvent(orderId, type, "system", { reason }),
      afterEvent: async (_orderId, effects) => {
        effectsSeen.push([...effects]);
      },
      log: { warn: () => {}, error: () => {} },
    });

  const signed = (event: object) => {
    const payload = JSON.stringify(event);
    return { payload, header: sdk.webhooks.generateTestHeaderString({ payload, secret: SECRET }) };
  };

  const succeeded = (orderId: string, intentId: string, amount: number, eventId = `evt_${uuidv7()}`) => ({
    id: eventId,
    object: "event",
    type: "payment_intent.succeeded",
    data: { object: { id: intentId, object: "payment_intent", amount, amount_received: amount, currency: "eur", metadata: { orderId } } },
  });

  const placeStripeOrder = async () => {
    const change = await store.changeLine(null, variantId, 1, "add");
    if (!change.ok) throw new Error(change.reason);
    const placed = await store.placeOrder({ cartId: change.cartId, locale: "en", email: "eleni@example.com", address: ADDRESS, shipping: "standard", idempotencyKey: uuidv7(), paymentProvider: "stripe" });
    if (!placed.ok) throw new Error(placed.reason);
    const [row] = await connection<{ total_cents: number }[]>`SELECT total_cents FROM orders WHERE id = ${placed.orderId}`;
    return { orderId: placed.orderId, total: row!.total_cents };
  };

  const statusOf = async (orderId: string) => (await connection<{ status: string }[]>`SELECT status FROM orders WHERE id = ${orderId}`)[0]!.status;

  beforeAll(async () => {
    connection = postgres(url as string, { max: 4, onnotice: () => {} });
    const db = drizzle(connection, { schema });
    await migrate(db, { migrationsFolder: "./drizzle" });
    await connection`TRUNCATE products, brands, categories, carts, orders CASCADE`;
    const fixture = catalogFixtureSchema.parse(JSON.parse(await readFile("src/lib/catalog/fixtures/specimen.json", "utf8"))).products;
    await upsertCatalog(db, fixture);
    const [variant] = await connection<{ id: string }[]>`SELECT v.id FROM product_variants v ORDER BY v.id LIMIT 1`;
    variantId = variant!.id;
    await connection`UPDATE product_variants SET stock = 100 WHERE id = ${variantId}`;
    store = createCommerceStore(connection);
  });

  beforeEach(async () => {
    await connection`TRUNCATE carts, orders, payment_events CASCADE`;
    calls.length = 0;
    effectsSeen.length = 0;
    intentStatus = "requires_payment_method";
  });

  afterAll(async () => {
    await connection?.end();
  });

  it("starts one payment per order, for the total the database holds, and keeps its reference", async () => {
    const { orderId, total } = await placeStripeOrder();
    const first = await payments().startPayment(orderId);
    expect(first).toEqual({ ok: true, clientSecret: "pi_1_secret_x" });
    expect(calls[0]).toMatchObject({ method: "paymentIntents.create", args: [{ amount: total, currency: "eur", metadata: { orderId } }, { idempotencyKey: `vitrine-order-${orderId}` }] });
    // A second press reuses the same intent.
    expect(await payments().startPayment(orderId)).toEqual({ ok: true, clientSecret: "pi_1_secret_x" });
    expect(calls.filter((call) => call.method === "paymentIntents.create")).toHaveLength(1);
  });

  it("marks the order paid from a signed webhook, once, however often it is delivered", async () => {
    const { orderId, total } = await placeStripeOrder();
    await payments().startPayment(orderId);
    const { payload, header } = signed(succeeded(orderId, "pi_1", total, "evt_paid_1"));

    expect(await payments().handleWebhook(payload, header)).toMatchObject({ status: 200, outcome: "applied" });
    expect(await statusOf(orderId)).toBe("paid");
    expect(effectsSeen).toEqual([["email_order_confirmed", "record_purchase"]]);

    expect(await payments().handleWebhook(payload, header)).toMatchObject({ status: 200, outcome: "duplicate" });
    const [history] = await connection<{ n: number }[]>`SELECT count(*)::int AS n FROM order_events WHERE order_id = ${orderId} AND event = 'payment_succeeded'`;
    expect(history!.n).toBe(1);
  });

  it("refuses a delivery whose signature is not Stripe's", async () => {
    const { orderId, total } = await placeStripeOrder();
    await payments().startPayment(orderId);
    const { payload } = signed(succeeded(orderId, "pi_1", total));
    const forged = sdk.webhooks.generateTestHeaderString({ payload, secret: "whsec_someone_else_entirely_000000" });
    expect(await payments().handleWebhook(payload, forged)).toEqual({ status: 400, outcome: "bad_signature" });
    expect(await payments().handleWebhook(payload, null)).toEqual({ status: 400, outcome: "bad_signature" });
    expect(await statusOf(orderId)).toBe("pending_payment");
  });

  it("does not mark an order paid for the wrong amount, and records why", async () => {
    const { orderId, total } = await placeStripeOrder();
    await payments().startPayment(orderId);
    const { payload, header } = signed(succeeded(orderId, "pi_1", total - 1, "evt_short"));
    expect(await payments().handleWebhook(payload, header)).toMatchObject({ outcome: "alerted" });
    expect(await statusOf(orderId)).toBe("pending_payment");
    const [row] = await connection<{ outcome: string; order_id: string }[]>`SELECT outcome, order_id FROM payment_events WHERE id = 'evt_short'`;
    expect(row).toEqual({ outcome: "alerted", order_id: orderId });
  });

  it("voids the payment of an order whose hold ran out, and refunds one paid after it", async () => {
    const { orderId, total } = await placeStripeOrder();
    await payments().startPayment(orderId);
    await connection`UPDATE orders SET payment_expires_at = now() - interval '1 minute' WHERE id = ${orderId}`;
    const expired = await store.expireDue();
    expect(expired.map((entry) => entry.orderId)).toEqual([orderId]);
    await payments().runPaymentEffects(orderId, expired[0]!.effects);
    expect(calls.some((call) => call.method === "paymentIntents.cancel")).toBe(true);

    // The shopper had already pressed pay in another tab: the money comes back.
    const { payload, header } = signed(succeeded(orderId, "pi_1", total));
    expect(await payments().handleWebhook(payload, header)).toMatchObject({ outcome: "refunded" });
    expect(calls.at(-1)).toMatchObject({ method: "refunds.create", args: [{ payment_intent: "pi_1" }, { idempotencyKey: "vitrine-refund-pi_1" }] });
    expect(await statusOf(orderId)).toBe("cancelled");
  });

  it("refunds a paid order that is cancelled, and finishes when Stripe confirms the refund", async () => {
    const { orderId, total } = await placeStripeOrder();
    await payments().startPayment(orderId);
    const paid = signed(succeeded(orderId, "pi_1", total));
    await payments().handleWebhook(paid.payload, paid.header);

    const cancelled = await store.applyEvent(orderId, "cancel", "customer");
    expect(cancelled.ok).toBe(true);
    await payments().runPaymentEffects(orderId, cancelled.ok ? cancelled.effects : []);
    expect(calls.at(-1)).toMatchObject({ method: "refunds.create", args: [{ payment_intent: "pi_1" }, { idempotencyKey: "vitrine-refund-pi_1" }] });

    const refunded = signed({
      id: "evt_refunded",
      object: "event",
      type: "charge.refunded",
      data: { object: { id: "ch_1", object: "charge", amount: total, amount_refunded: total, refunded: true, payment_intent: "pi_1" } },
    });
    expect(await payments().handleWebhook(refunded.payload, refunded.header)).toMatchObject({ outcome: "applied", detail: "refund" });
    expect(await statusOf(orderId)).toBe("refunded");
  });

  it("leaves local test orders alone", async () => {
    const change = await store.changeLine(null, variantId, 1, "add");
    const placed = await store.placeOrder({ cartId: change.ok ? change.cartId : "", locale: "en", email: "a@example.com", address: ADDRESS, shipping: "standard", idempotencyKey: uuidv7(), paymentProvider: "local_test" });
    const orderId = placed.ok ? placed.orderId : "";
    expect(await payments().startPayment(orderId)).toEqual({ ok: false, reason: "wrong_provider" });
    await payments().runPaymentEffects(orderId, ["void_payment", "issue_refund"]);
    expect(calls).toEqual([]);
  });
});
