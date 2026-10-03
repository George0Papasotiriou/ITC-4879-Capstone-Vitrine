/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * "Add the board to my cart": every piece on a room board, in its quantity, into the visitor's own cart.
 */

import { z } from "zod";

import { currentUser } from "@/lib/auth/session";
import { boardAccess, boardStore } from "@/lib/boards/server";
import { commerce, currentCart, rememberCart } from "@/lib/commerce/server";
import { clientAddress } from "@/lib/geo/ip-country";
import { sharedRateLimiter } from "@/lib/kv/rate-limit";

/**
 * docs/adr/056. Anyone who can see the board may put its pieces in their own
 * cart — the board is never anyone's cart. Each piece goes through the cart's
 * own rules (stock limits, the default variant), so a piece out of stock is
 * reported, not forced in; prices are the cart's, read again from the database.
 */

export const runtime = "nodejs";

export type BoardCartResponse = { ok: true; added: number; refused: number } | { ok: false; reason: "not_found" | "slow_down" };

const perAddress = sharedRateLimiter({ name: "boards", limit: 20, windowMs: 60_000 });

export async function POST(request: Request, { params }: RouteContext<"/api/boards/[id]/cart">): Promise<Response> {
  if (!(await perAddress(clientAddress(request.headers) ?? "unknown"))) return Response.json({ ok: false, reason: "slow_down" } satisfies BoardCartResponse, { status: 429 });
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return Response.json({ ok: false, reason: "not_found" } satisfies BoardCartResponse, { status: 404 });
  const found = await boardAccess(id, new URL(request.url).searchParams.get("k"), await currentUser());
  if (found === null) return Response.json({ ok: false, reason: "not_found" } satisfies BoardCartResponse, { status: 404 });

  const items = await (await boardStore()).items(found.board.id);
  const store = await commerce();
  const cart = await currentCart();
  let cartId = cart.cartId;
  let added = 0;
  let refused = 0;
  for (const item of items) {
    const variantId = await store.defaultVariant(item.productId);
    if (variantId === null) {
      refused += 1;
      continue;
    }
    const change = await store.changeLine(cartId, variantId, item.quantity, "add", cart.userId);
    if (!change.ok) {
      refused += 1;
      continue;
    }
    added += 1;
    cartId = change.cartId;
  }
  // A guest's new cart is remembered by cookie; an account's is found by its owner.
  if (cartId !== null && cartId !== cart.cartId && cart.userId === null) await rememberCart(cartId);
  return Response.json({ ok: true, added, refused } satisfies BoardCartResponse);
}
