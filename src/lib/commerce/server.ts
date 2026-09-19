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
import { createCommerceStore, type CommerceStore, type OrderOwner } from "@/lib/commerce/store";
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

/** The only payment driver until Stripe is connected (Phase 5, needs George's account). */
export const PAYMENT_PROVIDER = "local_test";

let store: CommerceStore | undefined;

export async function commerce(): Promise<CommerceStore> {
  await connection();
  return (store ??= createCommerceStore(sql));
}

function secret(): string {
  const value = serverEnv().COOKIE_SECRET;
  if (value === undefined) {
    throw new Error("COOKIE_SECRET is not set. `pnpm local` generates one; in production it is required.");
  }
  return value;
}

const cookieOptions = () => ({
  httpOnly: true,
  sameSite: "lax" as const,
  secure: serverEnv().NODE_ENV === "production" && !serverEnv().VITRINE_LOCAL,
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
