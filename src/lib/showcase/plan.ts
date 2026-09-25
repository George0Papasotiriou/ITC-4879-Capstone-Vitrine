/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The showcase: eight accounts, two per role, and the story each of them has lived in the shop.
 */

import type { Role } from "@/lib/auth/roles";
import type { DemoStep } from "@/lib/commerce/demo-orders";
import { RETURN_WINDOW_DAYS } from "@/lib/commerce/order-state";
import type { ReturnReason } from "@/lib/commerce/returns";
import type { TicketTopic } from "@/lib/support/tickets";

/**
 * A shop that is shown to people has to have a past (docs/adr/028). Signing in
 * as an admin to empty dashboards, or as a customer with no orders, shows the
 * pages but not what they are for. So the deploy can create eight accounts —
 * two for each role — and give each of them a history: orders at every step,
 * reviews, a return, price watches, conversations with the desk, and the staff
 * actions that moved all of it along.
 *
 * Nothing here runs unless George sets SHOWCASE_PASSWORD in Railway himself:
 * the password is the switch, and it never lives in the repository. This file
 * is the plan, pure and tested; `seed.ts` writes it through the shop's own
 * stores, so the history is exactly what real use would leave.
 */

/** Bumped when the seeded history changes shape; a deploy seeds only what an older version lacks. */
export const SHOWCASE_DATA_VERSION = 1;

/** The setting that remembers the showcase history was written. */
export const SHOWCASE_MARKER = "showcase_data";

/** Long enough that an admin account guarded by it is not guessed. */
export const MIN_SHOWCASE_PASSWORD = 12;

export type ShowcaseKey = "customer1" | "customer2" | "support1" | "support2" | "merchandiser1" | "merchandiser2" | "admin1" | "admin2";

export type ShowcaseAccount = { key: ShowcaseKey; role: Role; name: string; email: string; locale: "en" | "el" };

/**
 * Addresses under `.test`, a name reserved so that it can never receive mail
 * (RFC 2606): the accounts are confirmed already, and nothing the shop sends
 * them can reach a real person.
 */
export const SHOWCASE_ACCOUNTS: readonly ShowcaseAccount[] = [
  { key: "customer1", role: "customer", name: "Eleni Papadopoulou", email: "customer1@vitrine.test", locale: "el" },
  { key: "customer2", role: "customer", name: "Oliver Hughes", email: "customer2@vitrine.test", locale: "en" },
  { key: "support1", role: "support", name: "Maria Konstantinou", email: "support1@vitrine.test", locale: "el" },
  { key: "support2", role: "support", name: "Nikos Andreou", email: "support2@vitrine.test", locale: "en" },
  { key: "merchandiser1", role: "merchandiser", name: "Sofia Christodoulou", email: "merchandiser1@vitrine.test", locale: "el" },
  { key: "merchandiser2", role: "merchandiser", name: "Giorgos Ioannou", email: "merchandiser2@vitrine.test", locale: "en" },
  { key: "admin1", role: "admin", name: "Katerina Vlachou", email: "admin1@vitrine.test", locale: "el" },
  { key: "admin2", role: "admin", name: "Dimitris Alexiou", email: "admin2@vitrine.test", locale: "en" },
];

export const accountOf = (key: ShowcaseKey): ShowcaseAccount => SHOWCASE_ACCOUNTS.find((account) => account.key === key)!;

export const isShowcaseEmail = (email: string) => SHOWCASE_ACCOUNTS.some((account) => account.email === email.toLowerCase());

/** The password from the environment, or why there is none; the showcase stays off without one. */
export function showcasePassword(value: string | undefined): { ok: true; password: string } | { ok: false; reason: "unset" | "too_short" } {
  const password = value?.trim() ?? "";
  if (password === "") return { ok: false, reason: "unset" };
  if (password.length < MIN_SHOWCASE_PASSWORD) return { ok: false, reason: "too_short" };
  return { ok: true, password };
}

/**
 * Where an order stands at the end of its story. Each is a page worth showing:
 * a review to read, a return still possible, a parcel on its way, an order
 * that can still be cancelled, a refund, a cancellation.
 */
export type OrderStage = "reviewed" | "returnable" | "shipped" | "paid" | "returned" | "cancelled";

export type OrderStory = {
  key: string;
  owner: ShowcaseKey;
  stage: OrderStage;
  /** Days before now that it was placed. */
  placedDaysAgo: number;
  /** How many different pieces it holds. */
  lines: 1 | 2;
  review?: { rating: 1 | 2 | 3 | 4 | 5; title: string | null; body: string };
  returnReason?: ReturnReason;
  /** Which of the two support agents moved it along. */
  staff: "support1" | "support2";
};

