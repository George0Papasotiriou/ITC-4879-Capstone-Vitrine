/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Cart tools: add, change and remove, run at once through the same cart as the shop, each with a token to undo it.
 */

import { z } from "zod";

import type { ToolContext, VitrineTool } from "@/lib/ai/tools/types";

/**
 * The Concierge changes the cart the shopper already has, through the same
 * store as the Add to cart button, so stock limits and prices are the shop's.
 * Checkout is never started from here: that is `start_checkout`, which asks
 * first and only opens the page where the shopper pays (golden rule 5).
 */

const define = <I, O>(tool: VitrineTool<I, O>) => tool;

const cartResult = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    productId: z.string(),
    title: z.string(),
    quantity: z.number().int(),
    /** Set when the shop could not give as many as asked (stock or the per-line maximum). */
    limitedTo: z.number().int().nullable(),
    itemsInCart: z.number().int(),
    /** Redeemed by the Undo in the Concierge's timeline. */
    undo: z.string(),
  }),
  z.object({ ok: z.literal(false), reason: z.enum(["not_found", "out_of_stock", "cart_full", "not_in_cart"]) }),
]);
type CartResult = z.infer<typeof cartResult>;

async function change(ctx: ToolContext, productId: string, quantity: number, mode: "add" | "set"): Promise<CartResult> {
  const before = await ctx.services.cart.view();
  const existing = before.lines.find((line) => line.productId === productId);
  const variantId = existing?.variantId ?? (mode === "add" ? await ctx.services.cart.defaultVariant(productId) : null);
  if (variantId === null) return { ok: false, reason: mode === "add" ? "not_found" : "not_in_cart" };

  const changed = await ctx.services.cart.change(variantId, quantity, mode);
  if (!changed.ok) return { ok: false, reason: changed.reason };
  const after = await ctx.services.cart.view();
  const line = after.lines.find((entry) => entry.variantId === variantId);
  return {
    ok: true,
    productId,
    title: line?.title ?? existing?.title ?? "",
    quantity: changed.quantity,
    limitedTo: changed.limitedTo,
    itemsInCart: after.lines.reduce((sum, entry) => sum + entry.quantity, 0),
    undo: ctx.services.cart.undoToken({ cartId: changed.cartId, variantId, quantity: existing?.quantity ?? 0 }),
  };
}

export const addToCart = define({
  name: "add_to_cart",
  description:
    "Put a product in the shopper's cart (runs at once; the shopper can undo it). Use it only when the shopper asks to add or buy something. " +
    "Do not use it to start checkout, and never add something the shopper did not ask for.",
  scope: "cart",
  input: z.object({ productId: z.uuid(), quantity: z.number().int().min(1).max(10).default(1) }),
  output: cartResult,
  run: (ctx, { productId, quantity }) => change(ctx, productId, quantity, "add"),
});

export const updateCartItem = define({
  name: "update_cart_item",
  description: "Set how many of a product in the cart the shopper wants (0 removes it). Use it only for products already in the cart.",
  scope: "cart",
  input: z.object({ productId: z.uuid(), quantity: z.number().int().min(0).max(10) }),
  output: cartResult,
  run: (ctx, { productId, quantity }) => change(ctx, productId, quantity, "set"),
});

export const removeFromCart = define({
  name: "remove_from_cart",
  description: "Take a product out of the shopper's cart. Use it only when the shopper asks to remove it.",
  scope: "cart",
  input: z.object({ productId: z.uuid() }),
  output: cartResult,
  run: (ctx, { productId }) => change(ctx, productId, 0, "set"),
});
