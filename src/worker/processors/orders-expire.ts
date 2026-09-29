/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Unpaid orders past their hold: expired, their stock put back, their payment voided.
 */

import { commerceStore } from "@/lib/commerce/services";
import type { JobPayloads } from "@/lib/jobs/types";
import { loggerFor } from "@/lib/log";
import { afterOrderEvent } from "@/lib/payments/service";

/**
 * docs/adr/038. Expiry used to happen only when someone looked at the order,
 * which was enough while payment was a button on the same page. With Stripe a
 * shopper could pay in another tab long after the hold; so every five minutes
 * the orders past it are expired through the state machine, and each one's
 * `void_payment` effect cancels its PaymentIntent. Safe to run twice: an order
 * already expired is not due any more.
 */
export async function processOrdersExpire(payload: JobPayloads["orders-expire"], jobId: string) {
  const log = loggerFor({ job: "orders-expire", jobId });
  const expired = await commerceStore().expireDue();
  for (const { orderId, effects } of expired) await afterOrderEvent(orderId, effects, "cancelled");
  if (expired.length > 0) log.info({ expired: expired.length, reason: payload.reason }, "unpaid orders expired");
  return { expired: expired.length, reason: payload.reason };
}
