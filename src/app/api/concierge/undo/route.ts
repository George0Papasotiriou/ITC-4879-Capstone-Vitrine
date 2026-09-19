/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Undo for a cart change the Concierge made: redeems the signed token its tool returned.
 */

import { z } from "zod";

import { readUndoToken } from "@/lib/ai/tools/undo";
import { commerce, currentCart } from "@/lib/commerce/server";
import { serverEnv } from "@/env";

/**
 * The token names the cart, the variant and the quantity before the change
 * (src/lib/ai/tools/undo.ts). It is honoured only for the cart this browser
 * holds now, so a token copied to another browser does nothing there.
 */

export const runtime = "nodejs";

const bodySchema = z.object({ token: z.string().min(10).max(600) });

export async function POST(request: Request): Promise<Response> {
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ ok: false, reason: "invalid_request" }, { status: 400 });
  const secret = serverEnv().COOKIE_SECRET;
  const payload = secret === undefined ? null : readUndoToken(body.data.token, secret);
  if (payload === null) return Response.json({ ok: false, reason: "expired" }, { status: 410 });

  const { cartId, userId } = await currentCart();
  if (cartId !== payload.cartId) return Response.json({ ok: false, reason: "other_cart" }, { status: 403 });
  const store = await commerce();
  const result = await store.changeLine(cartId, payload.variantId, payload.quantity, "set", userId);
  if (!result.ok) return Response.json({ ok: false, reason: result.reason }, { status: 409 });
  return Response.json({ ok: true, quantity: result.quantity, itemCount: await store.itemCount(cartId) });
}
