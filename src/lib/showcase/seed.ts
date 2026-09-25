/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Writing the showcase: the accounts, and their history through the shop's own stores.
 */

import { hashPassword } from "better-auth/crypto";
import type postgres from "postgres";
import { uuidv7 } from "uuidv7";

import { recordAudit } from "@/lib/admin/audit";
import { createCatalogAdminStore } from "@/lib/admin/catalog-store";
import { demoPlacedAt, pickWeighted, planDemoOrder } from "@/lib/commerce/demo-orders";
import { createPriceWatchStore } from "@/lib/commerce/price-watch-store";
import { createReviewStore } from "@/lib/commerce/review-store";
import { reviewInputSchema } from "@/lib/commerce/reviews";
import { createCommerceStore } from "@/lib/commerce/store";
import { hashToken, newTicketNumber, orderLinkToken, ticketLinkToken } from "@/lib/commerce/tokens";
import type { ShippingAddress } from "@/lib/db/schema";
import { seededRandom } from "@/lib/reco/simulate";
import {
  accountOf,
  ORDER_STORIES,
  SHOWCASE_ACCOUNTS,
  SHOWCASE_DATA_VERSION,
  SHOWCASE_MARKER,
  SPAM_REVIEWS,
  storySteps,
  TICKET_STORIES,
  WATCH_STORIES,
  watchTarget,
  type ShowcaseKey,
} from "@/lib/showcase/plan";
import { createSupportStore } from "@/lib/support/store";

/**
 * docs/adr/028. Everything goes through the stores the shop itself uses —
 * the cart, the order state machine, the review rules, the desk — dated when
 * it happened, so stock, totals, VAT, histories and the dashboards are what
 * real use would leave. No email is sent: every address is under `.test`.
 *
 * Each part checks for itself whether it has already been written, so a deploy
 * that stopped halfway finishes the job the next time instead of writing it
 * twice; the marker only lets a finished showcase skip the checks.
 */

type Sql = postgres.Sql;
type Log = (line: string) => void;
type Person = { id: string; email: string; name: string };

const DAY = 24 * 60 * 60 * 1000;

/** Where showcase orders are delivered: Greece mostly, as the shop's prices are Greek. */
const ADDRESSES: readonly (readonly [Omit<ShippingAddress, "name">, number])[] = [
  [{ line1: "Ermou 10", city: "Athens", postcode: "105 63", country: "GR" }, 0.4],
  [{ line1: "Tsimiski 45", city: "Thessaloniki", postcode: "546 24", country: "GR" }, 0.2],
  [{ line1: "Maizonos 30", city: "Patras", postcode: "262 21", country: "GR" }, 0.1],
  [{ line1: "Ledras 120", city: "Nicosia", postcode: "1011", country: "CY" }, 0.1],
  [{ line1: "Invalidenstraße 12", city: "Berlin", postcode: "10115", country: "DE" }, 0.1],
  [{ line1: "Via Brera 8", city: "Milano", postcode: "20121", country: "IT" }, 0.1],
];

const GUEST_NAMES = ["Anna Pappa", "Kostas Vlachos", "Christina Kyriakou", "Yannis Alexiou", "Lena Hoffmann", "Giulia Rossi", "Marios Michael", "Katerina Nikolaou"];

const guestEmail = (name: string) => `${name.toLowerCase().replace(/[^a-z]+/g, ".")}@guests.vitrine.test`;

