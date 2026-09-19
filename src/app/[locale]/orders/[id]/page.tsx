/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Guest order page: status, lines, VAT breakdown and available order actions.
 */

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { OrderActions } from "@/components/commerce/order-actions";
import { ButtonLink } from "@/components/ui/button";
import { requireLocale } from "@/i18n/params";
import { localityLine } from "@/lib/commerce/address";
import { countryNames } from "@/lib/commerce/country-names";
import { isExportCountry } from "@/lib/commerce/exports";
import { formatMoney } from "@/lib/commerce/money";
import { availableEvents } from "@/lib/commerce/order-state";
import { formatVatRate } from "@/lib/commerce/vat";
import { commerce, PAYMENT_PROVIDER } from "@/lib/commerce/server";
import { cn } from "@/lib/ui/cn";

/**
 * A guest's order (Phase 5 step 4), reached through the link with its secret
 * token. A wrong id or token is a plain 404. The page never leaks the token:
 * no referrer is sent from it, and search engines are told to stay away.
 *
 * An unpaid order whose payment window has passed is expired on the way in, so
 * the page never offers to pay for pieces that are back on sale.
 */

export async function generateMetadata({ params }: PageProps<"/[locale]/orders/[id]">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "order" });
  return { title: t("title", { number: "" }).trim(), robots: { index: false, follow: false }, referrer: "no-referrer" };
}

