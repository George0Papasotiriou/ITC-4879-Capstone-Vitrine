/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * CSV exports for staff with dashboard access: the period's orders, or every variant's stock.
 */

import { centsToDecimal, toCsv } from "@/lib/admin/csv";
import { dayKey, parsePeriod, periodFor } from "@/lib/admin/metrics";
import { dashboards } from "@/lib/admin/server";
import { authorize } from "@/lib/auth/session";
import { logger } from "@/lib/log";

/**
 * For "reports:read". Customer emails are in the orders file, so it is only
 * for people who already see them on the order desk or the dashboards, it is
 * never cached, and every download is logged with who took it (docs/adr/018).
 */

export const runtime = "nodejs";

export async function GET(request: Request, { params }: RouteContext<"/api/admin/export/[kind]">): Promise<Response> {
  const access = await authorize("reports:read");
  if (!access.ok) return Response.json({ ok: false, reason: access.status === 401 ? "sign_in" : "forbidden" }, { status: access.status });

  const { kind } = await params;
  if (kind !== "orders" && kind !== "stock") return Response.json({ ok: false, reason: "not_found" }, { status: 404 });
  const period = periodFor(parsePeriod(new URL(request.url).searchParams.get("days") ?? undefined));
  const store = await dashboards();

  const body =
    kind === "orders"
      ? toCsv(
          ["number", "placed_at", "paid_at", "status", "email", "country", "items", "subtotal", "shipping", "vat", "total", "currency"],
          (await store.ordersForExport(period)).map((row) => [
            row.number,
            new Date(row.created_at),
            row.paid_at === null ? null : new Date(row.paid_at),
            row.status,
            row.email,
            row.country,
            row.items,
            centsToDecimal(row.subtotal_cents),
            centsToDecimal(row.shipping_cents),
            centsToDecimal(row.vat_cents),
            centsToDecimal(row.total_cents),
            row.currency,
          ]),
        )
      : toCsv(
          ["sku", "product", "category", "status", "stock", "price"],
          (await store.stockForExport()).map((row) => [row.sku, row.title_en, row.category, row.status, row.stock, centsToDecimal(row.price_cents)]),
        );

  logger.info({ export: kind, days: period.days, staff: access.user.id }, "CSV export");
  const name = kind === "orders" ? `vitrine-orders-${dayKey(period.from)}-to-${dayKey(period.to)}.csv` : `vitrine-stock-${dayKey(period.to)}.csv`;
  return new Response(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${name}"`,
      "cache-control": "no-store",
    },
  });
}