export const ORDER_STORIES: readonly OrderStory[] = [
  // Eleni, who writes in Greek, has the full range.
  { key: "c1-reviewed", owner: "customer1", stage: "reviewed", placedDaysAgo: 26, lines: 2, staff: "support1", review: { rating: 5, title: "Ακριβώς όπως στη φωτογραφία", body: "Πολύ καλή κατασκευή και ήρθε καλά συσκευασμένο. Άλλαξε όλο το σαλόνι." } },
  { key: "c1-returnable", owner: "customer1", stage: "returnable", placedDaysAgo: 6, lines: 1, staff: "support2" },
  { key: "c1-shipped", owner: "customer1", stage: "shipped", placedDaysAgo: 2, lines: 1, staff: "support1" },
  { key: "c1-paid", owner: "customer1", stage: "paid", placedDaysAgo: 0, lines: 1, staff: "support1" },
  { key: "c1-returned", owner: "customer1", stage: "returned", placedDaysAgo: 18, lines: 1, staff: "support2", returnReason: "not_as_described" },
  { key: "c1-cancelled", owner: "customer1", stage: "cancelled", placedDaysAgo: 9, lines: 1, staff: "support1" },
  // Oliver, in English.
  { key: "c2-reviewed", owner: "customer2", stage: "reviewed", placedDaysAgo: 21, lines: 1, staff: "support2", review: { rating: 4, title: "Solid and handsome", body: "Well made and easy to put together. The colour is a shade warmer than the photographs, which I prefer." } },
  { key: "c2-returnable", owner: "customer2", stage: "returnable", placedDaysAgo: 5, lines: 2, staff: "support1" },
  { key: "c2-shipped", owner: "customer2", stage: "shipped", placedDaysAgo: 3, lines: 1, staff: "support2" },
  { key: "c2-returned", owner: "customer2", stage: "returned", placedDaysAgo: 15, lines: 1, staff: "support1", returnReason: "damaged" },
  // Staff shop here too: every account has something on its own page.
  { key: "s1-own", owner: "support1", stage: "reviewed", placedDaysAgo: 24, lines: 1, staff: "support2", review: { rating: 5, title: null, body: "Bought one for my own flat after packing so many. Worth it." } },
  { key: "s2-own", owner: "support2", stage: "shipped", placedDaysAgo: 2, lines: 1, staff: "support1" },
  { key: "m1-own", owner: "merchandiser1", stage: "returnable", placedDaysAgo: 4, lines: 1, staff: "support1" },
  { key: "m2-own", owner: "merchandiser2", stage: "paid", placedDaysAgo: 0, lines: 1, staff: "support2" },
  { key: "a1-own", owner: "admin1", stage: "reviewed", placedDaysAgo: 28, lines: 1, staff: "support2", review: { rating: 4, title: "Καλή αγορά", body: "Όμορφο και γερό. Η παράδοση άργησε μία μέρα, αλλά μας ενημέρωσαν." } },
  { key: "a2-own", owner: "admin2", stage: "shipped", placedDaysAgo: 1, lines: 1, staff: "support1" },
];

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * The timeline of one story, backwards from now so that it is always recent:
 * a showcase deployed months later still has a parcel on its way today. Every
 * step is one the state machine accepts, in its order, all in the past.
 */
export function storySteps(story: OrderStory, now: Date): { placedAt: Date; steps: DemoStep[]; reviewAt: Date | null } {
  // Orders placed "today" are placed three hours ago, so every later step fits before now.
  const placedAt = new Date(now.getTime() - (story.placedDaysAgo === 0 ? 3 * HOUR : story.placedDaysAgo * DAY));
  const at = (offset: number) => new Date(placedAt.getTime() + offset);
  const steps: DemoStep[] = [];

  if (story.stage === "cancelled") {
    steps.push({ event: "cancel", actor: "customer", at: at(6 * MINUTE) });
    return { placedAt, steps, reviewAt: null };
  }

  steps.push({ event: "payment_succeeded", actor: "system", at: at(2 * MINUTE) });
  if (story.stage === "paid") return { placedAt, steps, reviewAt: null };

  steps.push({ event: "pack", actor: "staff", at: at(5 * HOUR) });
  steps.push({ event: "ship", actor: "staff", at: at(20 * HOUR) });
  if (story.stage === "shipped") return { placedAt, steps, reviewAt: null };

  // Delivered two days after shipping, except a returnable order, which must
  // still be inside the return window today: it arrives a day before now at most.
  const deliveredOffset = Math.min(3 * DAY, now.getTime() - placedAt.getTime() - DAY);
  steps.push({ event: "deliver", actor: "staff", at: at(deliveredOffset) });

  if (story.stage === "returned") {
    const askedAt = deliveredOffset + 2 * DAY;
    steps.push({ event: "request_return", actor: "customer", at: at(askedAt), reason: story.returnReason ?? "changed_mind" });
    steps.push({ event: "receive_return", actor: "staff", at: at(askedAt + 3 * DAY) });
    steps.push({ event: "refund", actor: "staff", at: at(askedAt + 4 * DAY), reason: "Return received and checked" });
    return { placedAt, steps, reviewAt: null };
  }

  const reviewAt = story.stage === "reviewed" && story.review !== undefined ? at(deliveredOffset + 2 * DAY) : null;
  return { placedAt, steps, reviewAt };
}

