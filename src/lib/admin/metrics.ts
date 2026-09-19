/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Dashboard definitions, the pure part: reporting periods, day buckets, and what each figure means, computed from plain rows.
 */

import { RETURN_REASONS, type ReturnReason } from "@/lib/commerce/returns";

/**
 * Dashboards (docs/adr/018). Each figure is defined here once, as a function
 * of plain rows. The dashboard computes the same figures in SQL, for speed;
 * the integration tests feed both the same orders and require the same
 * answers (docs/PLAN.md Phase 11: "dashboard numbers match database queries").
 *
 * Definitions:
 * - A sale counts on the day it was paid, not the day it was placed.
 * - Gross sales: the totals (VAT and delivery included) of orders paid in the period.
 * - Refunds: the totals of orders refunded in the period, whenever they were paid.
 * - Net sales: gross minus refunds.
 * - Average order: gross over the number of orders paid, to the cent.
 * - Return rate: returns asked for in the period over deliveries in the period.
 * Days are UTC days, the same for every viewer and every test.
 */

export const PERIODS = [7, 30, 90] as const;
export type PeriodDays = (typeof PERIODS)[number];

export type Period = {
  days: PeriodDays;
  /** Midnight UTC at the start of the first day. */
  from: Date;
  /** Now: the period runs to the moment it is asked for. */
  to: Date;
  /** "2026-09-19" for each day, oldest first. */
  dayKeys: string[];
};

const DAY = 24 * 60 * 60 * 1000;

export function parsePeriod(value: unknown): PeriodDays {
  const days = typeof value === "string" ? Number.parseInt(value, 10) : value;
  return PERIODS.find((option) => option === days) ?? 30;
}

export function dayKey(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/** The last `days` UTC days, today included. */
export function periodFor(days: PeriodDays, now = new Date()): Period {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const from = new Date(today - (days - 1) * DAY);
  return { days, from, to: now, dayKeys: Array.from({ length: days }, (_, index) => dayKey(new Date(from.getTime() + index * DAY))) };
}

export function inPeriod(at: Date | null, period: Period): at is Date {
  return at !== null && at.getTime() >= period.from.getTime() && at.getTime() <= period.to.getTime();
}

/** One value per day of the period, zero where nothing happened. */
export function fillDays(period: Period, values: ReadonlyMap<string, number>): { day: string; value: number }[] {
  return period.dayKeys.map((day) => ({ day, value: values.get(day) ?? 0 }));
}

/** part / whole, or null when there is nothing to divide by (shown as "—", never as 0%). */
export function share(part: number, whole: number): number | null {
  return whole === 0 ? null : part / whole;
}

export type SaleRow = { totalCents: number; vatCents: number; paidAt: Date | null };
export type RefundRow = { totalCents: number; refundedAt: Date };

export type SalesSummary = {
  orders: number;
  grossCents: number;
  vatCents: number;
  averageCents: number;
  refunds: number;
  refundsCents: number;
  netCents: number;
};

export function salesSummary(orders: readonly SaleRow[], refunds: readonly RefundRow[], period: Period): SalesSummary {
  const paid = orders.filter((order) => inPeriod(order.paidAt, period));
  const refunded = refunds.filter((refund) => inPeriod(refund.refundedAt, period));
  const grossCents = paid.reduce((sum, order) => sum + order.totalCents, 0);
  const refundsCents = refunded.reduce((sum, refund) => sum + refund.totalCents, 0);
  return {
    orders: paid.length,
    grossCents,
    vatCents: paid.reduce((sum, order) => sum + order.vatCents, 0),
    averageCents: paid.length === 0 ? 0 : Math.round(grossCents / paid.length),
    refunds: refunded.length,
    refundsCents,
    netCents: grossCents - refundsCents,
  };
}

/** Gross sales per UTC day of the period. */
export function salesByDay(orders: readonly SaleRow[], period: Period): { day: string; value: number }[] {
  const byDay = new Map<string, number>();
  for (const order of orders) {
    if (!inPeriod(order.paidAt, period)) continue;
    const key = dayKey(order.paidAt);
    byDay.set(key, (byDay.get(key) ?? 0) + order.totalCents);
  }
  return fillDays(period, byDay);
}

export type FunnelStep<K extends string> = { key: K; count: number; fromPrevious: number | null; fromFirst: number | null };

/** Each step with its share of the step before and of the first step. */
export function funnel<K extends string>(steps: readonly { key: K; count: number }[]): FunnelStep<K>[] {
  const first = steps[0]?.count ?? 0;
  return steps.map((step, index) => ({
    ...step,
    fromPrevious: index === 0 ? null : share(step.count, steps[index - 1]!.count),
    fromFirst: index === 0 ? null : share(step.count, first),
  }));
}

/** A return's stored reason is "code" or "code: note" (docs/adr/017); older ones may be free text. */
export function returnReasonCode(reason: string | null): ReturnReason | "unknown" {
  const code = reason?.split(":")[0]?.trim();
  return RETURN_REASONS.find((known) => known === code) ?? "unknown";
}
