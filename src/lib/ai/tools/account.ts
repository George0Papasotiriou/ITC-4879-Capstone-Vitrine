/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Account tools: the shopper's own orders and their status, and the two sensitive steps, checkout and returns.
 */

import { z } from "zod";

import type { VitrineTool } from "@/lib/ai/tools/types";
import { uiCommandSchema } from "@/lib/ai/ui-commands";
import { MAX_PRICE_CENTS } from "@/lib/admin/catalog";
import { ORDER_STATUSES } from "@/lib/commerce/order-state";
import { MIN_TARGET_CENTS } from "@/lib/commerce/price-watch";
import { RETURN_REASONS } from "@/lib/commerce/returns";

/**
 * Only the shopper's own orders: a signed-in account's, or the guest's most
 * recent order in this browser. The services enforce it; these tools never
 * take an email or an order id from the model, only an order number, which is
 * then looked up among the shopper's own orders (docs/PLAN.md 2.5 guardrails).
 *
 * The sensitive tools ask the shopper first (an approval card; on voice, an
 * on-screen button too) and neither takes money: checkout only opens the page
 * where the shopper pays, and a return is only requested.
 */

const define = <I, O>(tool: VitrineTool<I, O>) => tool;
const orderNumber = z.string().trim().toUpperCase().regex(/^VT-[0-9A-Z]{4}-[0-9A-Z]{4}$/, "An order number looks like VT-4JJZ-MPF9");
const status = z.enum(ORDER_STATUSES);

export const getOrders = define({
  name: "get_orders",
  description:
    "The shopper's own recent orders: number, status, date, total. Use it when they ask about their orders. " +
    "It knows nothing about other people's orders; never ask for someone else's.",
  scope: "account",
  input: z.object({}),
  output: z.object({
    orders: z.array(z.object({ number: z.string(), status, placedAt: z.string(), totalCents: z.number().int(), currency: z.string(), items: z.number().int() })),
    signedIn: z.boolean(),
  }),
  async run(ctx) {
    const orders = await ctx.services.orders.mine();
    return {
      signedIn: ctx.user !== null,
      orders: orders.slice(0, 10).map((order) => ({
        number: order.number,
        status: order.status,
        placedAt: order.createdAt.toISOString(),
        totalCents: order.total.cents,
        currency: order.total.currency,
        items: order.itemCount,
      })),
    };
  },
});

export const getOrderStatus = define({
  name: "get_order_status",
  description:
    "Where one of the shopper's own orders is now, with its history. Use it with an order number from get_orders or from the shopper. " +
    "Do not guess order numbers, and do not use it for anyone else's order.",
  scope: "account",
  input: z.object({ number: orderNumber }),
  output: z.discriminatedUnion("found", [
    z.object({
      found: z.literal(true),
      number: z.string(),
      status,
      placedAt: z.string(),
      deliveredAt: z.string().nullable(),
      canReturnUntil: z.string().nullable(),
      history: z.array(z.object({ event: z.string(), at: z.string() })),
      items: z.array(z.object({ title: z.string(), quantity: z.number().int() })),
    }),
    z.object({ found: z.literal(false) }),
  ]),
  async run(ctx, { number }) {
    const order = await ctx.services.orders.byNumber(number);
    if (order === null) return { found: false as const };
    const returnUntil = order.status === "delivered" && order.deliveredAt !== null ? new Date(order.deliveredAt.getTime() + 14 * 24 * 60 * 60 * 1000) : null;
    return {
      found: true as const,
      number: order.number,
      status: order.status,
      placedAt: order.createdAt.toISOString(),
      deliveredAt: order.deliveredAt?.toISOString() ?? null,
      canReturnUntil: returnUntil !== null && returnUntil.getTime() > Date.now() ? returnUntil.toISOString() : null,
      history: order.events.map((event) => ({ event: event.event, at: event.at.toISOString() })),
      items: order.items.map((item) => ({ title: item.title, quantity: item.quantity })),
    };
  },
});

export const startCheckout = define({
  name: "start_checkout",
  description:
    "Open checkout for what is in the cart, after the shopper approves. The shopper checks the order and pays on that page themselves; you never pay or enter details. " +
    "Use it only when the shopper says they want to check out.",
  scope: "sensitive",
  input: z.object({}),
  output: z.discriminatedUnion("ok", [
    z.object({ ok: z.literal(true), commands: z.array(uiCommandSchema), items: z.number().int() }),
    z.object({ ok: z.literal(false), reason: z.literal("empty_cart") }),
  ]),
  async run(ctx) {
    const cart = await ctx.services.cart.view();
    const items = cart.lines.filter((line) => line.available).reduce((sum, line) => sum + line.quantity, 0);
    if (items === 0) return { ok: false as const, reason: "empty_cart" as const };
    const caption = ctx.locale === "el" ? "Άνοιγμα της ολοκλήρωσης αγοράς" : "Opening checkout";
    return { ok: true as const, items, commands: [uiCommandSchema.parse({ type: "navigate", href: "/checkout", caption })] };
  },
});

