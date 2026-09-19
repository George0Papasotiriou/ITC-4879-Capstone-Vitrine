/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Checkout API: validates the form and places an idempotent guest order.
 */

import { checkoutSchema, fieldErrors } from "@/lib/commerce/checkout-input";
import { commerce, currentCartId, lastOrder, orderPath, PAYMENT_PROVIDER, rememberOrder } from "@/lib/commerce/server";

/**
 * Places an order from the guest's cart (Phase 5 step 3).
 *
 * The form sends contact, address, delivery method and an idempotency key
 * generated when the checkout page was rendered. Everything that costs money
 * is read from the database inside the order transaction. A repeated
 * submission with the same key returns the same order instead of a second one.
 */

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const parsed = checkoutSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: false, reason: "invalid", fields: fieldErrors(parsed.error) }, { status: 422 });
  const input = parsed.data;

  const cartId = await currentCartId();
  if (cartId === null) return Response.json({ ok: false, reason: "empty_cart" }, { status: 409 });

  const store = await commerce();
  const result = await store.placeOrder({
    cartId,
    locale: input.locale,
    email: input.email,
    address: { name: input.name, line1: input.line1, line2: input.line2, city: input.city, postcode: input.postcode, country: input.country, region: input.region, phone: input.phone },
    shipping: input.shipping,
    idempotencyKey: input.idempotencyKey,
    paymentProvider: PAYMENT_PROVIDER,
  });

  if (!result.ok) {
    const place = result.reason === "outside_vat_area" ? result.place : undefined;
    return Response.json({ ok: false, reason: result.reason, place }, { status: 409 });
  }
  if (result.accessToken !== null) {
    await rememberOrder(result.orderId, result.accessToken);
    return Response.json({ ok: true, url: `/${input.locale}${orderPath(result.orderId, result.accessToken)}` });
  }
  // A replay: the link token was only ever returned once, and lives in the order cookie.
  const previous = await lastOrder();
  if (previous !== null && previous.orderId === result.orderId) {
    return Response.json({ ok: true, url: `/${input.locale}${orderPath(previous.orderId, previous.token)}` });
  }
  return Response.json({ ok: false, reason: "replayed_elsewhere" }, { status: 409 });
}
