/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Shopping cart page: lines, quantities and server-computed totals.
 */

import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { CartLineControls } from "@/components/commerce/cart-line-controls";
import { ProductImage } from "@/components/commerce/product-image";
import { ButtonLink } from "@/components/ui/button";
import { Price } from "@/components/ui/price";
import { SmartLink } from "@/components/ui/smart-link";
import { EmptyState } from "@/components/ui/states";
import { requireLocale } from "@/i18n/params";
import { formatMoney } from "@/lib/commerce/money";
import { RegionNote } from "@/components/commerce/region-control";
import { currentRegion } from "@/lib/commerce/region";
import { commerce, currentCartId, lastOrder, orderPath } from "@/lib/commerce/server";
import { formatVatRate } from "@/lib/commerce/vat";

/**
 * The cart (Phase 5 step 2). Rendered on the server from the database for every
 * request: current prices, current stock, totals from the pricing module. A
 * line that sold out or was withdrawn stays visible, marked, and out of the
 * totals, rather than silently disappearing.
 */

export async function generateMetadata({ params }: PageProps<"/[locale]/cart">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "cart" });
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function CartPage({ params }: PageProps<"/[locale]/cart">) {
  const locale = await requireLocale(params);
  const t = await getTranslations("cart");
  const home = await getTranslations("home");

  const store = await commerce();
  const region = await currentRegion();
  const view = await store.viewCart(await currentCartId(), locale, { country: region.country });
  const countryName = new Intl.DisplayNames([locale], { type: "region" }).of(region.country) ?? region.country;
  const previous = await lastOrder();

  if (view.lines.length === 0) {
    return (
      <main className="mx-auto w-full max-w-[1440px] px-6 py-10 md:px-10 md:py-16">
        <h1 className="font-display text-3xl">{t("title")}</h1>
        <EmptyState
          title={t("empty")}
          description={t("emptyDescription")}
          action={
            <div className="flex flex-wrap justify-center gap-3">
              <ButtonLink href="/c" variant="secondary">
                {home("browseCollection")}
              </ButtonLink>
              {previous === null ? null : (
                <ButtonLink href={orderPath(previous.orderId, previous.token)} variant="tertiary">
                  {t("lastOrder")}
                </ButtonLink>
              )}
            </div>
          }
        />
      </main>
    );
  }

  const { totals } = view;
  const blocked = view.lines.some((line) => !line.available);

  return (
    <main className="mx-auto w-full max-w-[1440px] px-6 py-10 md:px-10 md:py-16">
      <h1 className="font-display text-3xl">{t("title")}</h1>
      <p className="text-slate tabular mt-2">{t("items", { count: totals.itemCount })}</p>

      <div className="mt-10 grid gap-12 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
        <ul className="border-hairline divide-hairline divide-y border-y" data-agent-id="cart:lines">
          {view.lines.map((line) => (
            <li key={line.variantId} className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-5 py-6 md:grid-cols-[7rem_minmax(0,1fr)_auto]" data-agent-id={`cart-line:${line.variantId}`}>
              <SmartLink href={`/p/${line.slug}`} className="bg-plinth rounded-plinth relative block aspect-square overflow-hidden" tabIndex={-1} aria-hidden="true">
                {line.image === null ? null : (
                  <span className="on-plinth absolute inset-2 block">
                    <ProductImage image={line.image} loading="lazy" sizes="112px" />
                  </span>
                )}
              </SmartLink>
              <div className="flex min-w-0 flex-col gap-2">
                <SmartLink href={`/p/${line.slug}`} className="line-clamp-2 no-underline hover:underline underline-offset-4">
                  {line.title}
                </SmartLink>
                <span className="text-slate tabular text-sm">{t("unitPrice", { price: formatMoney(line.unitPrice, locale) })}</span>
                {!line.available ? (
                  <span className="text-danger text-sm">{t("unavailable")}</span>
                ) : line.stock <= 5 ? (
                  <span className="text-dusk text-sm">{t("onlyLeft", { count: line.stock })}</span>
                ) : null}
              </div>
              <div className="col-start-2 flex flex-wrap items-center justify-between gap-3 md:col-start-3 md:row-start-1 md:flex-col md:items-end md:justify-start">
                <Price amount={{ cents: line.unitPrice.cents * line.quantity, currency: line.unitPrice.currency }} locale={locale} size="sm" />
                <CartLineControls variantId={line.variantId} title={line.title} quantity={line.quantity} stock={line.stock} available={line.available} />
              </div>
            </li>
          ))}
        </ul>

        <aside aria-labelledby="summary-title" className="bg-plinth/60 rounded-plinth flex flex-col gap-5 p-6 lg:sticky lg:top-24">
          <h2 id="summary-title" className="font-display text-xl">
            {t("summary")}
          </h2>
          <dl className="flex flex-col gap-3 text-sm" data-agent-id="cart:totals">
            <div className="flex justify-between gap-4">
              <dt>{t("subtotal")}</dt>
              <dd className="tabular">{formatMoney(totals.subtotal, locale)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt>{t("shipping")}</dt>
              <dd className="tabular">{totals.shipping.cents === 0 ? t("shippingFree") : formatMoney(totals.shipping, locale)}</dd>
            </div>
            <div className="border-hairline flex justify-between gap-4 border-t pt-3 text-base font-medium">
              <dt>{t("total")}</dt>
              <dd className="tabular">{formatMoney(totals.total, locale)}</dd>
            </div>
          </dl>
          {totals.deliverable ? (
            <p className="text-slate -mt-2 text-xs" data-agent-id="cart:vat">
              {t("vatIncludedCountry", { amount: formatMoney(totals.vat, locale), rate: formatVatRate(totals.vatRatePerMille, locale), country: countryName })}
            </p>
          ) : (
            <p className="text-dusk text-sm">{t("noDelivery")}</p>
          )}
          {totals.deliverable ? (
            <p className="text-slate text-sm">
              {totals.freeShippingRemaining === null ? t("freeShippingReached") : t("freeShippingRemaining", { amount: formatMoney(totals.freeShippingRemaining, locale) })}
            </p>
          ) : null}
          <RegionNote country={region.country} className="text-slate text-xs" />
          {blocked ? (
            <p className="text-danger text-sm">{t("unavailable")}</p>
          ) : (
            <ButtonLink href="/checkout" data-agent-id="action:checkout">
              {t("checkout")}
            </ButtonLink>
          )}
        </aside>
      </div>
    </main>
  );
}