/** The accounts, created or brought up to date; returns them by key, and which were new. */
export async function ensureAccounts(sql: Sql, password: string, log: Log): Promise<Map<ShowcaseKey, Person>> {
  const hash = await hashPassword(password);
  const people = new Map<ShowcaseKey, Person>();
  for (const account of SHOWCASE_ACCOUNTS) {
    const [existing] = await sql<{ id: string }[]>`SELECT id FROM users WHERE email = ${account.email}`;
    const [user] = await sql<{ id: string }[]>`
      INSERT INTO users (id, name, email, email_verified, role)
      VALUES (${uuidv7()}, ${account.name}, ${account.email}, true, ${account.role})
      ON CONFLICT (email) DO UPDATE SET name = excluded.name, role = excluded.role, email_verified = true, updated_at = now()
      RETURNING id
    `;
    // Better Auth's own layout for a password: a "credential" account whose id is the user's.
    await sql`
      INSERT INTO accounts (id, account_id, provider_id, user_id, password)
      VALUES (${uuidv7()}, ${user!.id}, 'credential', ${user!.id}, ${hash})
      ON CONFLICT (provider_id, account_id) DO UPDATE SET password = excluded.password, updated_at = now()
    `;
    if (existing === undefined) {
      // Audited with no person as the actor: the deploy made it, not an account (docs/adr/018).
      await recordAudit(sql, {
        actor: null,
        action: "role.grant",
        entityType: "user",
        entityId: user!.id,
        changes: { role: { before: null, after: account.role } },
        reason: "Showcase account (SHOWCASE_PASSWORD)",
      });
    }
    people.set(account.key, { id: user!.id, email: account.email, name: account.name });
    log(`  ${account.email.padEnd(28)} ${account.role.padEnd(13)} ${existing === undefined ? "created" : "password and role brought up to date"}`);
  }
  return people;
}

/** Pieces the showcase may order: in stock with room to spare, in a fixed order so every deploy picks alike. */
async function orderablePieces(sql: Sql) {
  return sql<{ variant_id: string; product_id: string; price_cents: number }[]>`
    SELECT v.id AS variant_id, p.id AS product_id, COALESCE(v.price_cents, p.price_cents) AS price_cents
    FROM product_variants v JOIN products p ON p.id = v.product_id
    WHERE p.status = 'active' AND v.stock >= 8
    ORDER BY v.sku
  `;
}

type Placed = { orderId: string; number: string; deliveredAt: Date | null };

export type SeedOptions = { cookieSecret: string; now?: Date; log: Log };

/**
 * The history, written once. Returns what it wrote, part by part, so a deploy
 * log says exactly what the showcase holds.
 */
