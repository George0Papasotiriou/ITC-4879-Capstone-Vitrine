/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Demo orders for the local shop: orders placed over past weeks and moved through their steps by the real store.
 */

/**
 * Demo orders (docs/PLAN.md Phase 5 step 7).
 *
 *   pnpm orders demo [--count 40] [--days 30] [--seed N] [--dry-run]
 *
 * Places `count` orders at moments over the last `days` and moves each one
 * through the life src/lib/commerce/demo-orders.ts plans for it: paid,
 * packed, shipped, delivered, sometimes reviewed or returned, sometimes
 * cancelled or never paid. Every step goes through the same store and state
 * machine as the shop, dated when it happened, so stock, totals, VAT and the
 * history are exactly what real orders would leave. No emails are sent.
 *
 * Local stack only: it writes customers who do not exist. Pieces with fewer
 * than four left are never chosen, so a demo cannot sell the shop out. Staff
 * steps are recorded as the demo support account's and a share of orders
 * belong to the demo customer, when `pnpm accounts demo` has created them.
 */

import { randomInt } from "node:crypto";
import { parseArgs } from "node:util";

import postgres from "postgres";
import { uuidv7 } from "uuidv7";

import type { ShippingAddress } from "@/lib/db/schema";
import { demoPlacedAt, pickWeighted, planDemoOrder, type DemoPlan } from "@/lib/commerce/demo-orders";
import { transition, type OrderSnapshot, type OrderStatus } from "@/lib/commerce/order-state";
import { createReviewStore } from "@/lib/commerce/review-store";
import { reviewInputSchema } from "@/lib/commerce/reviews";
import { createCommerceStore } from "@/lib/commerce/store";
import { orderLinkToken } from "@/lib/commerce/tokens";
import { seededRandom } from "@/lib/reco/simulate";

type Customer = { name: string; locale: "en" | "el" };
type Place = { country: string; city: string; postcode: string; line1: string; region?: string };

/** Where demo orders go: mostly Greece, as the shop's prices are Greek, and a few beyond. */
const PLACES: readonly (readonly [Place, number])[] = [
  [{ country: "GR", city: "Athens", postcode: "105 63", line1: "Ermou 10" }, 0.3],
  [{ country: "GR", city: "Thessaloniki", postcode: "546 24", line1: "Tsimiski 45" }, 0.15],
  [{ country: "GR", city: "Patras", postcode: "262 21", line1: "Maizonos 30" }, 0.08],
  [{ country: "GR", city: "Heraklion", postcode: "712 02", line1: "Dikaiosynis 12" }, 0.07],
  [{ country: "CY", city: "Nicosia", postcode: "1011", line1: "Ledras 120" }, 0.08],
  [{ country: "DE", city: "Berlin", postcode: "10115", line1: "Invalidenstraße 12" }, 0.08],
  [{ country: "FR", city: "Lyon", postcode: "69002", line1: "20 Rue de la République" }, 0.06],
  [{ country: "IT", city: "Milano", postcode: "20121", line1: "Via Brera 8" }, 0.06],
  [{ country: "NL", city: "Amsterdam", postcode: "1015 CJ", line1: "Prinsengracht 263" }, 0.05],
  [{ country: "GB", city: "London", postcode: "EC1M 5QA", line1: "12 Clerkenwell Road" }, 0.04],
  [{ country: "US", city: "New York", postcode: "10001", line1: "350 5th Avenue", region: "NY" }, 0.03],
];

const NAMES: Readonly<Record<string, readonly string[]>> = {
  GR: ["Eleni Papadopoulou", "Nikos Andreou", "Maria Georgiou", "Giorgos Konstantinou", "Katerina Nikolaou", "Dimitris Ioannou", "Sofia Christodoulou", "Kostas Vlachos", "Anna Pappa", "Yannis Alexiou"],
  CY: ["Andreas Charalambous", "Christina Kyriakou", "Marios Michael"],
  DE: ["Lena Hoffmann", "Jonas Weber"],
  FR: ["Camille Martin", "Hugo Bernard"],
  IT: ["Giulia Rossi", "Marco Bianchi"],
  NL: ["Sanne de Vries", "Daan Jansen"],
  GB: ["Olivia Hughes", "James Carter"],
  US: ["Emily Brooks", "Daniel Reyes"],
};