export const startReturn = define({
  name: "start_return",
  description:
    "Ask for a return of one of the shopper's own delivered orders, within 14 days of delivery, after the shopper approves. " +
    "Use it only when the shopper asks to send an order back, with their reason. The shop then arranges the collection and the refund.",
  scope: "sensitive",
  input: z.object({ number: orderNumber, reason: z.enum(RETURN_REASONS), note: z.string().trim().max(300).optional() }),
  output: z.discriminatedUnion("ok", [z.object({ ok: z.literal(true), number: z.string() }), z.object({ ok: z.literal(false), reason: z.string() })]),
  async run(ctx, { number, reason, note }) {
    const order = await ctx.services.orders.byNumber(number);
    if (order === null) return { ok: false as const, reason: "not_found" };
    const result = await ctx.services.orders.requestReturn(order.id, note === undefined || note === "" ? reason : `${reason}: ${note}`);
    return result.ok ? { ok: true as const, number: order.number } : { ok: false as const, reason: result.reason };
  },
});

export const setPriceWatch = define({
  name: "set_price_watch",
  description:
    "Watch one product's price for the shopper: the shop emails them once, the day it reaches the amount they name. " +
    "Use it when they say they would buy it cheaper, or ask to be told about a drop; pass `remove: true` to stop watching. " +
    "It needs a signed-in account, and it only watches: it never changes a price and never promises a discount.",
  scope: "account",
  input: z.object({
    productId: z.uuid().describe("A product id from a search or a recommendation, never guessed."),
    targetCents: z.number().int().min(MIN_TARGET_CENTS).max(MAX_PRICE_CENTS).optional().describe("The price to wait for, in cents, below today's price."),
    remove: z.boolean().optional().describe("Stop watching this product's price."),
  }),
  output: z.discriminatedUnion("ok", [
    z.object({ ok: z.literal(true), watching: z.boolean(), targetCents: z.number().int().nullable() }),
    z.object({ ok: z.literal(false), reason: z.enum(["sign_in", "needs_target", "not_found", "not_below_price", "too_many"]) }),
  ]),
  async run(ctx, { productId, targetCents, remove }) {
    // The account is the answer's address, so there is nothing to do without one.
    if (ctx.user === null) return { ok: false as const, reason: "sign_in" as const };
    if (remove === true) {
      await ctx.services.watch.remove(productId);
      return { ok: true as const, watching: false, targetCents: null };
    }
    if (targetCents === undefined) return { ok: false as const, reason: "needs_target" as const };
    const result = await ctx.services.watch.set(productId, targetCents);
    return result.ok ? { ok: true as const, watching: true, targetCents } : { ok: false as const, reason: result.reason };
  },
});

export const tryOnPiece = define({
  name: "try_on",
  description:
    "Try one piece of clothing on the photograph the shopper gave the Fitting Room. It costs the shopper credits, so ask first, and only for one piece at a time. " +
    "Use it when they ask to see something on themselves. It needs a photograph they have already given; if there is none, say so and open the Fitting Room instead. " +
    "Never describe how the result looks: the shopper sees it, and it is their own photograph.",
  scope: "costly",
  credits: "try_on",
  input: z.object({ productId: z.uuid().describe("A product id from a search; clothes only.") }),
  output: z.discriminatedUnion("ok", [
    z.object({ ok: z.literal(true), tryOnId: z.string(), minutesLeft: z.number().int(), commands: z.array(uiCommandSchema) }),
    z.object({ ok: z.literal(false), reason: z.enum(["no_photo", "not_clothes", "not_found", "refused"]), commands: z.array(uiCommandSchema) }),
  ]),
  async run(ctx, { productId }) {
    const [card] = await ctx.services.cards([productId]);
    if (card === undefined) return { ok: false as const, reason: "not_found" as const, commands: [] };
    if (card.category !== "wear") return { ok: false as const, reason: "not_clothes" as const, commands: [] };

    const fittingRoom = uiCommandSchema.parse({
      type: "navigate",
      href: "/fitting-room",
      caption: ctx.locale === "el" ? "Άνοιγμα του δοκιμαστηρίου" : "Opening the Fitting Room",
    });

    // Without a photograph there is nothing to try it on; the page is where one is given.
    const photo = await ctx.services.tryOn.photo();
    if (photo === null) return { ok: false as const, reason: "no_photo" as const, commands: [fittingRoom] };

    const started = await ctx.services.tryOn.start({ photoId: photo.id, productId });
    if (!started.ok) return { ok: false as const, reason: "refused" as const, commands: [] };
    return { ok: true as const, tryOnId: started.id, minutesLeft: photo.minutesLeft, commands: [fittingRoom] };
  },
});
