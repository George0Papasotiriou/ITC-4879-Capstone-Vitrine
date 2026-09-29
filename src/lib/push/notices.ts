/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * What a notification may be about, which push services the shop will post to, and the words of each notification.
 */

import { z } from "zod";

import type { PushMessage } from "@/lib/push/webpush";

/**
 * docs/adr/044. Three things a shopper can ask to hear about on a device:
 * their orders moving, a watched price reached, and a reply from the desk.
 * Nothing else — no offers, no reminders — and only after they turn it on.
 */

export const PUSH_TOPICS = ["orders", "prices", "desk"] as const;
export type PushTopic = (typeof PUSH_TOPICS)[number];

/**
 * The shop's worker POSTs to whatever endpoint a browser gives, so the
 * endpoint must be a real push service, never an address inside the shop's
 * own network (a server-side request forgery). These are the push services of
 * Chrome and Edge's Android/desktop (FCM), Firefox, Safari and Edge on Windows.
 */
const PUSH_SERVICE_HOSTS = ["fcm.googleapis.com", "android.googleapis.com", "push.services.mozilla.com", "push.apple.com", "notify.windows.com"] as const;

export function isPushServiceEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.port !== "" || url.username !== "" || url.password !== "") return false;
  const host = url.hostname.toLowerCase();
  return PUSH_SERVICE_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

/** What the browser's PushSubscription.toJSON() gives, and the topics chosen, as the subscribe route accepts them. */
export const subscribeSchema = z.object({
  subscription: z.object({
    endpoint: z.string().max(1000).refine(isPushServiceEndpoint, "Not a browser push service"),
    keys: z.object({
      // A P-256 point (65 bytes) and a 16-byte secret, base64url.
      p256dh: z.string().regex(/^[A-Za-z0-9_-]{86,88}={0,2}$/),
      auth: z.string().regex(/^[A-Za-z0-9_-]{22,24}={0,2}$/),
    }),
  }),
  topics: z.array(z.enum(PUSH_TOPICS)).min(1).max(PUSH_TOPICS.length * 2).transform((topics) => [...new Set(topics)].sort()),
});

/** What a notification is about, as the job that sends it carries it. */
export type PushNotice =
  | { type: "order"; orderId: string; kinds: string[] }
  | { type: "price"; userId: string; slug: string; title: string; price: string }
  | { type: "desk"; ticketId: string };

export const topicOf = (notice: PushNotice): PushTopic => (notice.type === "order" ? "orders" : notice.type === "price" ? "prices" : "desk");

type Words = { title: string; body: string };

const ORDER_WORDS: Record<"en" | "el", Record<string, (number: string) => Words>> = {
  en: {
    confirmed: (number) => ({ title: `Order ${number} is confirmed`, body: "Your payment arrived. We will tell you when it ships." }),
    shipped: (number) => ({ title: `Order ${number} is on its way`, body: "Tap to follow it." }),
    delivered: (number) => ({ title: `Order ${number} was delivered`, body: "Tap to review it, or to send it back within 14 days." }),
    cancelled: (number) => ({ title: `Order ${number} was cancelled`, body: "Tap to see what happens next." }),
    refunded: (number) => ({ title: `Your refund for ${number} is on its way`, body: "Tap for the details." }),
    returnReceived: (number) => ({ title: `We received the return for ${number}`, body: "Your refund follows. Tap for the details." }),
  },
  el: {
    confirmed: (number) => ({ title: `Η παραγγελία ${number} επιβεβαιώθηκε`, body: "Λάβαμε την πληρωμή σου. Θα σε ενημερώσουμε όταν σταλεί." }),
    shipped: (number) => ({ title: `Η παραγγελία ${number} είναι καθ' οδόν`, body: "Πάτησε για να την παρακολουθήσεις." }),
    delivered: (number) => ({ title: `Η παραγγελία ${number} παραδόθηκε`, body: "Πάτησε για να την αξιολογήσεις ή να την επιστρέψεις μέσα σε 14 ημέρες." }),
    cancelled: (number) => ({ title: `Η παραγγελία ${number} ακυρώθηκε`, body: "Πάτησε για να δεις τι ακολουθεί." }),
    refunded: (number) => ({ title: `Η επιστροφή χρημάτων για την ${number} είναι καθ' οδόν`, body: "Πάτησε για λεπτομέρειες." }),
    returnReceived: (number) => ({ title: `Παραλάβαμε την επιστροφή της ${number}`, body: "Ακολουθεί η επιστροφή χρημάτων. Πάτησε για λεπτομέρειες." }),
  },
};

/** The kinds of order change worth a notification; a return being asked for is the shopper's own doing and is not. */
export const ORDER_PUSH_KINDS = Object.keys(ORDER_WORDS.en);

export function orderWords(kind: string, number: string, locale: "en" | "el"): Words | null {
  return ORDER_WORDS[locale][kind]?.(number) ?? null;
}

export function priceWords(title: string, price: string, locale: "en" | "el"): Words {
  return locale === "el"
    ? { title: `Η τιμή που περίμενες: ${title}`, body: `Τώρα ${price}. Πάτησε για να το δεις.` }
    : { title: `The price you waited for: ${title}`, body: `Now ${price}. Tap to see it.` };
}

export function deskWords(number: string, locale: "en" | "el"): Words {
  return locale === "el" ? { title: `Απάντηση για το αίτημα ${number}`, body: "Πάτησε για να τη διαβάσεις." } : { title: `The desk replied about ${number}`, body: "Tap to read it." };
}

/** A notification's words, cut to what devices show, with the page it opens. */
export function pushMessage(words: Words, url: string, tag: string): PushMessage {
  return { title: words.title.slice(0, 80), body: words.body.slice(0, 160), url, tag };
}
