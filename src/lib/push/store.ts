/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Push subscriptions in the database, and sending one notice to every device of a person that asked for its topic.
 */

import type postgres from "postgres";
import { uuidv7 } from "uuidv7";

import type { PushTopic } from "@/lib/push/notices";
import { sendPush, type PushMessage, type PushOutcome, type PushSubscriptionKeys, type VapidKeys } from "@/lib/push/webpush";

/**
 * docs/adr/044. A browser's endpoint is unique: subscribing again (new
 * topics, or another account signed in on the same browser) updates the one
 * row rather than adding one. Sending marks what worked, deletes what the
 * push service says is gone, and drops a subscription after ten failures in a
 * row, so a dead device does not cost a request forever.
 */

type Sql = postgres.Sql;

export const MAX_FAILURES = 10;

export type PushDevice = { id: string; device: string | null; topics: PushTopic[]; createdAt: Date; lastSentAt: Date | null };

export function createPushStore(sql: Sql) {
  async function subscribe(input: { userId: string; endpoint: string; p256dh: string; auth: string; topics: readonly PushTopic[]; locale: string; device: string | null }): Promise<string> {
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, topics, locale, device)
      VALUES (${uuidv7()}, ${input.userId}, ${input.endpoint}, ${input.p256dh}, ${input.auth}, ${[...input.topics]}::text[], ${input.locale}, ${input.device})
      ON CONFLICT (endpoint) DO UPDATE
        SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, topics = excluded.topics,
            locale = excluded.locale, device = excluded.device, failures = 0
      RETURNING id
    `;
    return row!.id;
  }

  /** This browser's subscription, if it is the person's; for the preferences page. */
  async function byEndpoint(userId: string, endpoint: string): Promise<{ id: string; topics: PushTopic[] } | null> {
    const [row] = await sql<{ id: string; topics: string[] }[]>`SELECT id, topics FROM push_subscriptions WHERE user_id = ${userId} AND endpoint = ${endpoint}`;
    return row === undefined ? null : { id: row.id, topics: row.topics as PushTopic[] };
  }

  async function unsubscribe(userId: string, endpoint: string): Promise<boolean> {
    return (await sql`DELETE FROM push_subscriptions WHERE user_id = ${userId} AND endpoint = ${endpoint}`).count > 0;
  }

  /** Deletes one of the person's devices from /account/data. */
  async function remove(userId: string, id: string): Promise<boolean> {
    return (await sql`DELETE FROM push_subscriptions WHERE user_id = ${userId} AND id = ${id}`).count > 0;
  }

  /** Every device of the person, for "forget everything". */
  async function removeAll(userId: string): Promise<number> {
    return (await sql`DELETE FROM push_subscriptions WHERE user_id = ${userId}`).count;
  }

  async function devices(userId: string): Promise<PushDevice[]> {
    const rows = await sql<{ id: string; device: string | null; topics: string[]; created_at: Date; last_sent_at: Date | null }[]>`
      SELECT id, device, topics, created_at, last_sent_at FROM push_subscriptions WHERE user_id = ${userId} ORDER BY created_at
    `;
    return rows.map((row) => ({ id: row.id, device: row.device, topics: row.topics as PushTopic[], createdAt: new Date(row.created_at), lastSentAt: row.last_sent_at === null ? null : new Date(row.last_sent_at) }));
  }

  /**
   * Sends to every device of this person that asked for the topic. `message`
   * is built per device, in the language that device subscribed in.
   */
  async function notify(
    userId: string,
    topic: PushTopic,
    message: (locale: "en" | "el") => PushMessage | null,
    { vapid, fetcher, now = new Date() }: { vapid: VapidKeys; fetcher?: typeof fetch; now?: Date },
  ): Promise<Record<PushOutcome, number>> {
    const targets = await sql<(PushSubscriptionKeys & { id: string; locale: string })[]>`
      SELECT id, endpoint, p256dh, auth, locale FROM push_subscriptions WHERE user_id = ${userId} AND ${topic} = ANY(topics)
    `;
    const counts: Record<PushOutcome, number> = { sent: 0, gone: 0, failed: 0 };
    for (const target of targets) {
      const built = message(target.locale === "el" ? "el" : "en");
      if (built === null) continue;
      const outcome = await sendPush(target, built, vapid, { fetcher });
      counts[outcome] += 1;
      if (outcome === "sent") await sql`UPDATE push_subscriptions SET last_sent_at = ${now.toISOString()}::timestamptz, failures = 0 WHERE id = ${target.id}`;
      else if (outcome === "gone") await sql`DELETE FROM push_subscriptions WHERE id = ${target.id}`;
      else await sql`UPDATE push_subscriptions SET failures = failures + 1 WHERE id = ${target.id}`;
    }
    if (counts.failed > 0) await sql`DELETE FROM push_subscriptions WHERE user_id = ${userId} AND failures >= ${MAX_FAILURES}`;
    return counts;
  }

  return { subscribe, byEndpoint, unsubscribe, remove, removeAll, devices, notify };
}

export type PushStore = ReturnType<typeof createPushStore>;
