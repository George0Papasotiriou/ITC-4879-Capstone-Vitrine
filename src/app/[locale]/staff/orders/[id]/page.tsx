/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * One order at the order desk: customer, address, lines, the next steps staff may take, and its full history.
 */

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";

import { OrderStatusPill } from "@/components/commerce/order-status-pill";
import { OrderDeskActions } from "@/components/staff/order-desk-actions";
import { SmartLink } from "@/components/ui/smart-link";
import { requireLocale } from "@/i18n/params";
import { requirePermission } from "@/lib/auth/session";
import { localityLine } from "@/lib/commerce/address";
import { countryNames } from "@/lib/commerce/country-names";
import { staffActions } from "@/lib/commerce/desk";
import { formatMoney } from "@/lib/commerce/money";
import { RETURN_REASONS } from "@/lib/commerce/returns";
import { commerce } from "@/lib/commerce/server";

export async function generateMetadata({ params }: PageProps<"/[locale]/staff/orders/[id]">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "staff" });
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function DeskOrderPage({ params }: PageProps<"/[locale]/staff/orders/[id]">) {
  const locale = await requireLocale(params);
  const { id } = await params;
  await requirePermission(locale, `/${locale}/staff/orders/${id}`, "orders:manage");
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();

  const store = await commerce();
  await store.expireIfDue(id);
  const order = await store.readOrder(id);
  if (order === null) notFound();

  const t = await getTranslations("staff");
  const o = await getTranslations("order");
  const tc = await getTranslations("cart");
  const format = await getFormatter();
  const { name: countryName } = countryNames(locale);
  const actions = staffActions({ status: order.status, paid: order.paid, deliveredAt: order.deliveredAt }, new Date());
  const statusLabel = o(`status.${order.status}`);
  const rt = await getTranslations("returns");
  /** A return's reason is stored as "code: note"; staff read it in words. */
  const reasonText = (event: string, reason: string) => {
    if (event !== "request_return") return reason;
    const [code, ...note] = reason.split(": ");
    const known = RETURN_REASONS.find((candidate) => candidate === code);
    return known === undefined ? reason : [rt(`reasons.${known}`), ...(note.length > 0 ? [note.join(": ")] : [])].join(" — ");
  };

  return (
    <main className="mx-auto w-full max-w-[1100px] px-6 py-10 md:px-10 md:py-16" data-agent-id={`staff:order-detail:${order.number}`}>
      <SmartLink href="/staff/orders" className="text-sm underline underline-offset-4">
        {t("back")}
      </SmartLink>
      <p className="text-slate mt-6 text-sm">{o("placedOn", { date: format.dateTime(order.createdAt, { dateStyle: "long", timeStyle: "short" }) })}</p>
      <div className="mt-2 flex flex-wrap items-center gap-4">
        <h1 className="font-display text-3xl">{o("title", { number: order.number })}</h1>
        <span data-agent-id="staff:status">
          <OrderStatusPill status={order.status} label={statusLabel} />
        </span>
      </div>

      <div className="mt-10 grid gap-12 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex flex-col gap-10">
          <section aria-labelledby="next-step" className="bg-plinth/60 rounded-plinth flex flex-col gap-4 p-6">
            <h2 id="next-step" className="font-display text-xl">
              {t("nextStep")}
            </h2>
            {actions.length === 0 ? (
              <p className="text-sm">{t("nothingToDo", { status: statusLabel.toLowerCase() })}</p>
            ) : (
              <OrderDeskActions orderId={order.id} number={order.number} actions={actions} />
            )}
          </section>

          <section aria-labelledby="items">
            <h2 id="items" className="font-display text-xl">
              {o("items")}
            </h2>
            <ul className="border-hairline divide-hairline mt-4 divide-y border-y">
              {order.items.map((item) => (
                <li key={item.sku} className="flex items-baseline justify-between gap-4 py-4 text-sm">
                  <span className="min-w-0">
                    <span className="line-clamp-2">{item.title}</span>
                    <span className="text-slate tabular">
                      {item.sku} · {item.quantity} × {formatMoney(item.unitPrice, locale)}
                    </span>
                  </span>
                  <span className="tabular shrink-0">{formatMoney(item.line, locale)}</span>
                </li>
              ))}
            </ul>
            <dl className="mt-4 flex flex-col gap-2 text-sm">
              <div className="flex justify-between gap-4">
                <dt>{tc("subtotal")}</dt>
                <dd className="tabular">{formatMoney(order.subtotal, locale)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt>{tc("shipping")}</dt>
                <dd className="tabular">{formatMoney(order.shipping, locale)}</dd>
              </div>
              <div className="border-hairline flex justify-between gap-4 border-t pt-2 font-medium">
                <dt>{tc("total")}</dt>
                <dd className="tabular">{formatMoney(order.total, locale)}</dd>
              </div>
            </dl>
          </section>

          <section aria-labelledby="history">
            <h2 id="history" className="font-display text-xl">
              {t("history")}
            </h2>
            <ol className="mt-4 flex flex-col gap-3 text-sm" data-agent-id="staff:history">
              {order.events.map((event, index) => (
                <li key={index} className="flex flex-col gap-0.5">
                  <span>
                    <span className="font-medium">{o(`event.${event.event}`)}</span>
                    <span className="text-slate">
                      {" · "}
                      {event.actorName === null ? t(`actors.${event.actor}`) : t("by", { name: event.actorName })}
                      {" · "}
                      {format.dateTime(event.at, { dateStyle: "medium", timeStyle: "short" })}
                    </span>
                  </span>
                  {event.reason !== null ? <span className="text-slate italic">“{reasonText(event.event, event.reason)}”</span> : null}
                </li>
              ))}
            </ol>
          </section>
        </div>

        <aside className="flex flex-col gap-8 text-sm">
          <section aria-labelledby="customer">
            <h2 id="customer" className="font-display text-lg">
              {t("customer")}
            </h2>
            <p className="mt-2">{order.address.name}</p>
            <p className="text-slate">
              <a href={`mailto:${order.email}`} className="underline underline-offset-4">
                {order.email}
              </a>
            </p>
            {order.address.phone !== undefined && order.address.phone !== "" ? <p className="text-slate tabular">{order.address.phone}</p> : null}
          </section>
          <section aria-labelledby="deliver-to">
            <h2 id="deliver-to" className="font-display text-lg">
              {t("deliverTo")}
            </h2>
            <address className="mt-2 not-italic">
              {order.address.line1}
              <br />
              {order.address.line2 !== undefined && order.address.line2 !== "" ? (
                <>
                  {order.address.line2}
                  <br />
                </>
              ) : null}
              {localityLine(order.address)}
              <br />
              {countryName(order.address.country)}
            </address>
          </section>
        </aside>
      </div>
    </main>
  );
}
