/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Demo orders, the pure part: the life each demo order goes through, planned in time and checked against the state machine.
 */

import { RETURN_WINDOW_DAYS, type Actor, type OrderEventType } from "@/lib/commerce/order-state";
import { RETURN_REASONS, type ReturnReason } from "@/lib/commerce/returns";

/**
 * Demo orders (docs/PLAN.md Phase 5 step 7; `pnpm orders demo`). Each order
 * is placed at a moment in the past and then lives the life a real one would:
 * paid within minutes, packed within a day, delivered a few days later, now
 * and then reviewed, returned, cancelled or never paid. Steps that would fall
 * after "now" are not taken, so recent orders are still on their way — the
 * order desk's queues fill the way a running shop's would.
 *
 * The plan only says what should happen and when; the script sends every
 * step through the real store and state machine, which refuse anything a
 * shopper or staff could not do.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export type DemoStep = { event: OrderEventType; actor: Actor; at: Date; reason?: string };

export type DemoPlan = {
  steps: DemoStep[];
  /** A review of the order's first line, once delivered. */
  review: { at: Date; rating: 1 | 2 | 3 | 4 | 5 } | null;
};

/** How often each life happens; the rest are paid and go on to delivery. */
export const DEMO_ODDS = {
  neverPaid: 0.07,
  paymentFailed: 0.03,
  cancelledBeforePaying: 0.02,
  cancelledAfterPaying: 0.03,
  /** Of delivered orders. */
  returned: 0.08,
  /** Of delivered orders kept. */
  reviewed: 0.4,
} as const;

/** Most reviews are good, as in real shops; a few are not. */
const RATING_WEIGHTS: readonly [1 | 2 | 3 | 4 | 5, number][] = [
  [5, 0.5],
  [4, 0.3],
  [3, 0.12],
  [2, 0.05],
  [1, 0.03],
];

const RETURN_WEIGHTS: Readonly<Record<ReturnReason, number>> = {
  changed_mind: 0.4,
  damaged: 0.2,
  not_as_described: 0.2,
  wrong_item: 0.1,
  other: 0.1,
};

export function pickWeighted<T>(random: () => number, weighted: readonly (readonly [T, number])[]): T {
  const total = weighted.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = random() * total;
  for (const [value, weight] of weighted) {
    roll -= weight;
    if (roll < 0) return value;
  }
  return weighted.at(-1)![0];
}

/** A moment `min` to `max` milliseconds after `from`. */
const after = (random: () => number, from: Date, min: number, max: number) => new Date(from.getTime() + min + random() * (max - min));

/**
 * Plans one order placed at `placedAt`. Steps are in time order, none after
 * `now`; the plan stops at the first step still in the future.
 */
export function planDemoOrder(random: () => number, placedAt: Date, now: Date): DemoPlan {
  const steps: DemoStep[] = [];
  const plan: DemoPlan = { steps, review: null };
  /** Adds a step if it has already happened; returns whether it did. */
  const take = (step: DemoStep) => {
    if (step.at.getTime() > now.getTime()) return false;
    steps.push(step);
    return true;
  };

  const life = random();
  const odds = DEMO_ODDS;
  if (life < odds.neverPaid) {
    // Left at the payment step; the 30-minute hold runs out.
    take({ event: "payment_expired", actor: "system", at: after(random, placedAt, 31 * MINUTE, 40 * MINUTE) });
    return plan;
  }
  if (life < odds.neverPaid + odds.paymentFailed) {
    take({ event: "payment_failed", actor: "system", at: after(random, placedAt, MINUTE, 5 * MINUTE) });
    return plan;
  }
  if (life < odds.neverPaid + odds.paymentFailed + odds.cancelledBeforePaying) {
    take({ event: "cancel", actor: "customer", at: after(random, placedAt, 2 * MINUTE, 10 * MINUTE) });
    return plan;
  }

  const paidAt = after(random, placedAt, MINUTE, 4 * MINUTE);
  if (!take({ event: "payment_succeeded", actor: "system", at: paidAt })) return plan;

  if (life < odds.neverPaid + odds.paymentFailed + odds.cancelledBeforePaying + odds.cancelledAfterPaying) {
    const cancelledAt = after(random, paidAt, HOUR, 8 * HOUR);
    if (!take({ event: "cancel", actor: "staff", at: cancelledAt, reason: "Customer asked by phone to cancel" })) return plan;
    // The payment provider confirms the refund.
    take({ event: "refund", actor: "system", at: after(random, cancelledAt, 10 * MINUTE, 2 * HOUR) });
    return plan;
  }

  const packedAt = after(random, paidAt, 2 * HOUR, 20 * HOUR);
  if (!take({ event: "pack", actor: "staff", at: packedAt })) return plan;
  const shippedAt = after(random, packedAt, 3 * HOUR, 30 * HOUR);
  if (!take({ event: "ship", actor: "staff", at: shippedAt })) return plan;
  const deliveredAt = after(random, shippedAt, DAY, 4 * DAY);
  if (!take({ event: "deliver", actor: "staff", at: deliveredAt })) return plan;

  if (random() < odds.returned) {
    // Asked for well inside the 14-day window, so the state machine accepts it.
    const reason = pickWeighted(random, RETURN_REASONS.map((code) => [code, RETURN_WEIGHTS[code]] as const));
    const askedAt = after(random, deliveredAt, DAY, (RETURN_WINDOW_DAYS - 4) * DAY);
    if (!take({ event: "request_return", actor: "customer", at: askedAt, reason })) return plan;
    const receivedAt = after(random, askedAt, 2 * DAY, 5 * DAY);
    if (!take({ event: "receive_return", actor: "staff", at: receivedAt })) return plan;
    take({ event: "refund", actor: "staff", at: after(random, receivedAt, 4 * HOUR, 2 * DAY), reason: "Return received in good condition" });
    return plan;
  }

  if (random() < odds.reviewed) {
    const at = after(random, deliveredAt, 6 * HOUR, 7 * DAY);
    if (at.getTime() <= now.getTime()) plan.review = { at, rating: pickWeighted(random, RATING_WEIGHTS) };
  }
  return plan;
}

/** When an order was placed: within the last `days`, more of them recently, in the daytime. */
export function demoPlacedAt(random: () => number, now: Date, days: number): Date {
  // Squaring leans toward recent days, as a growing shop's orders do.
  const daysAgo = Math.floor(random() ** 2 * days);
  const at = new Date(now.getTime() - daysAgo * DAY);
  // Between 08:00 and 23:00 UTC (10:00 and 01:00 in Athens).
  at.setUTCHours(8 + Math.floor(random() * 15), Math.floor(random() * 60), Math.floor(random() * 60), 0);
  return at.getTime() > now.getTime() ? new Date(now.getTime() - (5 + random() * 60) * MINUTE) : at;
}
