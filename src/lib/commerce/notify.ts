/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Order emails: turns the order state machine's email side effects into messages to the customer.
 */

import type { SideEffect } from "@/lib/commerce/order-state";
import type { CommerceStore } from "@/lib/commerce/store";
import { orderLinkToken, tokenMatches } from "@/lib/commerce/tokens";
import type { Mailer } from "@/lib/email/mailer";
import { emailLocale, orderUpdate, type OrderEmailKind } from "@/lib/email/templates";

/**
 * The state machine (order-state.ts) already says which transitions warrant an
 * email — payment confirmed, shipped, delivered, cancelled, refunded, return
 * received — as side effects it returns. This sends them, in the order's own
 * language, with a link back to the order:
 *
 * - the guest's private link, rebuilt from the order id and the secret
 *   (tokens.orderLinkToken), when it matches the stored hash;
 * - otherwise (orders placed before links were derived) the plain order page,
 *   which asks the owner to sign in.
 *
 * An email that cannot be written is logged, never thrown: the order has
 * already moved, and a failed email must not make the person who moved it
 * believe it did not.
 */

const EFFECT_EMAILS: Partial<Record<SideEffect, OrderEmailKind>> = {
  email_order_confirmed: "confirmed",
  email_order_shipped: "shipped",
  email_order_delivered: "delivered",
  email_order_cancelled: "cancelled",
  email_refunded: "refunded",
  email_return_requested: "returnRequested",
  email_return_received: "returnReceived",
};

export function orderEmailKinds(effects: readonly SideEffect[]): OrderEmailKind[] {
  return effects.map((effect) => EFFECT_EMAILS[effect]).filter((kind): kind is OrderEmailKind => kind !== undefined);
}

export type OrderNotifierOptions = {
  store: Pick<CommerceStore, "orderContact">;
  mailer: Pick<Mailer, "sendEmail">;
  /** Public origin for links, e.g. https://vitrine.up.railway.app. */
  appUrl: string;
  /** The secret order links are derived with (COOKIE_SECRET). */
  secret: string;
  log?: (message: string) => void;
};

export function createOrderNotifier({ store, mailer, appUrl, secret, log }: OrderNotifierOptions) {
  const origin = new URL(appUrl).origin;

  /** Sends the emails the effects call for; returns the kinds sent. */
  async function notify(orderId: string, effects: readonly SideEffect[]): Promise<OrderEmailKind[]> {
    const kinds = orderEmailKinds(effects);
    if (kinds.length === 0) return [];
    try {
      const order = await store.orderContact(orderId);
      if (order === null) return [];
      const locale = emailLocale(order.locale);
      const token = orderLinkToken(order.id, secret);
      const guestLink = tokenMatches(token, order.accessTokenHash);
      const url = `${origin}/${locale}/orders/${order.id}${guestLink ? `?t=${encodeURIComponent(token)}` : ""}`;
      for (const kind of kinds) {
        await mailer.sendEmail({
          to: order.email,
          kind: `order_${kind}`,
          locale,
          content: orderUpdate(locale, { kind, name: order.name, number: order.number, url, signInNeeded: !guestLink }),
        });
      }
      return kinds;
    } catch (error) {
      log?.(`Order email for ${orderId} could not be written: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }

  return { notify };
}

export type OrderNotifier = ReturnType<typeof createOrderNotifier>;