export default async function OrderPage({ params, searchParams }: PageProps<"/[locale]/orders/[id]">) {
  const locale = await requireLocale(params);
  const { id } = await params;
  const token = (await searchParams).t;
  if (typeof token !== "string" || !/^[0-9a-f-]{36}$/.test(id)) notFound();

  const store = await commerce();
  if ((await store.orderForToken(id, token)) === null) notFound();
  await store.expireIfDue(id);
  const order = (await store.orderForToken(id, token))!;

  const t = await getTranslations("order");
  const tc = await getTranslations("cart");
  const dateTime = new Intl.DateTimeFormat(locale, { dateStyle: "long", timeStyle: "short" });
  const time = new Intl.DateTimeFormat(locale, { timeStyle: "short" });
  const now = new Date();
  const snapshot = { status: order.status, paid: order.paid, deliveredAt: order.deliveredAt };
  const canCancel = availableEvents(snapshot, "customer", now).includes("cancel");
  const canTestPay = order.status === "pending_payment" && order.paymentProvider === PAYMENT_PROVIDER;
  const released = order.events.some((event) => event.event === "payment_expired");
  const finished = order.status === "cancelled" || order.status === "refunded";

  return (
    <main className="mx-auto w-full max-w-[1100px] px-6 py-10 md:px-10 md:py-16" data-agent-id={`order:${order.id}`}>
      <p className="text-slate text-sm">{t("placedOn", { date: dateTime.format(order.createdAt) })}</p>
      <h1 className="font-display mt-2 text-3xl">{t("title", { number: order.number })}</h1>
      <p className="mt-4 flex flex-wrap items-center gap-3">
        <span
          data-agent-id="order:status"
          className={cn(
            "inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium",
            finished ? "bg-dusk/[0.06] text-slate" : order.status === "pending_payment" ? "bg-lumen/25 text-dusk" : "bg-success/10 text-success",
          )}
        >
          <span aria-hidden="true" className={cn("size-2 rounded-full", finished ? "bg-slate" : order.status === "pending_payment" ? "bg-lumen" : "bg-success")} />
          {t(`status.${order.status}`)}
        </span>
        {order.status === "pending_payment" ? <span className="text-slate text-sm">{t("payUntil", { time: time.format(order.paymentExpiresAt) })}</span> : null}
      </p>
      {order.status === "paid" && order.events.length === 2 ? <p className="mt-4 text-lg">{t("thanks")}</p> : null}
      {released ? <p className="text-dusk mt-4 max-w-[60ch]">{t("releasedNote")}</p> : null}

      <div className="mt-10 grid gap-12 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex flex-col gap-10">
          <OrderActions orderId={order.id} token={token} amount={formatMoney(order.total, locale)} canTestPay={canTestPay} canCancel={canCancel} paid={order.paid} />

          <section aria-labelledby="items">
            <h2 id="items" className="font-display text-xl">
              {t("items")}
            </h2>
            <ul className="border-hairline divide-hairline mt-4 divide-y border-y">
              {order.items.map((item) => (
                <li key={item.sku} className="flex items-baseline justify-between gap-4 py-4 text-sm">
                  <span className="min-w-0">
                    <span className="line-clamp-2">{item.title}</span>
                    <span className="text-slate tabular">
                      {item.quantity} × {formatMoney(item.unitPrice, locale)}
                    </span>
                  </span>
                  <span className="tabular shrink-0">{formatMoney(item.line, locale)}</span>
                </li>
              ))}
            </ul>
            <dl className="mt-4 flex flex-col gap-2 text-sm" data-agent-id="order:totals">
              <div className="flex justify-between gap-4">
                <dt>{tc("subtotal")}</dt>
                <dd className="tabular">{formatMoney(order.subtotal, locale)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt>{tc("shipping")}</dt>
                <dd className="tabular">{order.shipping.cents === 0 ? tc("shippingFree") : formatMoney(order.shipping, locale)}</dd>
              </div>
              <div className="flex justify-between gap-4 text-base font-medium">
                <dt>{tc("total")}</dt>
                <dd className="tabular">{formatMoney(order.total, locale)}</dd>
              </div>
            </dl>
            <p className="text-slate mt-1 text-xs" data-agent-id="order:vat">
              {order.vatRatePerMille === 0 && isExportCountry(order.vatCountry)
                ? // An export taxed on delivery: the shop charged no tax, and says who will.
                  t("vatExport", { country: countryNames(locale).inSentence(order.vatCountry) })
                : t("vatCharged", {
                    amount: formatMoney(order.vat, locale),
                    rate: formatVatRate(order.vatRatePerMille, locale),
                    country: countryNames(locale).inSentence(order.vatCountry),
                  })}
            </p>
          </section>

          <section aria-labelledby="history">
            <h2 id="history" className="font-display text-xl">
              {t("history")}
            </h2>
            <ol className="border-hairline mt-4 flex flex-col gap-4 border-l pl-5" data-agent-id="order:history">
              {order.events.map((event, index) => (
                <li key={`${event.event}-${index}`} className="relative text-sm">
                  <span aria-hidden="true" className="bg-dusk absolute top-1.5 -left-[1.4rem] size-2 rounded-full" />
                  <span className="font-medium">{t(`event.${event.event}` as "event.checkout")}</span>{" "}
                  <span className="text-slate">{t(`actor.${event.actor}`)}</span>
                  <time className="text-slate tabular block" dateTime={event.at.toISOString()}>
                    {dateTime.format(event.at)}
                  </time>
                </li>
              ))}
            </ol>
          </section>
        </div>

        <aside className="flex flex-col gap-6 text-sm">
          <div>
            <h2 className="text-slate text-xs font-medium tracking-wide">{t("deliveryTo")}</h2>
            <address className="mt-2 not-italic">
              {order.address.name}
              <br />
              {order.address.line1}
              {order.address.line2 === undefined ? null : (
                <>
                  <br />
                  {order.address.line2}
                </>
              )}
              <br />
              {localityLine(order.address)}
            </address>
          </div>
          <div>
            <h2 className="text-slate text-xs font-medium tracking-wide">{t("confirmationTo")}</h2>
            <p className="mt-2 break-all">{order.email}</p>
          </div>
          <p className="text-slate">{t("keepLink")}</p>
          <ButtonLink href="/c" variant="secondary">
            {t("continueShopping")}
          </ButtonLink>
        </aside>
      </div>
    </main>
  );
}
