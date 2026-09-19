/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Integration tests for verified reviews: who may review, rating totals, edits and moderation.
 */

import { readFile } from "node:fs/promises";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { uuidv7 } from "uuidv7";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { catalogFixtureSchema } from "@/lib/catalog/input";
import { upsertCatalog } from "@/lib/catalog/write";
import { createReviewStore, type ReviewStore } from "@/lib/commerce/review-store";
import { reviewInputSchema } from "@/lib/commerce/reviews";
import { createCommerceStore, type CommerceStore } from "@/lib/commerce/store";
import * as schema from "@/lib/db/schema";

const url = process.env.DATABASE_URL;
const ADDRESS = { name: "Eleni Papadopoulou", line1: "Ermou 10", city: "Athens", postcode: "10563", country: "GR" };

describe.skipIf(url === undefined || url === "")("reviews", () => {
  let connection: ReturnType<typeof postgres>;
  let store: CommerceStore;
  let reviews: ReviewStore;
  let variant: { id: string; productId: string };

  const review = (rating: number, body = "Solid, well made and exactly as the photos show it.") => reviewInputSchema.parse({ rating, body });
  const totals = async () =>
    (await connection<{ rating_sum: number; rating_count: number }[]>`SELECT rating_sum, rating_count FROM products WHERE id = ${variant.productId}`)[0]!;

  /** A placed order for one lamp, moved through the given events; returns the order and its line. */
  const order = async (events: ("payment_succeeded" | "pack" | "ship" | "deliver")[]) => {
    const cart = (await store.changeLine(null, variant.id, 1, "add")) as { ok: true; cartId: string };
    const placed = await store.placeOrder({
      cartId: cart.cartId,
      locale: "en",
      email: "eleni@example.com",
      address: ADDRESS,
      shipping: "standard",
      idempotencyKey: uuidv7(),
      paymentProvider: "local_test",
    });
    if (!placed.ok) throw new Error("checkout failed");
    for (const event of events) await store.applyEvent(placed.orderId, event, event === "payment_succeeded" ? "system" : "staff");
    const [line] = await connection<{ id: string }[]>`SELECT id FROM order_items WHERE order_id = ${placed.orderId}`;
    return { orderId: placed.orderId, itemId: line!.id };
  };
  const delivered = () => order(["payment_succeeded", "pack", "ship", "deliver"]);

  beforeAll(async () => {
    connection = postgres(url as string, { max: 4, onnotice: () => {} });
    const db = drizzle(connection, { schema });
    await migrate(db, { migrationsFolder: "./drizzle" });
    await connection`TRUNCATE products, brands, categories, carts, orders CASCADE`;
    await upsertCatalog(db, catalogFixtureSchema.parse(JSON.parse(await readFile("src/lib/catalog/fixtures/specimen.json", "utf8"))).products);
    const [row] = await connection<{ id: string; product_id: string }[]>`SELECT id, product_id FROM product_variants ORDER BY sku LIMIT 1`;
    variant = { id: row!.id, productId: row!.product_id };
    store = createCommerceStore(connection);
    reviews = createReviewStore(connection);
  });

  beforeEach(async () => {
    await connection`TRUNCATE carts, orders, reviews CASCADE`;
    await connection`UPDATE products SET rating_sum = 0, rating_count = 0`;
    await connection`UPDATE product_variants SET stock = 50 WHERE id = ${variant.id}`;
  });

  afterAll(async () => {
    await connection?.end();
  });

  it("accepts a review only for a line that was delivered", async () => {
    const paid = await order(["payment_succeeded"]);
    expect(await reviews.saveReview({ orderId: paid.orderId, orderItemId: paid.itemId, input: review(5), userId: null, locale: "en" })).toEqual({
      ok: false,
      reason: "not_delivered",
    });
    const done = await delivered();
    // A line of another order is not this order's to review.
    expect(await reviews.saveReview({ orderId: paid.orderId, orderItemId: done.itemId, input: review(5), userId: null, locale: "en" })).toEqual({
      ok: false,
      reason: "not_found",
    });
    const saved = await reviews.saveReview({ orderId: done.orderId, orderItemId: done.itemId, input: review(5), userId: null, locale: "en" });
    expect(saved).toMatchObject({ ok: true, created: true });
    expect(await totals()).toEqual({ rating_sum: 5, rating_count: 1 });
  });

  it("shows the author as a first name and initial, and lists the product's reviews with their summary", async () => {
    for (const rating of [5, 4, 4]) {
      const line = await delivered();
      await reviews.saveReview({ orderId: line.orderId, orderItemId: line.itemId, input: review(rating), userId: null, locale: "el" });
    }
    const { summary, reviews: list } = await reviews.productReviews(variant.productId);
    expect(summary).toEqual({ count: 3, average: 13 / 3, distribution: [0, 0, 0, 2, 1] });
    expect(list).toHaveLength(3);
    expect(list[0]).toMatchObject({ authorName: "Eleni P.", locale: "el", edited: false });
  });

  it("rewrites a review instead of adding a second one, and keeps the totals exact", async () => {
    const line = await delivered();
    await reviews.saveReview({ orderId: line.orderId, orderItemId: line.itemId, input: review(2), userId: null, locale: "en" });
    const again = await reviews.saveReview({ orderId: line.orderId, orderItemId: line.itemId, input: review(4, "Better than I first thought, after a week of use."), userId: null, locale: "en" });
    expect(again).toMatchObject({ ok: true, created: false });
    expect(await totals()).toEqual({ rating_sum: 4, rating_count: 1 });
    expect((await reviews.productReviews(variant.productId)).reviews[0]!.body).toBe("Better than I first thought, after a week of use.");
  });

  it("takes a hidden review out of the totals and puts it back when restored", async () => {
    const one = await delivered();
    const two = await delivered();
    await reviews.saveReview({ orderId: one.orderId, orderItemId: one.itemId, input: review(5), userId: null, locale: "en" });
    const hidden = await reviews.saveReview({ orderId: two.orderId, orderItemId: two.itemId, input: review(1), userId: null, locale: "en" });
    if (!hidden.ok) throw new Error("save failed");
    const staffId = uuidv7();
    await connection`INSERT INTO users (id, name, email, email_verified, role) VALUES (${staffId}, 'Sofia', ${`sofia.${staffId}@vitrine.test`}, true, 'support')`;

    await reviews.moderate(hidden.reviewId, { status: "hidden", reason: "Personal details in the text", actor: { userId: staffId, email: "sofia@vitrine.test" } });
    expect(await totals()).toEqual({ rating_sum: 5, rating_count: 1 });
    expect((await reviews.productReviews(variant.productId)).summary.count).toBe(1);
    // Hiding twice changes nothing.
    await reviews.moderate(hidden.reviewId, { status: "hidden", reason: "Again", actor: { userId: staffId, email: "sofia@vitrine.test" } });
    expect(await totals()).toEqual({ rating_sum: 5, rating_count: 1 });

    await reviews.moderate(hidden.reviewId, { status: "published", reason: null, actor: { userId: staffId, email: "sofia@vitrine.test" } });
    expect(await totals()).toEqual({ rating_sum: 6, rating_count: 2 });
    const [desk] = await reviews.deskReviews({ status: "published" });
    expect(desk).toMatchObject({ productSlug: expect.any(String), orderNumber: expect.stringMatching(/^VT-/) });
  });

  it("agrees with a full recount after any sequence of writes", async () => {
    const lines = [await delivered(), await delivered(), await delivered()];
    await reviews.saveReview({ orderId: lines[0]!.orderId, orderItemId: lines[0]!.itemId, input: review(3), userId: null, locale: "en" });
    await reviews.saveReview({ orderId: lines[1]!.orderId, orderItemId: lines[1]!.itemId, input: review(5), userId: null, locale: "en" });
    await reviews.saveReview({ orderId: lines[0]!.orderId, orderItemId: lines[0]!.itemId, input: review(1), userId: null, locale: "en" });
    const third = await reviews.saveReview({ orderId: lines[2]!.orderId, orderItemId: lines[2]!.itemId, input: review(4), userId: null, locale: "en" });
    if (!third.ok) throw new Error("save failed");
    const staffId = uuidv7();
    await connection`INSERT INTO users (id, name, email, email_verified, role) VALUES (${staffId}, 'Sofia', ${`sofia.${staffId}@vitrine.test`}, true, 'support')`;
    await reviews.moderate(third.reviewId, { status: "hidden", reason: "test", actor: { userId: staffId, email: "sofia@vitrine.test" } });

    const incremental = await totals();
    expect(await reviews.recount(variant.productId)).toEqual({ ratingSum: incremental.rating_sum, ratingCount: incremental.rating_count });
    expect(incremental).toEqual({ rating_sum: 6, rating_count: 2 });
  });

  it("lets a returned order's lines be reviewed too: the piece was received", async () => {
    const line = await delivered();
    await store.applyEvent(line.orderId, "request_return", "customer");
    const saved = await reviews.saveReview({ orderId: line.orderId, orderItemId: line.itemId, input: review(2), userId: null, locale: "en" });
    expect(saved.ok).toBe(true);
    expect((await reviews.orderReviews(line.orderId)).get(line.itemId)).toMatchObject({ rating: 2, status: "published" });
  });
});
