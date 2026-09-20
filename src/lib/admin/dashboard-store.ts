/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Dashboard figures from the database: sales, orders, countries, products, funnel, returns, reviews, searches and stock.
 */

import type postgres from "postgres";

import { LOW_STOCK } from "@/lib/admin/catalog";
import { fillDays, funnel, returnReasonCode, share, type FunnelStep, type Period, type SalesSummary } from "@/lib/admin/metrics";
import type { OrderStatus } from "@/lib/commerce/order-state";
import type { ReturnReason } from "@/lib/commerce/returns";

/**
 * One query per panel, each following a definition in metrics.ts (docs/adr/018).
 * Sums come back from PostgreSQL as bigint strings and are turned into numbers
 * here; cents stay whole numbers throughout.
 */

type Sql = postgres.Sql;

export type FunnelKey = "carts" | "placed" | "paid" | "delivered";

export type DashboardOverview = {
  sales: SalesSummary;
  salesByDay: { day: string; value: number }[];
  statuses: { status: OrderStatus; count: number }[];
  countries: { country: string; orders: number; grossCents: number; vatCents: number }[];
  topProducts: { productId: string | null; slug: string | null; title: string; units: number; revenueCents: number }[];
  funnel: FunnelStep<FunnelKey>[];
  returns: { requested: number; deliveries: number; rate: number | null; reasons: { reason: ReturnReason | "unknown"; count: number }[] };
  reviews: { published: number; average: number | null; hidden: number };
  searches: {
    total: number;
    zeroResults: number;
    zeroShare: number | null;
    top: { query: string; count: number; averageResults: number }[];
    zero: { query: string; count: number }[];
  };
  lowStock: { count: number; items: { productId: string; title: string; sku: string; stock: number }[] };
};

const num = (value: string | number | null | undefined) => (value === null || value === undefined ? 0 : Number(value));