/** Review texts general enough for any piece, by language and stars. */
const REVIEWS: Readonly<Record<"en" | "el", Readonly<Record<1 | 2 | 3 | 4 | 5, readonly { title: string | null; body: string }[]>>>> = {
  en: {
    5: [
      { title: "Exactly as pictured", body: "Exactly as pictured and very well made. It has changed how the whole room feels." },
      { title: null, body: "Solid, beautifully finished and easy to set up. Very happy with it." },
      { title: "Better than expected", body: "Arrived well packed and on time. The quality is better than I expected for the price." },
    ],
    4: [
      { title: "Good value", body: "Good quality for the price. Delivery took a day longer than promised, otherwise perfect." },
      { title: null, body: "Looks lovely in the living room; the colour is a little warmer than in the photos." },
    ],
    3: [{ title: null, body: "Decent, but the finish has a few small marks. Fine for everyday use." }],
    2: [{ title: "Not quite the colour", body: "The colour is quite different from the photos and one edge was scratched." }],
    1: [{ title: "Arrived damaged", body: "Arrived with a broken corner. Support was helpful, but I expected better packing." }],
  },
  el: {
    5: [
      { title: "Όπως στις φωτογραφίες", body: "Ακριβώς όπως στις φωτογραφίες και πολύ καλή κατασκευή. Το προτείνω ανεπιφύλακτα." },
      { title: null, body: "Ήρθε καλά συσκευασμένο και στην ώρα του. Η ποιότητα είναι εξαιρετική." },
    ],
    4: [
      { title: "Καλή σχέση ποιότητας και τιμής", body: "Καλή ποιότητα για την τιμή. Η παράδοση άργησε μία μέρα, κατά τα άλλα τέλεια." },
      { title: null, body: "Ωραίο στο σαλόνι, το χρώμα είναι λίγο πιο ζεστό από τις φωτογραφίες." },
    ],
    3: [{ title: null, body: "Αξιοπρεπές, αλλά το φινίρισμα έχει μερικά μικρά σημάδια. Για καθημερινή χρήση είναι εντάξει." }],
    2: [{ title: null, body: "Το χρώμα διαφέρει αρκετά από τις φωτογραφίες και μια γωνία ήταν γρατζουνισμένη." }],
    1: [{ title: "Χτυπημένο", body: "Ήρθε με σπασμένη γωνία. Η εξυπηρέτηση βοήθησε, αλλά περίμενα καλύτερη συσκευασία." }],
  },
};

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    count: { type: "string", default: "40" },
    days: { type: "string", default: "30" },
    seed: { type: "string" },
    "dry-run": { type: "boolean", default: false },
  },
});

const pick = <T>(random: () => number, items: readonly T[]): T => items[Math.floor(random() * items.length)]!;
const emailOf = (name: string) =>
  `${name
    .normalize("NFD")
    .replace(/\p{M}/gu, "") // accents, split off by NFD
    .toLowerCase()
    .replace(/[^a-z]+/g, ".")}@demo.vitrine.test`;

/** Replays a plan on paper, for the dry run's summary. */
function finalStatus(plan: DemoPlan): OrderStatus {
  let order: OrderSnapshot = { status: "pending_payment", paid: false, deliveredAt: null };
  for (const step of plan.steps) {
    const result = transition(order, { type: step.event, actor: step.actor, at: step.at });
    if (!result.ok) throw new Error(`Planned ${step.event} refused from ${order.status}: ${result.reason}`);
    order = { status: result.to, paid: order.paid === true || result.to === "paid", deliveredAt: result.to === "delivered" ? step.at : order.deliveredAt };
  }
  return order.status;
}

