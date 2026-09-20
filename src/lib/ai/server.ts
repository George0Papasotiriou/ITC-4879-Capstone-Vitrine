/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Server wiring for the AI layer: the mode, the cost guard, the shopper's AI identity and the services tools run against.
 */

import { randomUUID } from "node:crypto";

import { cookies } from "next/headers";
import { connection } from "next/server";
import { uuidv7 } from "uuidv7";

import { createUndoToken } from "@/lib/ai/tools/undo";
import type { ToolServices, ToolUser } from "@/lib/ai/tools/types";
import { createUsageStore, type Actor, type UsageStore } from "@/lib/ai/usage";
import type { CurrentUser } from "@/lib/auth/session";
import { getCardsByIds, getProduct, runSearch } from "@/lib/catalog/server";
import { currentRegion } from "@/lib/commerce/region";
import { accessibleOrder, commerce, currentCart, lastOrder, notifyOrder, orderOwner, priceWatches, rememberCart, reviewsStore } from "@/lib/commerce/server";
import { signValue, verifySignedValue } from "@/lib/commerce/tokens";
import { sql } from "@/lib/db/client";
import { pairsWith, recommendationsForCurrentShopper } from "@/lib/reco/server";
import { buildBundles } from "@/lib/stylist/server";
import { serverEnv } from "@/env";

/**
 * Everything here reads the request (cookies, the signed-in person, the
 * shopper's country), so it runs only in route handlers and server components.
 * The tools themselves never see a request: they get these services.
 */

/** A random id per browser, only for counting a guest's daily allowance; not linked to anything else. */
export const AI_GUEST_COOKIE = "vt_ai";

function secret(): string {
  const value = serverEnv().COOKIE_SECRET;
  if (value === undefined) throw new Error("COOKIE_SECRET is not set. `pnpm local` generates one; in production it is required.");
  return value;
}

export function aiMode() {
  return serverEnv().aiMode;
}

let usage: UsageStore | undefined;

export async function usageStore(): Promise<UsageStore> {
  await connection();
  const env = serverEnv();
  return (usage ??= createUsageStore(sql, { mode: env.aiMode, killSwitch: env.AI_KILL_SWITCH, dailyBudgetEur: env.AI_DAILY_BUDGET_EUR }));
}

/** The key tool approvals are signed with: derived from the cookie secret, never the secret itself. */
export function approvalSecret(): string {
  return signValue("tool-approval", secret()).split(".")[1]!;
}

/**
 * Who is asking, for allowances: the account when signed in, else the guest
 * cookie, created on first use. Call only where cookies may be written.
 */
export async function aiActor(user: CurrentUser | null): Promise<Actor> {
  if (user !== null) return { key: `user:${user.id}`, kind: "customer" };
  const jar = await cookies();
  const existing = verifySignedValue(jar.get(AI_GUEST_COOKIE)?.value, secret());
  const id = existing ?? randomUUID();
  if (existing === null) {
    jar.set(AI_GUEST_COOKIE, signValue(id, secret()), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 30 });
  }
  return { key: `guest:${id}`, kind: "guest" };
}

export function toolUser(user: CurrentUser | null): ToolUser | null {
  return user === null ? null : { id: user.id, email: user.email, emailVerified: user.emailVerified, roles: user.roles };
}

/**
 * The cart the Concierge will change, decided before the answer starts.
 * A chat answer is a stream: once the first byte is sent, no cookie can be
 * added, so a guest's cart id is minted and remembered here, and the cart row
 * is created under that id when something is first added (docs/adr/019).
 * Call it only where cookies may be written.
 */
export async function conciergeCart(): Promise<{ cartId: string | null; userId: string | null }> {
  const current = await currentCart();
  if (current.cartId !== null || current.userId !== null) return current;
  const cartId = uuidv7();
  await rememberCart(cartId);
  return { cartId, userId: null };
}

/** The services the tools run against, for this shopper and this request. */
export async function toolServices({ locale, user, cart: held }: { locale: "en" | "el"; user: CurrentUser | null; cart?: { cartId: string | null; userId: string | null } }): Promise<ToolServices> {
  const store = await commerce();
  const reviews = await reviewsStore();
  const { country } = await currentRegion();
  const cart = async () => held ?? (await currentCart());

  const myOrders = async () => {
    if (user !== null) return store.ordersForOwner(orderOwner(user), 20);
    // A guest has the order this browser placed last, if any.
    const last = await lastOrder();
    if (last === null) return [];
    const access = await accessibleOrder(last.orderId, last.token);
    if (access === null) return [];
    const order = access.order;
    return [{ id: order.id, number: order.number, status: order.status, total: order.total, createdAt: order.createdAt, itemCount: order.items.reduce((sum, item) => sum + item.quantity, 0), imageSrc: order.items[0]?.imageSrc ?? null }];
  };

  return {
    search: async (query, { category, limit }) => {
      const result = await runSearch(query, { limit, filters: category === undefined ? undefined : { categories: [category as never] } });
      return { ids: result.ids, corrected: result.corrections.length > 0, relaxed: result.relaxed.length > 0 };
    },
    cards: (ids) => getCardsByIds(ids, locale),
    details: async (ids) => {
      const cards = await getCardsByIds(ids, locale);
      const details = await Promise.all(cards.map((card) => getProduct(card.slug, locale)));
      return details.filter((detail) => detail !== null);
    },
    recommend: async ({ productId, limit }) => {
      if (productId !== null) return (await pairsWith(productId, limit)).ids;
      const mine = await recommendationsForCurrentShopper(limit);
      return mine.items.map((item) => item.productId);
    },
    bundles: (request) => buildBundles(request),
    reviews: (productId) => reviews.productReviews(productId, { limit: 4 }),
    productIdBySlug: async (slug) => (await getProduct(slug, locale))?.id ?? null,
    cart: {
      view: async () => store.viewCart((await cart()).cartId, locale, { country }),
      change: async (variantId, quantity, mode) => {
        const { cartId, userId } = await cart();
        // The id was minted by this request and signed into the cookie, so the cart is created under it.
        return store.changeLine(cartId, variantId, quantity, mode, userId, { adoptCartId: true });
      },
      defaultVariant: (productId) => store.defaultVariant(productId),
      undoToken: (payload) => createUndoToken(payload, secret()),
    },
    watch: {
      get: async (productId) => {
        if (user === null) return null;
        const watch = await (await priceWatches()).forProduct({ userId: user.id, productId });
        return watch === null ? null : { targetCents: watch.targetCents };
      },
      set: async (productId, targetCents) => {
        if (user === null) return { ok: false, reason: "not_found" };
        return (await priceWatches()).set({ userId: user.id, productId, targetCents, locale });
      },
      remove: async (productId) => (user === null ? false : (await priceWatches()).remove({ userId: user.id, productId })),
    },
    orders: {
      mine: myOrders,
      byNumber: async (number) => {
        const match = (await myOrders()).find((order) => order.number === number);
        return match === undefined ? null : store.readOrder(match.id);
      },
      requestReturn: async (orderId, reason) => {
        const result = await store.applyEvent(orderId, "request_return", "customer", { reason, actorUserId: user?.id ?? null });
        if (!result.ok) return { ok: false, reason: result.reason };
        await notifyOrder(orderId, result.effects);
        return { ok: true };
      },
    },
  };
}
