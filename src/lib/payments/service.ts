/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Stripe wired to the shop, and what follows every order transition: payment effects, then emails.
 */

import { serverEnv } from "@/env";
import type { OrderStatus, SideEffect } from "@/lib/commerce/order-state";
import { commerceStore, notifyOrder } from "@/lib/commerce/services";
import { sql } from "@/lib/db/client";
import { publishOrderChange } from "@/lib/kv/live";
import { logger } from "@/lib/log";
import { createStripePayments, type StripeLike, type StripePayments } from "@/lib/payments/stripe-payments";

/**
 * docs/adr/038. Null while Stripe's keys are not set: the local test payment
 * stands in, exactly as before. Usable from pages and from the worker (no
 * request needed). The SDK is loaded the first time a payment needs it, so
 * pages that never take one do not carry it.
 */

let client: Promise<StripeLike> | undefined;

function stripeClient(): Promise<StripeLike> {
  client ??= import("stripe").then(({ default: Stripe }) => {
    const key = serverEnv().STRIPE_SECRET_KEY;
    if (key === undefined) throw new Error("STRIPE_SECRET_KEY is not set.");
    // Typed against StripeLike without a cast, so a changed SDK signature fails the build here.
    const stripe: StripeLike = new Stripe(key, { maxNetworkRetries: 2, appInfo: { name: "Vitrine (ITC 4949 capstone)" } });
    return stripe;
  });
  return client;
}

let payments: StripePayments | undefined;

export function stripePayments(): StripePayments | null {
  const env = serverEnv();
  if (env.paymentProvider !== "stripe" || env.STRIPE_WEBHOOK_SECRET === undefined) return null;
  return (payments ??= createStripePayments({
    sql,
    stripe: stripeClient,
    webhookSecret: env.STRIPE_WEBHOOK_SECRET,
    applyEvent: (orderId, type, reason) => commerceStore().applyEvent(orderId, type, "system", { reason }),
    afterEvent: async (orderId, effects, status) => {
      await notifyOrder(orderId, effects);
      await publishOrderChange(orderId, status);
    },
    log: {
      warn: (details, message) => logger.warn({ payments: true, ...details }, message),
      error: (details, message) => logger.error({ payments: true, ...details }, message),
    },
  }));
}

/**
 * After any order transition: the payment provider first (void or refund), then
 * the customer's emails, then a message to every page showing the order
 * (src/lib/kv/live.ts). Every place that moves an order calls this, so no
 * transition forgets its payment or leaves a page out of date.
 */
export async function afterOrderEvent(orderId: string, effects: readonly SideEffect[], status: OrderStatus): Promise<void> {
  await stripePayments()?.runPaymentEffects(orderId, effects);
  await notifyOrder(orderId, effects);
  await publishOrderChange(orderId, status);
}
