/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Sends one notification: finds whose it is and what to say, in each device's language, and posts it.
 */

import { serverEnv } from "@/env";
import { sql } from "@/lib/db/client";
import type { JobPayloads } from "@/lib/jobs/types";
import { loggerFor } from "@/lib/log";
import { deskWords, ORDER_PUSH_KINDS, orderWords, priceWords, pushMessage, topicOf } from "@/lib/push/notices";
import { createPushStore } from "@/lib/push/store";

/**
 * docs/adr/044. The job carries only ids; the person and the words are read
 * here, when it runs, so a notification never says something the database no
 * longer does. Guests have no devices subscribed: an order or a ticket without
 * an account sends nothing. Of several order changes at once, the latest is
 * the one worth a notification.
 */
export async function processPushSend(payload: JobPayloads["push-send"], jobId: string) {
  const log = loggerFor({ job: "push-send", jobId });
  const vapid = serverEnv().vapid;
  if (vapid === null) return { skipped: "no_vapid_keys" };
  const origin = new URL(serverEnv().APP_URL).origin;
  const store = createPushStore(sql);
  const { notice } = payload;

  let target: { userId: string; message: Parameters<typeof store.notify>[2] } | null = null;
  if (notice.type === "order") {
    const [order] = await sql<{ user_id: string | null; number: string }[]>`SELECT user_id, number FROM orders WHERE id = ${notice.orderId}`;
    const kind = [...notice.kinds].reverse().find((entry) => ORDER_PUSH_KINDS.includes(entry));
    if (order?.user_id != null && kind !== undefined) {
      target = { userId: order.user_id, message: (locale) => { const words = orderWords(kind, order.number, locale); return words === null ? null : pushMessage(words, `${origin}/${locale}/orders/${notice.orderId}`, `order-${notice.orderId}`); } };
    }
  } else if (notice.type === "price") {
    target = { userId: notice.userId, message: (locale) => pushMessage(priceWords(notice.title, notice.price, locale), `${origin}/${locale}/p/${notice.slug}`, `price-${notice.slug}`) };
  } else {
    const [ticket] = await sql<{ user_id: string | null; number: string }[]>`SELECT user_id, number FROM support_tickets WHERE id = ${notice.ticketId}`;
    if (ticket?.user_id != null) {
      target = { userId: ticket.user_id, message: (locale) => pushMessage(deskWords(ticket.number, locale), `${origin}/${locale}/support/${notice.ticketId}`, `desk-${notice.ticketId}`) };
    }
  }
  if (target === null) return { skipped: "no_account" };

  // On this machine nothing leaves it: the push is written to the log as if the push service took it, as emails go to the outbox.
  const fetcher: typeof fetch | undefined = serverEnv().localStack
    ? async (input) => {
        log.info({ localPush: { to: new URL(String(input)).host } }, "push not sent: local stack");
        return new Response(null, { status: 201 });
      }
    : undefined;
  const counts = await store.notify(target.userId, topicOf(notice), target.message, { vapid, fetcher });
  log.info({ notice: notice.type, ...counts }, "push sent");
  return counts;
}
