/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * CSV exports for staff with dashboard access: the period's orders, every variant's stock, and the Concierge's and shelves' figures.
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
  if (kind !== "orders" && kind !== "stock" && kind !== "concierge" && kind !== "recommendations") return Response.json({ ok: false, reason: "not_found" }, { status: 404 });
  const period = periodFor(parsePeriod(new URL(request.url).searchParams.get("days") ?? undefined));
  const store = await dashboards();

  // The dashboards' tables as they are shown (docs/adr/034): counts only, nothing about any shopper.
  const rate = (value: number | null) => (value === null ? null : value.toFixed(4));
  const body =
    kind === "concierge"
      ? toCsv(
          ["tool", "runs", "refused_input", "approvals_asked", "approved", "declined", "undone"],
          (await store.conciergeFigures(period)).tools.map((tool) => [tool.tool, tool.runs, tool.errors, tool.approvalsAsked, tool.approved, tool.declined, tool.undone]),
        )
      : kind === "recommendations"
        ? toCsv(
            ["shelf", "seen", "opened", "click_through", "added_to_cart", "add_rate"],
            (await store.recoFigures(period)).shelves.map((shelf) => [shelf.shelf, shelf.impressions, shelf.clicks, rate(shelf.clickRate), shelf.adds, rate(shelf.addRate)]),
          )
        : kind === "orders"
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
  const name = kind === "stock" ? `vitrine-stock-${dayKey(period.to)}.csv` : `vitrine-${kind}-${dayKey(period.from)}-to-${dayKey(period.to)}.csv`;
  return new Response(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${name}"`,
      "cache-control": "no-store",
    },
  });
}