export async function ensureHistory(sql: Sql, people: Map<ShowcaseKey, Person>, { cookieSecret, now = new Date(), log }: SeedOptions): Promise<void> {
  const [marker] = await sql<{ value: unknown }[]>`SELECT value FROM app_settings WHERE key = ${SHOWCASE_MARKER}`;
  const seeded = typeof marker?.value === "string" ? (JSON.parse(marker.value) as { version?: number }) : (marker?.value as { version?: number } | undefined);
  if ((seeded?.version ?? 0) >= SHOWCASE_DATA_VERSION) {
    log("History: already written (showcase data version " + String(seeded?.version) + ").");
    return;
  }

  const pieces = await orderablePieces(sql);
  if (pieces.length < 12) {
    log("History: skipped — fewer than twelve pieces in stock; the catalogue sync runs first.");
    return;
  }
  const store = createCommerceStore(sql, { orderToken: (orderId) => orderLinkToken(orderId, cookieSecret) });
  const reviews = createReviewStore(sql);
  const random = seededRandom(20260926);
  const person = (key: ShowcaseKey) => people.get(key)!;
  const staffActor = (key: ShowcaseKey) => ({ userId: person(key).id, email: person(key).email });

  /** One order through the real cart and store, then its steps, each dated. */
  async function place({ variantIds, userId, email, name, locale, placedAt, steps, staffId }: {
    variantIds: string[];
    userId: string | null;
    email: string;
    name: string;
    locale: "en" | "el";
    placedAt: Date;
    steps: { event: Parameters<typeof store.applyEvent>[1]; actor: Parameters<typeof store.applyEvent>[2]; at: Date; reason?: string }[];
    staffId: string | null;
  }): Promise<Placed | null> {
    let cartId: string | null = null;
    for (const variantId of variantIds) {
      const change = await store.changeLine(cartId, variantId, 1, "add");
      if (change.ok) cartId = change.cartId;
    }
    if (cartId === null) return null;
    const address = { ...pickWeighted(random, ADDRESSES), name } satisfies ShippingAddress;
    const result = await store.placeOrder({ cartId, userId, locale, email, address, shipping: "standard", idempotencyKey: uuidv7(), paymentProvider: "local_test", now: placedAt });
    if (!result.ok) {
      await sql`DELETE FROM carts WHERE id = ${cartId}`;
      return null;
    }
    await sql`UPDATE carts SET created_at = ${new Date(placedAt.getTime() - 5 * 60_000).toISOString()}::timestamptz WHERE id = ${cartId}`;
    let deliveredAt: Date | null = null;
    for (const step of steps) {
      const applied = await store.applyEvent(result.orderId, step.event, step.actor, {
        now: step.at,
        reason: step.reason ?? null,
        actorUserId: step.actor === "staff" ? staffId : step.actor === "customer" ? userId : null,
      });
      if (!applied.ok) throw new Error(`${result.number}: ${step.event} refused (${applied.reason})`);
      if (step.event === "deliver") deliveredAt = step.at;
    }
    return { orderId: result.orderId, number: result.number, deliveredAt };
  }

  async function reviewFirstLine(orderId: string, userId: string | null, locale: "en" | "el", at: Date, review: { rating: number; title: string | null; body: string }) {
    const [line] = await sql<{ id: string }[]>`SELECT id FROM order_items WHERE order_id = ${orderId} ORDER BY id LIMIT 1`;
    const input = reviewInputSchema.parse({ rating: review.rating, title: review.title ?? "", body: review.body });
    const saved = await reviews.saveReview({ orderId, orderItemId: line!.id, input, userId, locale, now: at });
    if (!saved.ok) throw new Error(`review refused (${saved.reason})`);
    const [row] = await sql<{ id: string }[]>`SELECT id FROM reviews WHERE order_item_id = ${line!.id}`;
    return row!.id;
  }

  // 1. The shop's recent weeks, from guests: what the dashboards are made of.
  const [guests] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM orders WHERE email LIKE '%@guests.vitrine.test'`;
  const delivered: Placed[] = [];
  if ((guests?.n ?? 0) === 0) {
    let count = 0;
    for (let index = 0; index < 28; index += 1) {
      const name = GUEST_NAMES[index % GUEST_NAMES.length]!;
      const placedAt = demoPlacedAt(random, now, 30);
      const plan = planDemoOrder(random, placedAt, now);
      const lines = random() < 0.3 ? 2 : 1;
      const variantIds = [...new Set(Array.from({ length: lines }, () => pieces[Math.floor(random() * pieces.length)]!.variant_id))];
      const placed = await place({
        variantIds,
        userId: null,
        email: guestEmail(name),
        name,
        locale: random() < 0.6 ? "el" : "en",
        placedAt,
        steps: plan.steps,
        staffId: person(index % 2 === 0 ? "support1" : "support2").id,
      });
      if (placed === null) continue;
      count += 1;
      if (placed.deliveredAt !== null && plan.review === null) delivered.push(placed);
      if (plan.review !== null) await reviewFirstLine(placed.orderId, null, "en", plan.review.at, { rating: plan.review.rating, title: null, body: "Arrived well packed and looks just like the photographs. Happy with it." });
    }
    log(`History: ${count} guest orders over the last 30 days, for the dashboards.`);

    // Two reviews nobody should read, taken down by the admins with a reason.
    for (const [index, spam] of SPAM_REVIEWS.entries()) {
      const order = delivered[index];
      if (order === undefined) break;
      const reviewId = await reviewFirstLine(order.orderId, null, "en", new Date(order.deliveredAt!.getTime() + DAY), { rating: 5, title: spam.title, body: spam.body });
      await reviews.moderate(reviewId, { status: "hidden", reason: spam.reason, actor: staffActor(spam.by) });
    }
    log(`History: ${Math.min(SPAM_REVIEWS.length, delivered.length)} spam reviews hidden by the admins, with their reasons.`);
  } else {
    log("History: guest orders already there.");
  }

  // 2. Each showcase account's own orders, every stage worth showing.
  // An account that already has orders had its stories written on an earlier
  // deploy (or placed its own since): it is left as it is.
  const storyOrders = new Map<string, Placed>();
  const alreadyShopped = new Set<ShowcaseKey>();
  for (const key of new Set(ORDER_STORIES.map((story) => story.owner))) {
    const [has] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM orders WHERE user_id = ${person(key).id}`;
    if ((has?.n ?? 0) > 0) alreadyShopped.add(key);
  }
  for (const story of ORDER_STORIES) {
    if (alreadyShopped.has(story.owner)) continue;
    const owner = person(story.owner);
    const { placedAt, steps, reviewAt } = storySteps(story, now);
    const chosen = Array.from({ length: story.lines }, (_, line) => pieces[(ORDER_STORIES.indexOf(story) * 3 + line * 7) % pieces.length]!.variant_id);
    const account = accountOf(story.owner);
    const placed = await place({ variantIds: [...new Set(chosen)], userId: owner.id, email: owner.email, name: owner.name, locale: account.locale, placedAt, steps, staffId: person(story.staff).id });
    if (placed === null) continue;
    storyOrders.set(story.key, placed);
    if (reviewAt !== null && story.review !== undefined) await reviewFirstLine(placed.orderId, owner.id, account.locale, reviewAt, story.review);
  }
  log(`History: ${storyOrders.size} orders for the showcase accounts, from paid to refunded${alreadyShopped.size > 0 ? ` (${alreadyShopped.size} accounts already had theirs)` : ""}.`);

  // 3. Price watches: each customer waiting for a price.
  const watches = createPriceWatchStore(sql);
  const watchedProducts = await sql<{ id: string; price_cents: number }[]>`
    SELECT id, price_cents FROM products WHERE status = 'active' AND price_cents >= 5000 ORDER BY source_id LIMIT 12
  `;
  let watched = 0;
  for (const watch of WATCH_STORIES) {
    const product = watchedProducts[watch.productIndex % Math.max(1, watchedProducts.length)];
    if (product === undefined) continue;
    const result = await watches.set({ userId: person(watch.owner).id, productId: product.id, targetCents: watchTarget(product.price_cents, watch.discount), locale: accountOf(watch.owner).locale });
    if (result.ok) watched += 1;
  }
  log(`History: ${watched} price watches.`);

  // 4. A cart with something in it, for each customer, so the cart page is not empty.
  let carts = 0;
  for (const key of ["customer1", "customer2"] as const) {
    // One cart per account: if it has one already, it is theirs to keep as it is.
    const [open] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM carts WHERE user_id = ${person(key).id}`;
    if ((open?.n ?? 0) > 0) continue;
    let cartId: string | null = null;
    for (const offset of key === "customer1" ? [11, 17] : [13]) {
      const change = await store.changeLine(cartId, pieces[offset % pieces.length]!.variant_id, 1, "add", person(key).id);
      if (change.ok) cartId = change.cartId;
    }
    if (cartId !== null) carts += 1;
  }
  log(carts === 0 ? "History: the customers' carts already there." : `History: a cart in progress for ${carts} ${carts === 1 ? "customer" : "customers"}.`);

  // 5. The support desk: a conversation in every state its pages show.
  const desk = createSupportStore(sql);
  const [tickets] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM support_tickets WHERE email LIKE '%vitrine.test'`;
  if ((tickets?.n ?? 0) === 0) {
    for (const story of TICKET_STORIES) {
      const openedAt = new Date(now.getTime() - story.hoursAgo * 60 * 60 * 1000);
      const from = "account" in story.from ? { ...person(story.from.account), locale: accountOf(story.from.account).locale, userId: person(story.from.account).id } : { ...story.from.guest, userId: null };
      const id = uuidv7();
      const orderId = story.order === undefined ? null : (storyOrders.get(story.order)?.orderId ?? null);
      const ticket = await desk.open(
        {
          id,
          number: newTicketNumber(),
          subject: story.subject,
          body: story.body,
          topic: story.topic,
          locale: from.locale,
          email: from.email,
          name: from.name,
          userId: from.userId,
          orderId,
          accessTokenHash: hashToken(ticketLinkToken(id, cookieSecret)),
        },
        openedAt,
      );
      if (story.concierge !== undefined) {
        await desk.addMessage(ticket.id, { author: "ai", body: `Handed over from the Concierge. The conversation so far:\n\n${story.concierge}`, internal: true }, openedAt);
      }
      if (story.assignee !== undefined) await desk.assign(ticket.id, person(story.assignee).id, openedAt);
      if (story.note !== undefined) await desk.addMessage(ticket.id, { author: "agent", authorUserId: person(story.note.by).id, body: story.note.body, internal: true }, new Date(openedAt.getTime() + 30 * 60_000));
      if (story.reply !== undefined) {
        await desk.addMessage(ticket.id, { author: "agent", authorUserId: person(story.reply.by).id, body: story.reply.body }, new Date(openedAt.getTime() + story.reply.hoursAfter * 60 * 60 * 1000));
      }
      if (story.close !== undefined) {
        const closedAt = new Date(openedAt.getTime() + 26 * 60 * 60 * 1000);
        await desk.move(ticket.id, "resolve", closedAt);
        await desk.move(ticket.id, "close", closedAt);
        await desk.saveSatisfaction(ticket.id, story.close.score, story.close.comment, new Date(closedAt.getTime() + 60 * 60 * 1000));
      }
    }
    log(`History: ${TICKET_STORIES.length} conversations with the desk (answered, closed with a score, handed over by the Concierge, waiting).`);
  } else {
    log("History: desk conversations already there.");
  }

  // 6. The merchandisers' work: a delivery counted in, and a piece put on offer.
  const catalogue = createCatalogAdminStore(sql);
  const [edited] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM audit_log WHERE actor_user_id IN (${person("merchandiser1").id}, ${person("merchandiser2").id})`;
  if ((edited?.n ?? 0) === 0) {
    for (const offset of [2, 19]) {
      const piece = pieces[offset % pieces.length]!;
      const [current] = await sql<{ stock: number }[]>`SELECT stock FROM product_variants WHERE id = ${piece.variant_id}`;
      await catalogue.setStock(piece.product_id, piece.variant_id, (current?.stock ?? 0) + 6, "Delivery from the workshop, counted in", staffActor("merchandiser1"), new Date(now.getTime() - 2 * DAY));
    }
    const offer = pieces[23 % pieces.length]!;
    const product = await catalogue.readProduct(offer.product_id);
    if (product !== null && product.status === "active" && product.compareAtCents === null) {
      // The same fields the staff page saves, with 15% off and the old price shown as the "was".
      await catalogue.updateProduct(
        offer.product_id,
        {
          titleEn: product.titleEn,
          titleEl: product.titleEl,
          descriptionEn: product.descriptionEn,
          descriptionEl: product.descriptionEl,
          highlightsEn: product.highlightsEn,
          highlightsEl: product.highlightsEl,
          status: "active",
          priceCents: Math.round((product.priceCents * 0.85) / 100) * 100 - 1,
          compareAtCents: product.priceCents,
        },
        staffActor("merchandiser2"),
        new Date(now.getTime() - DAY),
      );
    }
    log("History: stock counted in by one merchandiser, a piece put on offer by the other.");
  } else {
    log("History: merchandisers' edits already there.");
  }

  await sql`
    INSERT INTO app_settings (key, value, description, updated_at)
    VALUES (${SHOWCASE_MARKER}, ${JSON.stringify({ version: SHOWCASE_DATA_VERSION, seededAt: now.toISOString() })}::text::jsonb, 'The showcase history was written (docs/adr/028).', now())
    ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = now()
  `;
  log("History: written.");
}

/**
 * Closes the showcase: the accounts can no longer sign in and their sessions
 * end. Their history stays, because it is the shop's history too — orders,
 * reviews and conversations other pages count.
 */
export async function lockShowcase(sql: Sql, log: Log): Promise<void> {
  const emails = SHOWCASE_ACCOUNTS.map((account) => account.email);
  const users = await sql<{ id: string; email: string }[]>`SELECT id, email FROM users WHERE email = ANY(${emails}::text[])`;
  const ids = users.map((user) => user.id);
  if (ids.length === 0) return log("No showcase accounts to lock.");
  const passwords = await sql`DELETE FROM accounts WHERE provider_id = 'credential' AND user_id = ANY(${ids}::uuid[]) RETURNING id`;
  const sessions = await sql`DELETE FROM sessions WHERE user_id = ANY(${ids}::uuid[]) RETURNING id`;
  log(`Locked ${users.length} showcase accounts: ${passwords.length} passwords removed, ${sessions.length} sessions ended.`);
}
