/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Checkout page: prepares the cart, delivery quotes per country and the checkout form.
 */

import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { uuidv7 } from "uuidv7";

import { CheckoutForm, type CountryQuote } from "@/components/commerce/checkout-form";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";
import { requireLocale } from "@/i18n/params";
import { priceCart, shippingMethod } from "@/lib/commerce/pricing";
import { currentRegion } from "@/lib/commerce/region";
import { currentUser } from "@/lib/auth/session";
import { commerce, currentCartId } from "@/lib/commerce/server";
import { DELIVERY_COUNTRIES, isDeliveryCountry, type DeliveryCountry } from "@/lib/commerce/exports";
import { BASE_COUNTRY } from "@/lib/commerce/vat";

/**
 * Checkout (Phase 5 step 3, docs/adr/013).
 *
 * VAT and delivery follow the delivery address, so the server prices the cart
 * for every country the shop delivers to and both delivery methods: 74 small
 * quotes (27 EU countries and 10 exports, docs/adr/015), computed
 * here from database prices, which let the form update the summary the moment
 * the country or method changes, with no arithmetic in the browser. The order
 * itself is priced again inside the order transaction. The delivery country
 * starts as the country prices are shown for, when the shop delivers there.
 */

export async function generateMetadata({ params }: PageProps<"/[locale]/checkout">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "checkout" });
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function CheckoutPage({ params }: PageProps<"/[locale]/checkout">) {
  const locale = await requireLocale(params);
  const t = await getTranslations("checkout");
  const tc = await getTranslations("cart");

  const store = await commerce();
  const region = await currentRegion();
  const view = await store.viewCart(await currentCartId(), locale, { country: region.country });
  const lines = view.lines.filter((line) => line.available).map((line) => ({ unitCents: line.baseUnitCents, quantity: Math.min(line.quantity, line.stock) }));

  if (lines.length === 0 || view.lines.some((line) => !line.available)) {
    return (
      <main className="mx-auto w-full max-w-[1440px] px-6 py-10 md:px-10 md:py-16">
        <h1 className="font-display text-3xl">{t("title")}</h1>
        <EmptyState
          title={lines.length === 0 ? tc("empty") : tc("unavailable")}
          description={lines.length === 0 ? tc("emptyDescription") : t("errorUnavailable")}
          action={
            <ButtonLink href={lines.length === 0 ? "/c" : "/cart"} variant="secondary">
              {lines.length === 0 ? tc("keepShopping") : t("backToCart")}
            </ButtonLink>
          }
        />
      </main>
    );
  }

  const quotes = Object.fromEntries(
    DELIVERY_COUNTRIES.map((country) => {
      const quote = (method: "standard" | "express") => {
        const totals = priceCart(lines, { shipping: method, country });
        return {
          subtotalCents: totals.subtotal.cents,
          shippingCents: totals.shipping.cents,
          totalCents: totals.total.cents,
          vatCents: totals.vat.cents,
          days: shippingMethod(country, method)!.days,
        };
      };
      // Who collects the tax depends on the basket (an export under the UK
      // limit is taxed by the shop), and is the same for both delivery methods.
      const { vatRatePerMille, exportTax } = priceCart(lines, { country });
      return [country, { vatRatePerMille, exportTax, standard: quote("standard"), express: quote("express") }];
    }),
  ) as Record<DeliveryCountry, CountryQuote>;

  const startCountry: DeliveryCountry = isDeliveryCountry(region.country) ? region.country : BASE_COUNTRY;
  const itemCount = lines.reduce((sum, line) => sum + line.quantity, 0);

  const user = await currentUser();

  return (
    <main className="mx-auto w-full max-w-[1440px] px-6 py-10 md:px-10 md:py-16">
      <h1 className="font-display text-3xl">{t("title")}</h1>
      <p className="text-slate tabular mt-2">{tc("items", { count: itemCount })}</p>
      <div className="mt-10">
        <CheckoutForm
          idempotencyKey={uuidv7()}
          currency={view.totals.total.currency}
          quotes={quotes}
          startCountry={startCountry}
          browsingCountry={region.country}
          contact={user === null ? undefined : { email: user.email, name: user.name }}
        />
      </div>
    </main>
  );
}
