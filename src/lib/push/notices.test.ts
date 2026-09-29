/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Tests for what notifications are about: push services only, what a browser sends, and the words in both languages.
 */

import { describe, expect, it } from "vitest";

import { deskWords, isPushServiceEndpoint, ORDER_PUSH_KINDS, orderWords, priceWords, pushMessage, subscribeSchema, topicOf } from "@/lib/push/notices";

const KEYS = { p256dh: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4", auth: "BTBZMqHH6r4Tts7J_aSIgg" };

describe("push endpoints", () => {
  it("accepts the browsers' push services", () => {
    for (const endpoint of [
      "https://fcm.googleapis.com/fcm/send/abc:def",
      "https://updates.push.services.mozilla.com/wpush/v2/gAAAA",
      "https://web.push.apple.com/QGa8",
      "https://wns2-par02p.notify.windows.com/w/?token=x",
    ]) {
      expect(isPushServiceEndpoint(endpoint)).toBe(true);
    }
  });

  it("refuses anything the worker could be made to post to inside the shop's own network", () => {
    for (const endpoint of [
      "http://fcm.googleapis.com/fcm/send/x",
      "https://localhost/push",
      "https://169.254.169.254/latest/meta-data",
      "https://redis.railway.internal/",
      "https://fcm.googleapis.com.evil.example/x",
      "https://evilfcm.googleapis.com.example/x",
      "https://fcm.googleapis.com:8443/x",
      "https://user:pass@fcm.googleapis.com/x",
      "not a url",
    ]) {
      expect(isPushServiceEndpoint(endpoint)).toBe(false);
    }
  });
});

describe("what a browser sends to subscribe", () => {
  it("takes PushSubscription.toJSON() and the chosen topics, each once", () => {
    const parsed = subscribeSchema.parse({ subscription: { endpoint: "https://fcm.googleapis.com/fcm/send/abc", expirationTime: null, keys: KEYS }, topics: ["prices", "orders", "prices"] });
    expect(parsed.topics).toEqual(["orders", "prices"]);
  });

  it("refuses unknown topics, no topics, and keys of the wrong size", () => {
    const subscription = { endpoint: "https://fcm.googleapis.com/fcm/send/abc", keys: KEYS };
    expect(subscribeSchema.safeParse({ subscription, topics: ["offers"] }).success).toBe(false);
    expect(subscribeSchema.safeParse({ subscription, topics: [] }).success).toBe(false);
    expect(subscribeSchema.safeParse({ subscription: { ...subscription, keys: { ...KEYS, auth: "short" } }, topics: ["orders"] }).success).toBe(false);
  });
});

describe("the words", () => {
  it("names the order and what happened, in English and Greek", () => {
    expect(orderWords("shipped", "VT-4JJZ-MPF9", "en")).toEqual({ title: "Order VT-4JJZ-MPF9 is on its way", body: "Tap to follow it." });
    expect(orderWords("shipped", "VT-4JJZ-MPF9", "el")?.title).toBe("Η παραγγελία VT-4JJZ-MPF9 είναι καθ' οδόν");
    expect(orderWords("nothing", "VT-4JJZ-MPF9", "en")).toBeNull();
  });

  it("does not notify the shopper of what they did themselves", () => {
    expect(ORDER_PUSH_KINDS).not.toContain("returnRequested");
    expect(ORDER_PUSH_KINDS).toEqual(expect.arrayContaining(["confirmed", "shipped", "delivered", "cancelled", "refunded", "returnReceived"]));
  });

  it("fits what devices show and carries the page to open", () => {
    const message = pushMessage(priceWords("A".repeat(200), "€39.00", "en"), "https://vitrine.example/en/p/lamp", "price-lamp");
    expect(message.title.length).toBeLessThanOrEqual(80);
    expect(message).toMatchObject({ url: "https://vitrine.example/en/p/lamp", tag: "price-lamp" });
    expect(deskWords("SUP-1234", "el").title).toContain("SUP-1234");
  });

  it("files each notice under the topic the shopper chose", () => {
    expect(topicOf({ type: "order", orderId: "o", kinds: ["shipped"] })).toBe("orders");
    expect(topicOf({ type: "price", userId: "u", slug: "s", title: "t", price: "p" })).toBe("prices");
    expect(topicOf({ type: "desk", ticketId: "t" })).toBe("desk");
  });
});
