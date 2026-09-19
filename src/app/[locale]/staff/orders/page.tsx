/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Staff order desk: orders in queues by their next step, with search by order number or email.
 */

import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";

import { OrderStatusPill } from "@/components/commerce/order-status-pill";
import { Button } from "@/components/ui/button";
import { SmartLink } from "@/components/ui/smart-link";
import { requireLocale } from "@/i18n/params";
import { requirePermission } from "@/lib/auth/session";
import { countryNames } from "@/lib/commerce/country-names";
import { DESK_STATUSES, DESK_VIEWS, isDeskView, oldestFirst, viewCounts } from "@/lib/commerce/desk";
import { formatMoney } from "@/lib/commerce/money";
import { commerce } from "@/lib/commerce/server";
import { cn } from "@/lib/ui/cn";

/**
 * Only for "orders:manage" (support and admin); anyone else gets a 404, so the
 * page does not even confirm it exists (src/lib/auth/session.ts). The search
 * is a GET so a view can be bookmarked and shared between staff; it is meant
 * for order numbers, and an email typed into it stays inside staff pages.
 */

export async function generateMetadata({ params }: PageProps<"/[locale]/staff/orders">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "staff" });
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function OrderDeskPage({ params, searchParams }: PageProps<"/[locale]/staff/orders">) {
  const locale = await requireLocale(params);
  const query = await searchParams;
  const view = isDeskView(typeof query.view === "string" ? query.view : undefined) ? (query.view as (typeof DESK_VIEWS)[number]) : "pack";
  const search = typeof query.q === "string" ? query.q.trim().slice(0, 100) : "";
  await requirePermission(locale, `/${locale}/staff/orders`, "orders:manage");

  const t = await getTranslations("staff");
  const o = await getTranslations("order");
  const format = await getFormatter();
  const { name: countryName } = countryNames(locale);
  const store = await commerce();
  const [orders, counts] = await Promise.all([
    store.deskOrders({ statuses: search === "" ? DESK_STATUSES[view] : null, query: search, oldestFirst: search === "" && oldestFirst(view) }),
    store.statusCounts(),
  ]);
  const tally = viewCounts(counts);

  return (
    <main className="mx-auto w-full max-w-[1440px] px-6 py-10 md:px-10 md:py-16" data-agent-id="staff:desk">
      <h1 className="font-display text-3xl">{t("title")}</h1>
      <p className="text-slate mt-3 max-w-[70ch]">{t("lede")}</p>

      <div className="mt-8 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <nav aria-label={t("viewsLabel")} className="-mx-1 overflow-x-auto">
          <ul className="flex gap-1 px-1">
            {DESK_VIEWS.map((option) => {
              const current = search === "" && option === view;
              return (
                <li key={option}>
                  <SmartLink
                    href={`/staff/orders?view=${option}`}
                    aria-current={current ? "page" : undefined}
                    className={cn(
                      "rounded-plinth flex h-11 items-center gap-2 px-4 text-sm whitespace-nowrap no-underline transition-colors",
                      current ? "bg-dusk text-glass" : "text-dusk hover:bg-dusk/[0.05]",
                    )}
                    data-agent-id={`staff:view:${option}`}
                  >
                    {t(`views.${option}`)}
                    <span className={cn("tabular text-xs", current ? "text-glass/80" : "text-slate")}>{tally[option]}</span>
                  </SmartLink>
                </li>
              );
            })}
          </ul>
        </nav>
        <form method="get" role="search" className="flex items-end gap-2">
          <input type="hidden" name="view" value={view} />
          <label className="flex flex-col gap-2 text-sm font-medium">
            {t("search")}
            <input
              name="q"
              type="search"
              defaultValue={search}
              maxLength={100}
              autoComplete="off"
              className="border-hairline text-dusk rounded-plinth hover:border-dusk/35 h-11 w-64 border bg-white px-3 font-normal transition-colors"
              data-agent-id="staff:search"
            />
          </label>
          <Button type="submit" variant="secondary">
            {t("searchAction")}
          </Button>
        </form>
      </div>

      {orders.length === 0 ? (
        <p className="text-slate mt-10">{search === "" ? t("empty") : t("emptySearch", { query: search })}</p>
      ) : (
        <div className="border-hairline mt-8 overflow-x-auto border-t">
          <table className="w-full min-w-[56rem] border-collapse text-sm" data-agent-id="staff:orders">
            <thead>
              <tr className="text-slate text-left">
                <th scope="col" className="py-3 pr-4 font-medium">{t("columns.number")}</th>
                <th scope="col" className="py-3 pr-4 font-medium">{t("columns.placed")}</th>
                <th scope="col" className="py-3 pr-4 font-medium">{t("columns.customer")}</th>
                <th scope="col" className="py-3 pr-4 font-medium">{t("columns.destination")}</th>
                <th scope="col" className="py-3 pr-4 text-right font-medium">{t("columns.items")}</th>
                <th scope="col" className="py-3 pr-4 text-right font-medium">{t("columns.total")}</th>
                <th scope="col" className="py-3 font-medium">{t("columns.status")}</th>
              </tr>
            </thead>
            <tbody className="divide-hairline divide-y">
              {orders.map((order) => (
                <tr key={order.id} className="hover:bg-dusk/[0.02] border-hairline border-t" data-agent-id={`staff:order:${order.number}`}>
                  <th scope="row" className="py-3 pr-4 text-left font-medium">
                    <SmartLink href={`/staff/orders/${order.id}`} className="underline underline-offset-4">
                      {order.number}
                    </SmartLink>
                  </th>
                  <td className="tabular py-3 pr-4 whitespace-nowrap">{format.dateTime(order.createdAt, { dateStyle: "medium", timeStyle: "short" })}</td>
                  <td className="py-3 pr-4">
                    <span className="block">{order.name}</span>
                    <span className="text-slate block">{order.email}</span>
                  </td>
                  <td className="py-3 pr-4">{order.country === "" ? "—" : countryName(order.country)}</td>
                  <td className="tabular py-3 pr-4 text-right">{order.itemCount}</td>
                  <td className="tabular py-3 pr-4 text-right whitespace-nowrap">{formatMoney(order.total, locale)}</td>
                  <td className="py-3">
                    <OrderStatusPill status={order.status} label={o(`status.${order.status}`)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