export function createDashboardStore(sql: Sql) {
  async function overview(period: Period, { locale = "en" }: { locale?: string } = {}): Promise<DashboardOverview> {
    const from = period.from.toISOString();
    const to = period.to.toISOString();
    const within = (column: postgres.PendingQuery<postgres.Row[]>) => sql`${column} >= ${from}::timestamptz AND ${column} <= ${to}::timestamptz`;

    const [sales, refunds, byDay, statuses, countries, products, funnelCounts, returnCounts, reasons, reviews, searchTotals, topSearches, zeroSearches, lowStock] =
      await Promise.all([
        sql<{ orders: number; gross: string; vat: string }[]>`
          SELECT count(*)::int AS orders, COALESCE(sum(total_cents), 0)::bigint AS gross, COALESCE(sum(vat_cents), 0)::bigint AS vat
          FROM orders o WHERE ${within(sql`o.paid_at`)}
        `,
        sql<{ refunds: number; cents: string }[]>`
          SELECT count(*)::int AS refunds, COALESCE(sum(o.total_cents), 0)::bigint AS cents
          FROM order_events e JOIN orders o ON o.id = e.order_id
          WHERE e.to_status = 'refunded' AND ${within(sql`e.created_at`)}
        `,
        sql<{ day: string; cents: string }[]>`
          SELECT to_char(o.paid_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, sum(o.total_cents)::bigint AS cents
          FROM orders o WHERE ${within(sql`o.paid_at`)} GROUP BY 1
        `,
        sql<{ status: OrderStatus; count: number }[]>`
          SELECT o.status, count(*)::int AS count FROM orders o WHERE ${within(sql`o.created_at`)} GROUP BY o.status ORDER BY count DESC, o.status
        `,
        sql<{ country: string; orders: number; gross: string; vat: string }[]>`
          SELECT o.vat_country AS country, count(*)::int AS orders, sum(o.total_cents)::bigint AS gross, sum(o.vat_cents)::bigint AS vat
          FROM orders o WHERE ${within(sql`o.paid_at`)} GROUP BY 1 ORDER BY sum(o.total_cents) DESC, 1
        `,
        sql<{ product_id: string | null; slug: string | null; title_en: string | null; title_el: string | null; snapshot: string; units: string; revenue: string }[]>`
          SELECT i.product_id, p.slug, p.title_en, p.title_el, max(i.title) AS snapshot,
                 sum(i.quantity)::bigint AS units, sum(i.line_cents)::bigint AS revenue
          FROM order_items i JOIN orders o ON o.id = i.order_id LEFT JOIN products p ON p.id = i.product_id
          WHERE ${within(sql`o.paid_at`)}
          GROUP BY i.product_id, p.slug, p.title_en, p.title_el
          ORDER BY sum(i.line_cents) DESC, sum(i.quantity) DESC, i.product_id LIMIT 8
        `,
        sql<{ carts: number; placed: number; paid: number; delivered: number }[]>`
          SELECT (SELECT count(*)::int FROM carts c WHERE ${within(sql`c.created_at`)}) AS carts,
                 count(*)::int AS placed,
                 count(*) FILTER (WHERE o.paid_at IS NOT NULL)::int AS paid,
                 count(*) FILTER (WHERE o.delivered_at IS NOT NULL)::int AS delivered
          FROM orders o WHERE ${within(sql`o.created_at`)}
        `,
        sql<{ requested: number; deliveries: number }[]>`
          SELECT count(*) FILTER (WHERE e.event = 'request_return')::int AS requested,
                 count(*) FILTER (WHERE e.event = 'deliver')::int AS deliveries
          FROM order_events e WHERE ${within(sql`e.created_at`)}
        `,
        sql<{ reason: string | null; count: number }[]>`
          SELECT e.reason, count(*)::int AS count FROM order_events e
          WHERE e.event = 'request_return' AND ${within(sql`e.created_at`)} GROUP BY e.reason
        `,
        sql<{ published: number; average: string | null; hidden: number }[]>`
          SELECT count(*) FILTER (WHERE r.status = 'published')::int AS published,
                 avg(r.rating) FILTER (WHERE r.status = 'published') AS average,
                 count(*) FILTER (WHERE r.status = 'hidden')::int AS hidden
          FROM reviews r WHERE ${within(sql`r.created_at`)}
        `,
        sql<{ total: number; zero: number }[]>`
          SELECT count(*)::int AS total, count(*) FILTER (WHERE s.results = 0)::int AS zero
          FROM search_events s WHERE ${within(sql`s.occurred_at`)}
        `,
        sql<{ query: string; count: number; average_results: string }[]>`
          SELECT s.query, count(*)::int AS count, avg(s.results) AS average_results
          FROM search_events s WHERE ${within(sql`s.occurred_at`)}
          GROUP BY s.query ORDER BY count(*) DESC, s.query LIMIT 10
        `,
        sql<{ query: string; count: number }[]>`
          SELECT s.query, count(*)::int AS count
          FROM search_events s WHERE s.results = 0 AND ${within(sql`s.occurred_at`)}
          GROUP BY s.query ORDER BY count(*) DESC, s.query LIMIT 10
        `,
        sql<{ product_id: string; title_en: string; title_el: string | null; sku: string; stock: number; total: number }[]>`
          SELECT p.id AS product_id, p.title_en, p.title_el, v.sku, v.stock, count(*) OVER ()::int AS total
          FROM product_variants v JOIN products p ON p.id = v.product_id
          WHERE p.status = 'active' AND v.stock <= ${LOW_STOCK}
          ORDER BY v.stock, p.title_en LIMIT 10
        `,
      ]);

    const orders = sales[0]!.orders;
    const grossCents = num(sales[0]!.gross);
    const refundsCents = num(refunds[0]!.cents);
    const title = (en: string | null, el: string | null, fallback: string) => (locale === "el" ? (el ?? en) : en) ?? fallback;

    // Reasons are grouped by their code; free-text reasons from older returns count as "unknown".
    const reasonCounts = new Map<ReturnReason | "unknown", number>();
    for (const row of reasons) reasonCounts.set(returnReasonCode(row.reason), (reasonCounts.get(returnReasonCode(row.reason)) ?? 0) + row.count);
    const returns = returnCounts[0]!;
    const counted = funnelCounts[0]!;
    const searches = searchTotals[0]!;

    return {
      sales: {
        orders,
        grossCents,
        vatCents: num(sales[0]!.vat),
        averageCents: orders === 0 ? 0 : Math.round(grossCents / orders),
        refunds: refunds[0]!.refunds,
        refundsCents,
        netCents: grossCents - refundsCents,
      },
      salesByDay: fillDays(period, new Map(byDay.map((row) => [row.day, num(row.cents)]))),
      statuses,
      countries: countries.map((row) => ({ country: row.country, orders: row.orders, grossCents: num(row.gross), vatCents: num(row.vat) })),
      topProducts: products.map((row) => ({
        productId: row.product_id,
        slug: row.slug,
        title: title(row.title_en, row.title_el, row.snapshot),
        units: num(row.units),
        revenueCents: num(row.revenue),
      })),
      funnel: funnel<FunnelKey>([
        { key: "carts", count: counted.carts },
        { key: "placed", count: counted.placed },
        { key: "paid", count: counted.paid },
        { key: "delivered", count: counted.delivered },
      ]),
      returns: {
        requested: returns.requested,
        deliveries: returns.deliveries,
        rate: share(returns.requested, returns.deliveries),
        reasons: [...reasonCounts].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason)),
      },
      reviews: { published: reviews[0]!.published, average: reviews[0]!.average === null ? null : Number(reviews[0]!.average), hidden: reviews[0]!.hidden },
      searches: {
        total: searches.total,
        zeroResults: searches.zero,
        zeroShare: share(searches.zero, searches.total),
        top: topSearches.map((row) => ({ query: row.query, count: row.count, averageResults: Number(row.average_results) })),
        zero: zeroSearches,
      },
      lowStock: {
        count: lowStock[0]?.total ?? 0,
        items: lowStock.map((row) => ({ productId: row.product_id, title: title(row.title_en, row.title_el, row.title_en), sku: row.sku, stock: row.stock })),
      },
    };
  }

  /**
   * What AI cost, by feature and by day (docs/adr/020). Demo-mode calls are
   * counted separately: they are free, and counting them as spend would hide
   * the real figure.
   */
  async function aiSpend(period: Period): Promise<{
    byFeature: { feature: string; calls: number; costMicros: number; inputTokens: number; outputTokens: number; unpriced: number }[];
    byDay: { day: string; value: number }[];
    totalMicros: number;
    calls: number;
    demoCalls: number;
    unpriced: number;
  }> {
    const from = period.from.toISOString();
    const to = period.to.toISOString();
    const [features, days, totals] = await Promise.all([
      sql<{ feature: string; calls: number; cost: string; input: string; output: string; unpriced: number }[]>`
        SELECT feature, count(*)::int AS calls, COALESCE(sum(cost_micros), 0)::bigint AS cost,
               COALESCE(sum(input_tokens), 0)::bigint AS input, COALESCE(sum(output_tokens), 0)::bigint AS output,
               count(*) FILTER (WHERE cost_micros IS NULL)::int AS unpriced
        FROM ai_usage WHERE provider <> 'demo' AND occurred_at >= ${from}::timestamptz AND occurred_at <= ${to}::timestamptz
        GROUP BY feature ORDER BY sum(cost_micros) DESC NULLS LAST, feature
      `,
      sql<{ day: string; cost: string }[]>`
        SELECT to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, COALESCE(sum(cost_micros), 0)::bigint AS cost
        FROM ai_usage WHERE provider <> 'demo' AND occurred_at >= ${from}::timestamptz AND occurred_at <= ${to}::timestamptz
        GROUP BY 1
      `,
      sql<{ total: string; calls: number; demo: number; unpriced: number }[]>`
        SELECT COALESCE(sum(cost_micros) FILTER (WHERE provider <> 'demo'), 0)::bigint AS total,
               count(*) FILTER (WHERE provider <> 'demo')::int AS calls,
               count(*) FILTER (WHERE provider = 'demo')::int AS demo,
               count(*) FILTER (WHERE provider <> 'demo' AND cost_micros IS NULL)::int AS unpriced
        FROM ai_usage WHERE occurred_at >= ${from}::timestamptz AND occurred_at <= ${to}::timestamptz
      `,
    ]);
    return {
      byFeature: features.map((row) => ({ feature: row.feature, calls: row.calls, costMicros: num(row.cost), inputTokens: num(row.input), outputTokens: num(row.output), unpriced: row.unpriced })),
      byDay: fillDays(period, new Map(days.map((row) => [row.day, num(row.cost)]))),
      totalMicros: num(totals[0]!.total),
      calls: totals[0]!.calls,
      demoCalls: totals[0]!.demo,
      unpriced: totals[0]!.unpriced,
    };
  }

  /** Orders placed in the period, for the CSV export: one row per order. */
  async function ordersForExport(period: Period) {
    return sql<{
      number: string;
      created_at: Date;
      paid_at: Date | null;
      status: OrderStatus;
      email: string;
      country: string;
      items: number;
      subtotal_cents: number;
      shipping_cents: number;
      vat_cents: number;
      total_cents: number;
      currency: string;
    }[]>`
      SELECT o.number, o.created_at, o.paid_at, o.status, o.email, o.vat_country AS country,
             (SELECT COALESCE(sum(i.quantity), 0)::int FROM order_items i WHERE i.order_id = o.id) AS items,
             o.subtotal_cents, o.shipping_cents, o.vat_cents, o.total_cents, o.currency
      FROM orders o
      WHERE o.created_at >= ${period.from.toISOString()}::timestamptz AND o.created_at <= ${period.to.toISOString()}::timestamptz
      ORDER BY o.created_at, o.number
    `;
  }

  /** Every variant with its stock, for the CSV export. */
  async function stockForExport() {
    return sql<{ sku: string; title_en: string; category: string; status: string; stock: number; price_cents: number }[]>`
      SELECT v.sku, p.title_en, c.slug AS category, p.status, v.stock, COALESCE(v.price_cents, p.price_cents) AS price_cents
      FROM product_variants v JOIN products p ON p.id = v.product_id JOIN categories c ON c.id = p.category_id
      ORDER BY c.slug, p.title_en, v.sku
    `;
  }

  return { overview, aiSpend, ordersForExport, stockForExport };
}

export type DashboardStore = ReturnType<typeof createDashboardStore>;
