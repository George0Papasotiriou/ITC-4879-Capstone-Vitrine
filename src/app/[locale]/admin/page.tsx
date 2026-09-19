/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The dashboards: sales, orders, countries, best sellers, the path from cart to delivery, returns, reviews, searches and stock.
 */

import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";

import { DayBars, Panel, ShareTable, Stat } from "@/components/admin/charts";
import { SmartLink } from "@/components/ui/smart-link";
import { requireLocale } from "@/i18n/params";
import { parsePeriod, periodFor, PERIODS } from "@/lib/admin/metrics";
import { dashboards } from "@/lib/admin/server";
import { requirePermission } from "@/lib/auth/session";
import { countryNames } from "@/lib/commerce/country-names";
import { formatMoney, money } from "@/lib/commerce/money";
import { cn } from "@/lib/ui/cn";

/**
 * For "reports:read" (merchandiser, admin). Every figure follows a definition
 * in src/lib/admin/metrics.ts, and the integration tests check each panel
 * against sums over the raw rows (docs/adr/018).
 */

export async function generateMetadata({ params }: PageProps<"/[locale]/admin">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "admin.dashboard" });
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function DashboardPage({ params, searchParams }: PageProps<"/[locale]/admin">) {
  const locale = await requireLocale(params);
  await requirePermission(locale, `/${locale}/admin`, "reports:read");
  const days = parsePeriod((await searchParams).days);
  const period = periodFor(days);
  const data = await (await dashboards()).overview(period, { locale });

  const t = await getTranslations("admin.dashboard");
  const o = await getTranslations("order");
  const r = await getTranslations("returns");
  const format = await getFormatter();
  const { name: countryName } = countryNames(locale);
  const euro = (cents: number) => formatMoney(money(cents), locale);
  const euroShort = (cents: number) => formatMoney(money(cents), locale, { hideDecimalsWhenWhole: true });
  const percent = (value: number | null) => (value === null ? t("none") : format.number(value, { style: "percent", maximumFractionDigits: 1 }));
  const dayLabel = (day: string) => format.dateTime(new Date(`${day}T12:00:00Z`), { day: "numeric", month: "short", timeZone: "UTC" });
  const exportHref = (kind: "orders" | "stock") => `/api/admin/export/${kind}?days=${days}`;

  return (
    <main className="mx-auto w-full max-w-[1440px] px-6 py-10 md:px-10 md:py-16" data-agent-id="admin:dashboard">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="font-display text-3xl">{t("title")}</h1>
          <p className="text-slate mt-3 max-w-[70ch]">{t("lede")}</p>
        </div>
        <div className="flex flex-col gap-3 lg:items-end">
          <nav aria-label={t("periodLabel")}>
            <ul className="flex gap-1">
              {PERIODS.map((option) => (
                <li key={option}>
                  <SmartLink
                    href={`/admin?days=${option}`}
                    aria-current={option === days ? "page" : undefined}
                    className={cn("rounded-plinth flex h-11 items-center px-4 text-sm whitespace-nowrap no-underline transition-colors", option === days ? "bg-dusk text-glass" : "text-dusk hover:bg-dusk/[0.05]")}
                    data-agent-id={`dashboard:period:${option}`}
                  >
                    {t(`periods.${option}`)}
                  </SmartLink>
                </li>
              ))}
            </ul>
          </nav>
          <p className="text-slate flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <span>{t("exports")}:</span>
            {/* Plain anchors: a file download, not a page the router should prefetch. */}
            <a href={exportHref("orders")} className="text-dusk underline underline-offset-4" data-agent-id="dashboard:export:orders">
              {t("exportOrders")}
            </a>
            <a href={exportHref("stock")} className="text-dusk underline underline-offset-4" data-agent-id="dashboard:export:stock">
              {t("exportStock")}
            </a>
          </p>
        </div>
      </div>

      <section aria-labelledby="sales" className="mt-10" data-agent-id="dashboard:sales">
        <h2 id="sales" className="sr-only">
          {t("sales.title")}
        </h2>
        <dl className="border-hairline bg-hairline grid gap-px overflow-hidden border sm:grid-cols-3 xl:grid-cols-6 [&>div]:bg-glass">
          <Stat label={t("sales.gross")} value={euro(data.sales.grossCents)} note={t("sales.grossNote")} agentId="dashboard:gross" />
          <Stat label={t("sales.net")} value={euro(data.sales.netCents)} agentId="dashboard:net" />
          <Stat label={t("sales.orders")} value={format.number(data.sales.orders)} agentId="dashboard:orders" />
          <Stat label={t("sales.average")} value={data.sales.orders === 0 ? t("none") : euro(data.sales.averageCents)} agentId="dashboard:average" />
          <Stat label={t("sales.refunds")} value={euro(data.sales.refundsCents)} note={t("sales.refundsNote", { count: data.sales.refunds })} agentId="dashboard:refunds" />
          <Stat label={t("sales.vat")} value={euro(data.sales.vatCents)} agentId="dashboard:vat" />
        </dl>
      </section>

      <Panel id="by-day" title={t("byDay.title")} className="mt-12">
        <DayBars
          data={data.salesByDay}
          label={t("byDay.chartLabel", { max: euroShort(Math.max(0, ...data.salesByDay.map((entry) => entry.value))) })}
          formatValue={euroShort}
          formatDay={dayLabel}
          tableCaption={t("byDay.title")}
          columns={[t("byDay.day"), t("byDay.value")]}
        />
      </Panel>

      <div className="mt-12 grid gap-x-14 gap-y-12 lg:grid-cols-2">
        <Panel id="statuses" title={t("statuses.title")}>
          {data.statuses.length === 0 ? (
            <p className="text-slate text-sm">{t("empty")}</p>
          ) : (
            <ShareTable
              caption={t("statuses.title")}
              columns={[t("statuses.status"), t("statuses.count")]}
              rows={data.statuses.map((row) => ({ key: row.status, label: o(`status.${row.status}`), value: row.count, cells: [format.number(row.count)] }))}
            />
          )}
        </Panel>

        <Panel id="funnel" title={t("funnel.title")} lede={t("funnel.lede")}>
          <ShareTable
            caption={t("funnel.title")}
            columns={[t("funnel.step"), t("funnel.count"), t("funnel.share")]}
            agentId="dashboard:funnel-table"
            rows={data.funnel.map((step) => ({
              key: step.key,
              label: t(`funnel.steps.${step.key}`),
              value: step.count,
              cells: [format.number(step.count), step.fromPrevious === null ? t("none") : percent(step.fromPrevious)],
            }))}
          />
        </Panel>

        <Panel id="countries" title={t("countries.title")}>
          {data.countries.length === 0 ? (
            <p className="text-slate text-sm">{t("empty")}</p>
          ) : (
            <ShareTable
              caption={t("countries.title")}
              columns={[t("countries.country"), t("countries.orders"), t("countries.sales"), t("countries.vat")]}
              rows={data.countries.map((row) => ({
                key: row.country,
                label: countryName(row.country),
                value: row.grossCents,
                cells: [format.number(row.orders), euro(row.grossCents), euro(row.vatCents)],
              }))}
            />
          )}
        </Panel>

        <Panel id="products" title={t("products.title")}>
          {data.topProducts.length === 0 ? (
            <p className="text-slate text-sm">{t("empty")}</p>
          ) : (
            <ShareTable
              caption={t("products.title")}
              columns={[t("products.product"), t("products.units"), t("products.sales")]}
              rows={data.topProducts.map((row) => ({
                key: row.productId ?? row.title,
                label:
                  row.slug === null ? (
                    row.title
                  ) : (
                    <SmartLink href={`/p/${row.slug}`} className="underline underline-offset-4">
                      {row.title}
                    </SmartLink>
                  ),
                value: row.revenueCents,
                cells: [format.number(row.units), euro(row.revenueCents)],
              }))}
            />
          )}
        </Panel>

        <Panel id="returns" title={t("returns.title")}>
          <dl className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <dt className="text-slate">{t("returns.requested")}</dt>
              <dd className="font-display tabular text-xl">{format.number(data.returns.requested)}</dd>
            </div>
            <div>
              <dt className="text-slate">{t("returns.deliveries")}</dt>
              <dd className="font-display tabular text-xl">{format.number(data.returns.deliveries)}</dd>
            </div>
            <div>
              <dt className="text-slate">{t("returns.rate")}</dt>
              <dd className="font-display tabular text-xl" data-agent-id="dashboard:return-rate">
                {percent(data.returns.rate)}
              </dd>
            </div>
          </dl>
          {data.returns.reasons.length === 0 ? null : (
            <ShareTable
              caption={t("returns.title")}
              columns={[t("returns.reason"), t("returns.count")]}
              rows={data.returns.reasons.map((row) => ({
                key: row.reason,
                label: row.reason === "unknown" ? t("returns.unknown") : r(`reasons.${row.reason}`),
                value: row.count,
                cells: [format.number(row.count)],
              }))}
            />
          )}
        </Panel>

        <Panel id="reviews" title={t("reviews.title")}>
          <dl className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <dt className="text-slate">{t("reviews.published")}</dt>
              <dd className="font-display tabular text-xl">{format.number(data.reviews.published)}</dd>
            </div>
            <div>
              <dt className="text-slate">{t("reviews.average")}</dt>
              <dd className="font-display tabular text-xl">{data.reviews.average === null ? t("none") : format.number(data.reviews.average, { maximumFractionDigits: 1, minimumFractionDigits: 1 })}</dd>
            </div>
            <div>
              <dt className="text-slate">{t("reviews.hidden")}</dt>
              <dd className="font-display tabular text-xl">{format.number(data.reviews.hidden)}</dd>
            </div>
          </dl>
        </Panel>

        <Panel id="searches" title={t("searches.title")} lede={t("searches.privacy")} className="lg:col-span-2">
          <dl className="grid max-w-md grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-slate">{t("searches.total")}</dt>
              <dd className="font-display tabular text-xl">{format.number(data.searches.total)}</dd>
            </div>
            <div>
              <dt className="text-slate">{t("searches.zeroShare")}</dt>
              <dd className="font-display tabular text-xl" data-agent-id="dashboard:zero-share">
                {percent(data.searches.zeroShare)}
              </dd>
            </div>
          </dl>
          <div className="grid gap-10 lg:grid-cols-2">
            <div>
              <h3 className="mb-2 font-medium">{t("searches.top")}</h3>
              {data.searches.top.length === 0 ? (
                <p className="text-slate text-sm">{t("empty")}</p>
              ) : (
                <ShareTable
                  caption={t("searches.top")}
                  columns={[t("searches.query"), t("searches.count"), t("searches.averageResults")]}
                  agentId="dashboard:top-searches"
                  rows={data.searches.top.map((row) => ({
                    key: row.query,
                    label: <span lang={locale}>{row.query}</span>,
                    value: row.count,
                    cells: [format.number(row.count), format.number(row.averageResults, { maximumFractionDigits: 1 })],
                  }))}
                />
              )}
            </div>
            <div>
              <h3 className="mb-2 font-medium">{t("searches.zero")}</h3>
              {data.searches.zero.length === 0 ? (
                <p className="text-slate text-sm">{t("empty")}</p>
              ) : (
                <ShareTable
                  caption={t("searches.zero")}
                  columns={[t("searches.query"), t("searches.count")]}
                  agentId="dashboard:zero-searches"
                  rows={data.searches.zero.map((row) => ({ key: row.query, label: row.query, value: row.count, cells: [format.number(row.count)] }))}
                />
              )}
            </div>
          </div>
        </Panel>

        <Panel id="low-stock" title={t("lowStock.title")} className="lg:col-span-2">
          {data.lowStock.items.length === 0 ? (
            <p className="text-slate text-sm">{t("lowStock.none")}</p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[32rem] text-sm" data-agent-id="dashboard:low-stock-table">
                  <thead>
                    <tr className="text-slate text-left">
                      <th scope="col" className="py-2 pr-4 font-medium">{t("lowStock.product")}</th>
                      <th scope="col" className="py-2 pr-4 font-medium">{t("lowStock.sku")}</th>
                      <th scope="col" className="py-2 text-right font-medium">{t("lowStock.stock")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.lowStock.items.map((item) => (
                      <tr key={item.sku} className="border-hairline border-t">
                        <th scope="row" className="py-2 pr-4 text-left font-normal">
                          <SmartLink href={`/staff/products/${item.productId}`} className="underline underline-offset-4">
                            {item.title}
                          </SmartLink>
                        </th>
                        <td className="tabular py-2 pr-4">{item.sku}</td>
                        <td className="tabular text-danger py-2 text-right font-medium">{item.stock}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <SmartLink href="/staff/products?view=low" className="text-sm underline underline-offset-4">
                {t("lowStock.viewAll")} ({data.lowStock.count})
              </SmartLink>
            </>
          )}
        </Panel>
      </div>
    </main>
  );
}
