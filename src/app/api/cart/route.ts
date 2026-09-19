/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Cart API: returns the cart summary and changes cart lines.
 */

import { z } from "zod";

import { routing } from "@/i18n/routing";
import { commerce, currentCart, currentCartId, rememberCart } from "@/lib/commerce/server";
import type { CartView } from "@/lib/commerce/store";
import { MAX_QUANTITY_PER_LINE } from "@/lib/commerce/pricing";
import { currentRegion } from "@/lib/commerce/region";
import { currentActor, tasteGraph } from "@/lib/reco/server";

/**
 * The guest cart (Phase 5).
 *
 * GET returns a compact summary for the header count and the mini cart. POST
 * changes one line. Prices and totals in the response are read from the
 * database for this request; the browser only ever sends ids and quantities.
 */

export const runtime = "nodejs";

const locale = z.enum(routing.locales).catch(routing.defaultLocale);

const changeSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("add"),
    productId: z.uuid().optional(),
    variantId: z.uuid().optional(),
    quantity: z.number().int().min(1).max(MAX_QUANTITY_PER_LINE).default(1),
    locale,
    sessionId: z.string().regex(/^[A-Za-z0-9-]{8,64}$/).optional(),
  }),
  z.object({ action: z.literal("set"), variantId: z.uuid(), quantity: z.number().int().min(0).max(MAX_QUANTITY_PER_LINE), locale }),
]);

function summary(view: CartView) {
  return {
    itemCount: view.lines.reduce((sum, line) => sum + line.quantity, 0),
    currency: view.totals.total.currency,
    country: view.totals.country,
    vatRatePerMille: view.totals.vatRatePerMille,
    lines: view.lines.map((line) => ({
      variantId: line.variantId,
      slug: line.slug,
      title: line.title,
      image: line.image,
      quantity: line.quantity,
      unitCents: line.unitPrice.cents,
      available: line.available,
      stock: line.stock,
    })),
    subtotalCents: view.totals.subtotal.cents,
    shippingCents: view.totals.shipping.cents,
    totalCents: view.totals.total.cents,
    freeShippingRemainingCents: view.totals.freeShippingRemaining?.cents ?? null,
  };
}

export type CartSummary = ReturnType<typeof summary>;

export async function GET(request: Request): Promise<Response> {
  const store = await commerce();
  const lang = locale.parse(new URL(request.url).searchParams.get("locale"));
  const view = await store.viewCart(await currentCartId(), lang, { country: (await currentRegion()).country });
  return Response.json(summary(view), { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request): Promise<Response> {
  const parsed = changeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: false, reason: "invalid_request" }, { status: 400 });
  const input = parsed.data;
  const store = await commerce();
  const { cartId, userId } = await currentCart();

  let variantId = input.variantId ?? null;
  if (input.action === "add" && variantId === null && input.productId !== undefined) {
    variantId = await store.defaultVariant(input.productId);
  }
  if (variantId === null) return Response.json({ ok: false, reason: "not_found" }, { status: 404 });

  const change = await store.changeLine(cartId, variantId, input.quantity, input.action, userId);
  if (!change.ok) {
    const status = change.reason === "not_found" ? 404 : 409;
    return Response.json({ ok: false, reason: change.reason }, { status });
  }
  // A guest's new cart is remembered by cookie; an account's is found by its owner.
  if (change.cartId !== cartId && userId === null) await rememberCart(change.cartId);

  // A cart addition is a strong taste signal, recorded only for shoppers who opted in.
  if (input.action === "add" && input.sessionId !== undefined) {
    const actor = await currentActor();
    const productId = input.productId;
    if (actor !== null && productId !== undefined) {
      await tasteGraph().record({ actorId: actor, sessionId: input.sessionId, productId, kind: "cart" }).catch(() => false);
    }
  }

  const view = await store.viewCart(change.cartId, input.locale, { country: (await currentRegion()).country });
  return Response.json({ ok: true, quantity: change.quantity, limitedTo: change.limitedTo, cart: summary(view) });
}
