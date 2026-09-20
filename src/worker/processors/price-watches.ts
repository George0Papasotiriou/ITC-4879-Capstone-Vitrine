/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Job processor that emails the shoppers whose watched price has been reached.
 */

import { serverEnv } from "@/env";
import { formatMoney, money } from "@/lib/commerce/money";
import { createPriceWatchStore } from "@/lib/commerce/price-watch-store";
import { sql } from "@/lib/db/client";
import { appMailer } from "@/lib/email/server";
import { emailLocale, priceDrop } from "@/lib/email/templates";
import type { JobPayloads } from "@/lib/jobs/types";
import { loggerFor } from "@/lib/log";

/**
 * The nightly price-watch pass (docs/adr/020).
 *
 * The store decides who to email and arms the watches whose price went back
 * up; this writes the emails and marks the ones that were written. A watch is
 * marked only after its email is in the outbox, so a crash halfway through
 * means the rest are sent on the next pass rather than lost — and a watch
 * already marked is never emailed twice.
 */
export async function processPriceWatches(payload: JobPayloads["price-watches"], jobId: string) {
  const log = loggerFor({ job: "price-watches", jobId });
  const store = createPriceWatchStore(sql);
  const mailer = appMailer();
  const origin = new URL(serverEnv().APP_URL).origin;

  const { due, rearmed } = await store.pass();
  const sent: string[] = [];
  let failed = 0;

  for (const watch of due) {
    const locale = emailLocale(watch.locale);
    const content = priceDrop(locale, {
      name: watch.name,
      title: watch.title,
      price: formatMoney(money(watch.priceCents), locale),
      target: formatMoney(money(watch.targetCents), locale),
      url: `${origin}/${locale}/p/${watch.slug}`,
    });
    try {
      await mailer.sendEmail({ to: watch.email, kind: "price_drop", locale, content });
      sent.push(watch.id);
    } catch (error) {
      // The next pass tries again: the watch is not marked.
      failed += 1;
      log.warn({ err: error, watchId: watch.id }, "price-drop email not written");
    }
  }

  await store.markNotified(sent);
  const stats = { due: due.length, sent: sent.length, failed, rearmed, reason: payload.reason };
  log.info(stats, "price watches checked");
  return stats;
}
