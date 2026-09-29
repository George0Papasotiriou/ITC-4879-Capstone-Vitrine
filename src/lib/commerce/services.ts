/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The commerce store and the order emails, without anything that needs a web request: shared by pages and the worker.
 */

import { serverEnv } from "@/env";
import { createOrderNotifier, type OrderNotifier } from "@/lib/commerce/notify";
import type { SideEffect } from "@/lib/commerce/order-state";
import { createCommerceStore, type CommerceStore } from "@/lib/commerce/store";
import { orderLinkToken } from "@/lib/commerce/tokens";
import { sql } from "@/lib/db/client";
import { appMailer } from "@/lib/email/server";
import { logger } from "@/lib/log";
import { ORDER_PUSH_KINDS } from "@/lib/push/notices";
import { queuePush } from "@/lib/push/queue";

/**
 * Pages reach these through src/lib/commerce/server.ts, which adds the request
 * (cookies, the signed-in person). The worker — which has no request, and
 * whose bundle cannot carry Next.js — uses them from here: the payment expiry
 * job and anything else that moves an order on its own.
 */

let store: CommerceStore | undefined;

export function commerceStore(): CommerceStore {
  // Order links are derived from the order id and the secret, so emails can rebuild them later.
  return (store ??= createCommerceStore(sql, { orderToken: (orderId) => orderLinkToken(orderId, cookieSecret()) }));
}

let notifier: OrderNotifier | undefined;

/** Sends the customer the emails an order transition calls for (payment confirmed, shipped, …). */
export async function notifyOrder(orderId: string, effects: readonly SideEffect[]): Promise<void> {
  notifier ??= createOrderNotifier({
    store: commerceStore(),
    mailer: appMailer(),
    appUrl: serverEnv().APP_URL,
    secret: cookieSecret(),
    log: (message) => logger.error({ orderEmail: true }, message),
  });
  const kinds = await notifier.notify(orderId, effects);
  // The same moments, on the devices of an account holder who asked for them (docs/adr/044).
  const pushKinds = kinds.filter((kind) => ORDER_PUSH_KINDS.includes(kind));
  if (pushKinds.length > 0) await queuePush({ type: "order", orderId, kinds: pushKinds });
}

export function cookieSecret(): string {
  const value = serverEnv().COOKIE_SECRET;
  if (value === undefined) {
    throw new Error("COOKIE_SECRET is not set. `pnpm local` generates one; in production it is required.");
  }
  return value;
}