async function demo(sql: postgres.Sql) {
  if (process.env.VITRINE_LOCAL !== "1") throw new Error("Demo orders are for the local stack only (run through `pnpm orders`).");
  const count = Number.parseInt(values.count, 10);
  const days = Number.parseInt(values.days, 10);
  if (!(count >= 1 && count <= 500) || !(days >= 1 && days <= 365)) throw new Error("--count must be 1 to 500 and --days 1 to 365.");
  const seed = values.seed === undefined ? randomInt(1, 1_000_000) : Number.parseInt(values.seed, 10);
  const secret = process.env.COOKIE_SECRET;
  if (secret === undefined || secret === "") throw new Error("COOKIE_SECRET is not set; run through `pnpm orders`.");

  const variants = await sql<{ variant_id: string; stock: number }[]>`
    SELECT v.id AS variant_id, v.stock FROM product_variants v JOIN products p ON p.id = v.product_id
    WHERE p.status = 'active' AND v.stock >= 4 ORDER BY v.sku
  `;
  if (variants.length === 0) throw new Error("No pieces with stock to order; seed the catalogue first (`pnpm catalog seed`).");
  const people = await sql<{ id: string; email: string }[]>`SELECT id, email FROM users WHERE email IN ('support@vitrine.test', 'customer@vitrine.test')`;
  const staffId = people.find((person) => person.email === "support@vitrine.test")?.id ?? null;
  const demoCustomer = people.find((person) => person.email === "customer@vitrine.test")?.id ?? null;

  // Plan everything first, from the seed alone, so a dry run shows exactly what would be written.
  const random = seededRandom(seed);
  const now = new Date();
  const orders = Array.from({ length: count }, () => {
    const place = pickWeighted(random, PLACES);
    const ownedByDemo = demoCustomer !== null && random() < 0.15;
    const customer: Customer = {
      name: ownedByDemo ? "Demo Customer" : pick(random, NAMES[place.country]!),
      locale: (place.country === "GR" || place.country === "CY") && random() < 0.7 ? "el" : "en",
    };
    const lines = pickWeighted(random, [[1, 0.65], [2, 0.25], [3, 0.1]] as const);
    const chosen = new Set<string>();
    while (chosen.size < lines) chosen.add(pick(random, variants).variant_id);
    const express = random() < 0.15;
    const placedAt = demoPlacedAt(random, now, days);
    const plan = planDemoOrder(random, placedAt, now);
    const text = plan.review === null ? null : pick(random, REVIEWS[customer.locale][plan.review.rating]);
    return { place, customer, ownedByDemo, variantIds: [...chosen], express, placedAt, plan, text };
  }).sort((a, b) => a.placedAt.getTime() - b.placedAt.getTime());

  const byStatus = new Map<OrderStatus, number>();
  for (const order of orders) byStatus.set(finalStatus(order.plan), (byStatus.get(finalStatus(order.plan)) ?? 0) + 1);
  console.log(`${count} demo orders over the last ${days} days (seed ${seed}):`);
  for (const [status, n] of [...byStatus].sort((a, b) => b[1] - a[1])) console.log(`  ${status.padEnd(18)} ${n}`);
  console.log(`  reviews            ${orders.filter((order) => order.plan.review !== null).length}`);
  console.log(`  demo customer's    ${orders.filter((order) => order.ownedByDemo).length}${demoCustomer === null ? " (no demo accounts: run `pnpm accounts demo` first to have some)" : ""}`);
  if (values["dry-run"]) return console.log("Dry run: nothing written.");

  const store = createCommerceStore(sql, { orderToken: (orderId) => orderLinkToken(orderId, secret) });
  const reviews = createReviewStore(sql);
  let placed = 0;
  let skipped = 0;
  for (const order of orders) {
    let cartId: string | null = null;
    for (const variantId of order.variantIds) {
      const change = await store.changeLine(cartId, variantId, 1, "add");
      if (change.ok) cartId = change.cartId;
    }
    if (cartId === null) {
      skipped += 1;
      continue;
    }
    const email = order.ownedByDemo ? "customer@vitrine.test" : emailOf(order.customer.name);
    const address: ShippingAddress = {
      name: order.customer.name,
      line1: order.place.line1,
      city: order.place.city,
      postcode: order.place.postcode,
      country: order.place.country,
      ...(order.place.region === undefined ? {} : { region: order.place.region }),
    };
    const result = await store.placeOrder({
      cartId,
      userId: order.ownedByDemo ? demoCustomer : null,
      locale: order.customer.locale,
      email,
      address,
      shipping: order.express ? "express" : "standard",
      idempotencyKey: uuidv7(),
      paymentProvider: "local_test",
      now: order.placedAt,
    });
    if (!result.ok) {
      // A piece sold out since planning: the order is left out, as a shopper would be told.
      await sql`DELETE FROM carts WHERE id = ${cartId}`;
      skipped += 1;
      continue;
    }
    // The cart was started a few minutes before the order, for the dashboard's funnel.
    await sql`UPDATE carts SET created_at = ${new Date(order.placedAt.getTime() - 5 * 60_000).toISOString()}::timestamptz WHERE id = ${cartId}`;
    for (const step of order.plan.steps) {
      const applied = await store.applyEvent(result.orderId, step.event, step.actor, {
        now: step.at,
        reason: step.reason ?? null,
        actorUserId: step.actor === "staff" ? staffId : step.actor === "customer" && order.ownedByDemo ? demoCustomer : null,
      });
      if (!applied.ok) throw new Error(`${result.number}: ${step.event} refused (${applied.reason})`);
    }
    if (order.plan.review !== null && order.text !== null) {
      const [line] = await sql<{ id: string }[]>`SELECT id FROM order_items WHERE order_id = ${result.orderId} ORDER BY id LIMIT 1`;
      const input = reviewInputSchema.parse({ rating: order.plan.review.rating, title: order.text.title ?? "", body: order.text.body });
      const saved = await reviews.saveReview({
        orderId: result.orderId,
        orderItemId: line!.id,
        input,
        userId: order.ownedByDemo ? demoCustomer : null,
        locale: order.customer.locale,
        now: order.plan.review.at,
      });
      if (!saved.ok) throw new Error(`${result.number}: review refused (${saved.reason})`);
    }
    placed += 1;
  }
  console.log(`\nPlaced ${placed}${skipped > 0 ? `, left out ${skipped} (a piece ran short)` : ""}. No emails were sent. Open /en/staff/orders as a staff account to see them.`);
}

const url = process.env.DATABASE_URL;
if (url === undefined || url === "") throw new Error("DATABASE_URL is not set; run through `pnpm orders`.");
const sql = postgres(url, { max: 2, onnotice: () => {} });
try {
  const [command] = positionals;
  if (command === "demo") await demo(sql);
  else {
    console.error("Usage: pnpm orders demo [--count 40] [--days 30] [--seed N] [--dry-run]");
    process.exitCode = 1;
  }
} finally {
  await sql.end();
}