/** Whether a delivered order is still inside the return window on `now`. */
export function stillReturnable(deliveredAt: Date, now: Date): boolean {
  return now.getTime() - deliveredAt.getTime() < RETURN_WINDOW_DAYS * DAY;
}

/** Conversations with the support desk, each one a state the desk's pages show. */
export type TicketStory = {
  key: string;
  /** A showcase customer, or a guest writing from outside. */
  from: { account: ShowcaseKey } | { guest: { name: string; email: string; locale: "en" | "el" } };
  topic: TicketTopic;
  subject: string;
  body: string;
  /** Tie it to one of the owner's orders, by story key. */
  order?: string;
  hoursAgo: number;
  assignee?: "support1" | "support2";
  reply?: { by: "support1" | "support2"; body: string; hoursAfter: number };
  note?: { by: "support1" | "support2"; body: string };
  /** A hand-over from the Concierge: the conversation it carried, as the desk's note. */
  concierge?: string;
  close?: { score: 1 | 2 | 3 | 4 | 5; comment: string | null };
};

export const TICKET_STORIES: readonly TicketStory[] = [
  {
    key: "t-delivery-day",
    from: { account: "customer1" },
    topic: "delivery",
    subject: "Παράδοση το Σάββατο;",
    body: "Καλησπέρα, η παραγγελία μου έχει αποσταλεί. Γίνεται να έρθει το Σάββατο το πρωί; Τις καθημερινές δουλεύω.",
    order: "c1-shipped",
    hoursAgo: 20,
    assignee: "support1",
    reply: { by: "support1", body: "Καλησπέρα Ελένη, μίλησα με τη μεταφορική: μπορούν να έρθουν το Σάββατο 10:00–14:00. Να το κλείσω;", hoursAfter: 2 },
    note: { by: "support1", body: "Courier confirmed Saturday slots are free this week." },
  },
  {
    key: "t-return-refund",
    from: { account: "customer2" },
    topic: "returns",
    subject: "When will my refund arrive?",
    body: "I sent the damaged side table back last week. Has it arrived, and when should I see the refund?",
    order: "c2-returned",
    hoursAgo: 24 * 6,
    assignee: "support2",
    reply: { by: "support2", body: "Hello Oliver, it arrived on Tuesday and the refund went out the same day. Banks usually show it within 5 working days. Sorry the first one was damaged.", hoursAfter: 3 },
    close: { score: 5, comment: "Quick and clear, thank you." },
  },
  {
    key: "t-concierge",
    from: { account: "customer2" },
    topic: "product",
    subject: "Does the sofa fit through a 70 cm door?",
    body: 'The shopper asked for a person: "Will the Emerly sofa fit through a 70 cm doorway, or do the legs come off?"',
    hoursAgo: 5,
    concierge: "Shopper: Will the Emerly sofa fit through a 70 cm doorway?\nConcierge: It is 89 cm deep and 86 cm high, so it would need to go in on its side. I can pass this to a person who can check whether the legs come off.\nShopper: Yes please, I want to talk to a person.",
  },
  {
    key: "t-guest-question",
    from: { guest: { name: "Anna Martin", email: "anna.martin@guests.vitrine.test", locale: "en" } },
    topic: "product",
    subject: "Assembly of the dining table",
    body: "Hello, does the Hayes dining table come assembled, or will I need tools? I live on the third floor without a lift.",
    hoursAgo: 3,
  },
];

/** Price watches: each customer waits for a price on something they looked at. */
export const WATCH_STORIES: readonly { owner: ShowcaseKey; productIndex: number; discount: number }[] = [
  { owner: "customer1", productIndex: 3, discount: 0.1 },
  { owner: "customer1", productIndex: 7, discount: 0.2 },
  { owner: "customer2", productIndex: 5, discount: 0.15 },
  { owner: "admin2", productIndex: 9, discount: 0.1 },
];

/** A target a little under the price, in whole euros so it reads as a person's number. */
export function watchTarget(priceCents: number, discount: number): number {
  return Math.max(100, Math.floor((priceCents * (1 - discount)) / 100) * 100);
}

/** Reviews nobody should read, for the admins to take down: moderation with a reason on record. */
export const SPAM_REVIEWS: readonly { by: "admin1" | "admin2"; title: string; body: string; reason: string }[] = [
  { by: "admin1", title: "BEST PRICES", body: "Same sofa 70% cheaper at cheap-sofa-outlet dot biz, message me for the link!!!", reason: "Spam: advertises another shop" },
  { by: "admin2", title: "Great", body: "Great great great great great great great great great great great great", reason: "Not a review of the piece" },
];
