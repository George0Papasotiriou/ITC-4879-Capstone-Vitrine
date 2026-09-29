/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Integration tests for push subscriptions: one row per browser, topics honoured, dead devices dropped.
 */

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { uuidv7 } from "uuidv7";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import * as schema from "@/lib/db/schema";
import { createPushStore, MAX_FAILURES, type PushStore } from "@/lib/push/store";
import { generateVapidKeys } from "@/lib/push/webpush";

/** docs/adr/044. The push service is a stand-in that answers as told and records what it was sent; nothing leaves the machine. */

const url = process.env.DATABASE_URL;
const KEYS = { p256dh: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4", auth: "BTBZMqHH6r4Tts7J_aSIgg" };
const vapid = { ...generateVapidKeys(), subject: "mailto:shop@example.com" };

describe.skipIf(url === undefined || url === "")("push subscriptions", () => {
  let connection: ReturnType<typeof postgres>;
  let push: PushStore;
  let userId: string;
  let posted: string[];
  let answer: (endpoint: string) => number;

  const fetcher = (async (endpoint: string) => {
    posted.push(endpoint);
    return new Response(null, { status: answer(endpoint) });
  }) as unknown as typeof fetch;
  const endpoint = () => `https://fcm.googleapis.com/fcm/send/${uuidv7()}`;
  const message = (locale: "en" | "el") => ({ title: locale === "el" ? "Γεια" : "Hello", body: "x", url: "https://vitrine.example/", tag: "t" });

  beforeAll(async () => {
    connection = postgres(url as string, { max: 4, onnotice: () => {} });
    await migrate(drizzle(connection, { schema }), { migrationsFolder: "./drizzle" });
    push = createPushStore(connection);
  });

  beforeEach(async () => {
    userId = uuidv7();
    await connection`INSERT INTO users (id, name, email, email_verified) VALUES (${userId}, 'Shopper', ${`push-${userId}@example.com`}, true)`;
    posted = [];
    answer = () => 201;
  });

  afterAll(async () => {
    await connection?.end();
  });

  it("keeps one row per browser, updated when it subscribes again", async () => {
    const browser = endpoint();
    const first = await push.subscribe({ userId, endpoint: browser, ...KEYS, topics: ["orders"], locale: "en", device: "Chrome · Windows" });
    const again = await push.subscribe({ userId, endpoint: browser, ...KEYS, topics: ["desk", "prices"], locale: "el", device: "Chrome · Windows" });
    expect(again).toBe(first);
    expect(await push.byEndpoint(userId, browser)).toEqual({ id: first, topics: ["desk", "prices"] });
    expect(await push.devices(userId)).toHaveLength(1);
  });

  it("sends only to the devices that asked for the topic", async () => {
    const ordersOnly = endpoint();
    const pricesOnly = endpoint();
    await push.subscribe({ userId, endpoint: ordersOnly, ...KEYS, topics: ["orders"], locale: "en", device: null });
    await push.subscribe({ userId, endpoint: pricesOnly, ...KEYS, topics: ["prices"], locale: "el", device: null });
    expect(await push.notify(userId, "orders", message, { vapid, fetcher })).toEqual({ sent: 1, gone: 0, failed: 0 });
    expect(posted).toEqual([ordersOnly]);
    const [row] = await connection<{ last_sent_at: Date | null }[]>`SELECT last_sent_at FROM push_subscriptions WHERE endpoint = ${ordersOnly}`;
    expect(row!.last_sent_at).not.toBeNull();
  });

  it("deletes a device the push service says is gone, and drops one after ten failures in a row", async () => {
    const gone = endpoint();
    const failing = endpoint();
    await push.subscribe({ userId, endpoint: gone, ...KEYS, topics: ["desk"], locale: "en", device: null });
    await push.subscribe({ userId, endpoint: failing, ...KEYS, topics: ["desk"], locale: "en", device: null });
    answer = (target) => (target === gone ? 410 : 500);
    expect(await push.notify(userId, "desk", message, { vapid, fetcher })).toEqual({ sent: 0, gone: 1, failed: 1 });
    expect(await push.byEndpoint(userId, gone)).toBeNull();
    for (let i = 1; i < MAX_FAILURES; i += 1) await push.notify(userId, "desk", message, { vapid, fetcher });
    expect(await push.byEndpoint(userId, failing)).toBeNull();
  });

  it("lets only the owner remove a device, and removes them all when asked", async () => {
    const mine = endpoint();
    const id = await push.subscribe({ userId, endpoint: mine, ...KEYS, topics: ["orders"], locale: "en", device: null });
    expect(await push.remove(uuidv7(), id)).toBe(false);
    await push.subscribe({ userId, endpoint: endpoint(), ...KEYS, topics: ["prices"], locale: "en", device: null });
    expect(await push.removeAll(userId)).toBe(2);
    expect(await push.devices(userId)).toEqual([]);
  });

  it("refuses unknown topics and addresses that are not https in the database itself", async () => {
    await expect(connection`INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, topics) VALUES (${uuidv7()}, ${userId}, ${endpoint()}, 'k', 'a', ${["offers"]}::text[])`).rejects.toThrow(/push_subscriptions_topics_known/);
    await expect(connection`INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, topics) VALUES (${uuidv7()}, ${userId}, 'http://fcm.googleapis.com/x', 'k', 'a', ${["orders"]}::text[])`).rejects.toThrow(/push_subscriptions_endpoint_https/);
  });
});
