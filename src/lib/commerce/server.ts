/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Commerce store access and signed cart and order cookies for the server.
 */

import { cookies } from "next/headers";
import { connection } from "next/server";

import { currentUser, type CurrentUser } from "@/lib/auth/session";
import { commerceStore, cookieSecret, notifyOrder } from "@/lib/commerce/services";
import { createPriceWatchStore, type PriceWatchStore } from "@/lib/commerce/price-watch-store";
import { createReviewStore, type ReviewStore } from "@/lib/commerce/review-store";
import type { CommerceStore, OrderOwner, OrderView } from "@/lib/commerce/store";
import { signValue, verifySignedValue } from "@/lib/commerce/tokens";
import { sql } from "@/lib/db/client";
import { serverEnv } from "@/env";

/**
 * Commerce for pages and route handlers: the store, and the two signed cookies
 * a guest holds.
 *
 * - `vt_cart`: the cart id. HttpOnly, so scripts on the page cannot read it.
 * - `vt_order`: the last order's id and link token, so a repeated checkout
 *   submission can return to the order it already placed, and the cart page can
 *   offer "View your order".
 */

export const CART_COOKIE = "vt_cart";
export const ORDER_COOKIE = "vt_order";
const SIXTY_DAYS = 60 * 24 * 60 * 60;

/** The local test payment: what pays for orders while Stripe's keys are not set (docs/adr/038). */
export const LOCAL_TEST_PROVIDER = "local_test";

export async function commerce(): Promise<CommerceStore> {
  await connection();
  return commerceStore();
}

export { notifyOrder };

const secret = cookieSecret;

const cookieOptions = () => ({
  httpOnly: true,
  sameSite: "lax" as const,
  secure: serverEnv().secureCookies,
  path: "/",
  maxAge: SIXTY_DAYS,
});

/**
 * The shopper's cart and who owns it. Signed in, it is the account's cart,
 * which takes in whatever the browser collected as a guest (store.claimCart).
 * Signed out, it is the cookie's cart, but only while that is still a guest
 * cart. Nothing here writes a cookie, so pages can call it while rendering.
 */
export async function currentCart(): Promise<{ cartId: string | null; userId: string | null }> {
  const jar = await cookies();
  const cookieCart = verifySignedValue(jar.get(CART_COOKIE)?.value, secret());
  const store = await commerce();
  const user = await currentUser();
  if (user === null) return { cartId: await store.guestCart(cookieCart), userId: null };
  return { cartId: await store.claimCart(user.id, cookieCart), userId: user.id };
}

let reviewStore: ReviewStore | undefined;

export async function reviewsStore(): Promise<ReviewStore> {
  await connection();
  return (reviewStore ??= createReviewStore(sql));
}

let watchStore: PriceWatchStore | undefined;

export async function priceWatches(): Promise<PriceWatchStore> {
  await connection();
  return (watchStore ??= createPriceWatchStore(sql));
}

/**
 * The order a request may see: through the guest link's token when it brings
 * one, otherwise as the signed-in account it belongs to. Null for anything
 * else, whatever the reason, so guessing ids or tokens teaches nothing.
 */
export async function accessibleOrder(orderId: string, token: string | null | undefined): Promise<{ order: OrderView; user: CurrentUser | null } | null> {
  const store = await commerce();
  if (token !== null && token !== undefined) {
    const order = await store.orderForToken(orderId, token);
    return order === null ? null : { order, user: await currentUser() };
  }
  const user = await currentUser();
  if (user === null) return null;
  const order = await store.orderForOwner(orderId, orderOwner(user));
  return order === null ? null : { order, user };
}

/** The account asking about orders; its address counts only once confirmed (store.orderForOwner). */
export function orderOwner(user: CurrentUser): OrderOwner {
  return { userId: user.id, verifiedEmail: user.emailVerified ? user.email.toLowerCase() : null };
}

export async function currentCartId(): Promise<string | null> {
  return (await currentCart()).cartId;
}

export async function rememberCart(cartId: string): Promise<void> {
  const jar = await cookies();
  jar.set(CART_COOKIE, signValue(cartId, secret()), cookieOptions());
}

export async function rememberOrder(orderId: string, token: string): Promise<void> {
  const jar = await cookies();
  jar.set(ORDER_COOKIE, signValue(`${orderId}~${token}`, secret()), cookieOptions());
}

export async function lastOrder(): Promise<{ orderId: string; token: string } | null> {
  const jar = await cookies();
  const value = verifySignedValue(jar.get(ORDER_COOKIE)?.value, secret());
  if (value === null) return null;
  const [orderId, token] = value.split("~");
  return orderId === undefined || token === undefined ? null : { orderId, token };
}

/**
 * The order page, without a locale prefix: locale-aware links (SmartLink,
 * ButtonLink) add it themselves. Prefix it only for a plain URL, as the
 * checkout API does for `window.location`.
 */
export function orderPath(orderId: string, token: string): string {
  return `/orders/${orderId}?t=${encodeURIComponent(token)}`;
}
