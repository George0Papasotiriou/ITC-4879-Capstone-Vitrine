/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Integration tests for the Fit Engine's evidence against PostgreSQL: reviewers' fit remarks, then sizes returned as too small and sizes kept past the window.
 */

import { readFile } from "node:fs/promises";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { uuidv7 } from "uuidv7";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { catalogFixtureSchema } from "@/lib/catalog/input";
import { CAPSULE_SIZES } from "@/lib/catalog/taxonomy";
import { upsertCatalog } from "@/lib/catalog/write";
import { createCommerceStore, type CommerceStore } from "@/lib/commerce/store";
import * as schema from "@/lib/db/schema";
import { createFitStore } from "@/lib/fit/size/store";
import { amazonReviewsFixtureSchema } from "@/lib/reviews/amazon";
import { createExternalReviewStore } from "@/lib/reviews/external-store";

/**
 * docs/adr/064. The engine reads a garment's remarks from the synced Amazon
 * summaries and its outcomes from the shop's own delivered orders: a return
 * asked for as "too small" teaches at once, a size kept teaches only once
 * the 14-day window has closed, and a return for another reason teaches
 * nothing.
 */

const url = process.env.DATABASE_URL;
const ADDRESS = { name: "Eleni Papadopoulou", line1: "Ermou 10", city: "Athens", postcode: "10563", country: "GR" };
const DAY = 24 * 60 * 60 * 1000;

describe.skipIf(url === undefined || url === "")("the Fit Engine's evidence in the database", () => {
  let connection: ReturnType<typeof postgres>;
  let store: CommerceStore;
  let productId: string;
  const variants: Record<string, string> = {};

  /** One delivered order of this size; a return asked for with `reason` if given. */
  const deliver = async (size: string, reason?: string) => {
    const cart = (await store.changeLine(null, variants[size]!, 1, "add")) as { ok: true; cartId: string };
    const placed = await store.placeOrder({ cartId: cart.cartId, locale: "en", email: "eleni@example.com", address: ADDRESS, shipping: "standard", idempotencyKey: uuidv7(), paymentProvider: "local_test" });
    if (!placed.ok) throw new Error("checkout failed");
    for (const event of ["payment_succeeded", "pack", "ship", "deliver"] as const) await store.applyEvent(placed.orderId, event, event === "payment_succeeded" ? "system" : "staff");
    if (reason !== undefined) await store.applyEvent(placed.orderId, "request_return", "customer", { reason });
  };

  beforeAll(async () => {
    connection = postgres(url as string, { max: 4, onnotice: () => {} });
    const db = drizzle(connection, { schema });
    await migrate(db, { migrationsFolder: "./drizzle" });
    await connection`TRUNCATE carts, orders CASCADE`;
    const clothes = catalogFixtureSchema.parse(JSON.parse(await readFile("src/lib/catalog/fixtures/clothes-specimen.json", "utf8"))).products;
    await upsertCatalog(db, clothes);
    const reviews = amazonReviewsFixtureSchema.parse(JSON.parse(await readFile("src/lib/catalog/fixtures/amazon-clothes-reviews.json", "utf8")));
    await createExternalReviewStore(connection).syncAmazon(reviews.products);
    // A top with remarks, sizes XS–XL and stock in M and L.
    const [row] = await connection<{ id: string }[]>`
      SELECT p.id FROM products p JOIN external_review_summaries s ON s.product_id = p.id
      WHERE p.kind IN ('TOP', 'SHIRT', 'KNIT') AND p.status = 'active' ORDER BY p.slug LIMIT 1
    `;
    productId = row!.id;
    for (const variant of await connection<{ id: string; size: string }[]>`SELECT id, size FROM product_variants WHERE product_id = ${productId}`) variants[variant.size] = variant.id;
    await connection`UPDATE product_variants SET stock = 50 WHERE product_id = ${productId}`;
    store = createCommerceStore(connection);
  });

  afterAll(async () => {
    await connection?.end();
  });

  it("reads the remarks, then learns from size returns at once and from kept sizes after the window", async () => {
    const before = await createFitStore(connection).forProduct(productId, CAPSULE_SIZES, 0);
    expect(before.remarks).toBeGreaterThan(0);
    expect(before.outcomes).toBe(0);

    for (let i = 0; i < 4; i += 1) await deliver("M", "too_small: tight across the shoulders");
    await deliver("L");
    await deliver("L");
    // A change of mind says nothing about fit.
    await deliver("M", "changed_mind");

    // Today the kept sizes are still inside their window: only the four returns count.
    const today = await createFitStore(connection).forProduct(productId, CAPSULE_SIZES, 0);
    expect(today.outcomes).toBe(4);
    // Four "too small" returns: the piece runs smaller than its remarks alone said.
    expect(today.item.offset.mean).toBeLessThan(before.item.offset.mean);

    // A month on, the two kept L count as fits too.
    const later = await createFitStore(connection, () => new Date(Date.now() + 30 * DAY)).forProduct(productId, CAPSULE_SIZES, 0);
    expect(later.outcomes).toBe(6);
    // Two shoppers who took their own size and kept it: the lean is pulled back towards true to size.
    expect(later.item.offset.mean).toBeGreaterThan(today.item.offset.mean);
  });

  it("starts a stretchy piece more forgiving, and knows nothing of a piece without remarks or orders", async () => {
    const woven = await createFitStore(connection).forProduct(productId, CAPSULE_SIZES, 0);
    const stretchy = await createFitStore(connection).forProduct(productId, CAPSULE_SIZES, 5);
    expect(stretchy.item.tolerance.mean).toBeGreaterThan(woven.item.tolerance.mean);
    const unknown = await createFitStore(connection).forProduct(uuidv7(), CAPSULE_SIZES, 0);
    expect(unknown).toMatchObject({ remarks: 0, outcomes: 0, lean: "true", cut: "usual" });
  });
});
