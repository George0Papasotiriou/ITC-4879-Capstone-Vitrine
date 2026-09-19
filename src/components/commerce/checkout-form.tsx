"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Checkout form: contact, delivery address in the EU or an export country, delivery method and live tax totals.
 */

import { useLocale, useTranslations } from "next-intl";
import { useId, useMemo, useRef, useState, useTransition } from "react";

import { Button, ButtonLink } from "@/components/ui/button";
import { RadioGroup } from "@/components/ui/choice";
import { Field } from "@/components/ui/field";
import { useHydrated } from "@/components/ui/use-hydrated";
import type { CheckoutFieldError } from "@/lib/commerce/checkout-input";
import { countryNames } from "@/lib/commerce/country-names";
import { formatMoney, money } from "@/lib/commerce/money";
import { EXPORT_COUNTRY_CODES, taxKey, type DeliveryCountry, type ExportTax } from "@/lib/commerce/exports";
import { ADDRESS_REGIONS, needsRegion } from "@/lib/commerce/regions";
import { EU_COUNTRIES, formatVatRate, type OutsideVatAreaPlace } from "@/lib/commerce/vat";

/**
 * The checkout form (Phase 5 step 3, docs/adr/013).
 *
 * The server sends the cart already priced for every delivery country and
 * both delivery methods, so changing either updates the summary instantly with
 * no arithmetic in the browser, and the shopper sees the VAT of the country the
 * goods will go to before placing the order. On submit the server validates
 * everything again, prices the order inside its transaction, and answers with
 * the order page's address or with per-field error codes, shown next to their
 * fields and summarised at the top, where focus moves so a screen reader hears
 * what to fix.
 */

type MethodQuote = { subtotalCents: number; shippingCents: number; totalCents: number; vatCents: number; days: [number, number] };
export type CountryQuote = { vatRatePerMille: number; exportTax: ExportTax | null; standard: MethodQuote; express: MethodQuote };

export function CheckoutForm({
  idempotencyKey,
  currency,
  quotes,
  startCountry,
  browsingCountry,
  contact,
}: {
  idempotencyKey: string;
  currency: string;
  quotes: Record<DeliveryCountry, CountryQuote>;
  startCountry: DeliveryCountry;
  /** The country prices were shown for while browsing; a different delivery country is pointed out. */
  browsingCountry: string;
  /** A signed-in shopper's email and name, to start from (docs/adr/016); still editable. */
  contact?: { email: string; name: string };
}) {
  const t = useTranslations("checkout");
  const tc = useTranslations("cart");
  const locale = useLocale();
  const countryId = useId();
  const regionId = useId();
  const [shipping, setShipping] = useState<"standard" | "express">("standard");
  const [country, setCountry] = useState<DeliveryCountry>(startCountry);
  const [errors, setErrors] = useState<Record<string, CheckoutFieldError>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const summaryRef = useRef<HTMLDivElement>(null);
  // Before hydration a press would submit the form natively. The button stays
  // disabled until then, and the form posts rather than gets, so personal
  // details can never end up in a URL (browser history, server logs, referrers).
  const hydrated = useHydrated();

  const { name: countryName, inSentence } = useMemo(() => countryNames(locale), [locale]);
  const byName = (list: readonly DeliveryCountry[]) => [...list].sort((a, b) => countryName(a).localeCompare(countryName(b), locale));
  const euCountries = useMemo(() => byName(EU_COUNTRIES), [locale]); // eslint-disable-line react-hooks/exhaustive-deps
  const exportCountries = useMemo(() => byName(EXPORT_COUNTRY_CODES), [locale]); // eslint-disable-line react-hooks/exhaustive-deps

  const format = (cents: number) => formatMoney(money(cents, currency), locale);
  const quote = quotes[country];
  const chosen = quote[shipping];
  const rate = formatVatRate(quote.vatRatePerMille, locale);
  const exportTax = quote.exportTax;
  const exportRate = exportTax === null ? "" : formatVatRate(exportTax.ratePerMille, locale);
  const regionOptions = needsRegion(country) ? ADDRESS_REGIONS[country] : null;
  const regionLabel = country === "US" ? t("regionUS") : country === "CA" ? t("regionCA") : t("regionAU");

  const errorText = (field: string) => {
    const code = errors[field];
    if (code === undefined) return undefined;
    if (code === "email") return t("errorEmail");
    if (code === "postcode") return t("errorPostcodeCountry", { country: inSentence(country) });
    if (code === "country") return t("errorCountry");
    if (code === "region") return t("errorRegion");
    return t("errorRequired");
  };

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    startTransition(async () => {
      setFormError(null);
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...data, shipping, country, idempotencyKey, locale }),
      }).catch(() => null);
      const result = (await response?.json().catch(() => null)) as
        | { ok: true; url: string }
        | { ok: false; reason: string; place?: OutsideVatAreaPlace; fields?: Record<string, CheckoutFieldError> }
        | null;

      if (result?.ok) {
        // A full navigation, so the cart count and every server component start fresh.
        window.location.assign(result.url);
        return;
      }
      if (result?.ok === false && result.reason === "invalid" && result.fields !== undefined) {
        setErrors(result.fields);
      } else {
        setErrors({});
        const reason = result?.ok === false ? result.reason : null;
        setFormError(
          reason === "unavailable"
            ? t("errorUnavailable")
            : reason === "empty_cart"
              ? t("errorEmpty")
              : reason === "not_deliverable"
                ? t("errorNotDeliverable")
                : reason === "outside_vat_area" && result?.ok === false && result.place !== undefined
                  ? t("errorOutsideVatArea", { place: result.place })
                  : t("errorFailed"),
        );
      }
      requestAnimationFrame(() => summaryRef.current?.focus());
    });
  };

  const hasErrors = Object.keys(errors).length > 0 || formError !== null;

  return (
    <form onSubmit={submit} method="post" noValidate className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start" data-agent-id="checkout:form">
      <div className="flex flex-col gap-10">
        <div ref={summaryRef} tabIndex={-1} className="outline-none" aria-live="polite">
          {hasErrors ? (
            <div role="alert" className="border-danger/40 bg-danger/5 rounded-plinth border p-4 text-sm">
              <p className="text-danger font-medium">{formError ?? t("errorsTitle")}</p>
            </div>
          ) : null}
        </div>

        <fieldset className="flex flex-col gap-5">
          <legend className="font-display mb-4 text-xl">{t("contact")}</legend>
          <Field label={t("email")} name="email" type="email" autoComplete="email" inputMode="email" required hint={t("emailHint")} error={errorText("email")} defaultValue={contact?.email} />
        </fieldset>

        <fieldset className="flex flex-col gap-5">
          <legend className="font-display mb-4 text-xl">{t("address")}</legend>
          <div className="flex flex-col gap-2">
            <label htmlFor={countryId} className="text-sm font-medium">
              {t("country")}
            </label>
            <select
              id={countryId}
              name="country"
              autoComplete="country"
              value={country}
              onChange={(event) => setCountry(event.currentTarget.value as DeliveryCountry)}
              aria-describedby={country === browsingCountry ? undefined : `${countryId}-note`}
              className="border-hairline text-dusk hover:border-dusk/35 rounded-plinth h-11 w-full cursor-pointer border bg-white px-3 transition-colors"
              data-agent-id="checkout:country"
            >
              <optgroup label={t("countriesEu")}>
                {euCountries.map((code) => (
                  <option key={code} value={code}>
                    {countryName(code)}
                  </option>
                ))}
              </optgroup>
              <optgroup label={t("countriesExport")}>
                {exportCountries.map((code) => (
                  <option key={code} value={code}>
                    {countryName(code)}
                  </option>
                ))}
              </optgroup>
            </select>
            {country === browsingCountry ? null : (
              <p id={`${countryId}-note`} className="text-dusk text-sm" aria-live="polite">
                {exportTax === null
                  ? t("deliveryCountryNote", { country: inSentence(country), rate })
                  : exportTax.collectedBy === "seller"
                    ? t("deliverySellerTaxNote", { country: inSentence(country), rate: exportRate, tax: taxKey(exportTax.taxName) })
                    : t("deliveryExportNote", { country: inSentence(country) })}
              </p>
            )}
          </div>
          <Field label={t("name")} name="name" autoComplete="name" required error={errorText("name")} defaultValue={contact?.name} />
          <Field label={t("line1")} name="line1" autoComplete="address-line1" required error={errorText("line1")} />
          <Field label={t("line2")} name="line2" autoComplete="address-line2" error={errorText("line2")} />
          <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_10rem]">
            <Field label={t("city")} name="city" autoComplete="address-level2" required error={errorText("city")} />
            <Field label={t("postcode")} name="postcode" autoComplete="postal-code" required error={errorText("postcode")} />
          </div>
          {regionOptions === null ? null : (
            <div className="flex flex-col gap-2">
              <label htmlFor={regionId} className="text-sm font-medium">
                {regionLabel}
              </label>
              <select
                key={country}
                id={regionId}
                name="region"
                autoComplete="address-level1"
                required
                defaultValue=""
                aria-invalid={errors.region === undefined ? undefined : true}
                aria-describedby={errors.region === undefined ? undefined : `${regionId}-error`}
                className="border-hairline text-dusk hover:border-dusk/35 rounded-plinth h-11 w-full cursor-pointer border bg-white px-3 transition-colors"
                data-agent-id="checkout:region"
              >
                <option value="" disabled>
                  {t("regionChoose")}
                </option>
                {regionOptions.map(([code, name]) => (
                  <option key={code} value={code}>
                    {name}
                  </option>
                ))}
              </select>
              {errors.region === undefined ? null : (
                <p id={`${regionId}-error`} className="text-danger text-sm">
                  {errorText("region")}
                </p>
              )}
            </div>
          )}
          <Field label={t("phone")} name="phone" type="tel" autoComplete="tel" hint={t("phoneHint")} error={errorText("phone")} />
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="font-display mb-4 text-xl">{t("delivery")}</legend>
          <RadioGroup
            legend={t("delivery")}
            hideLegend
            value={shipping}
            onValueChange={(value) => setShipping(value === "express" ? "express" : "standard")}
            options={[
              {
                value: "standard",
                label: t("standard", { from: quote.standard.days[0], to: quote.standard.days[1] }),
                hint: quote.standard.shippingCents === 0 ? t("free") : format(quote.standard.shippingCents),
              },
              {
                value: "express",
                label: quote.express.days[1] === 1 ? t("express") : t("expressDays", { from: quote.express.days[0], to: quote.express.days[1] }),
                hint: format(quote.express.shippingCents),
              },
            ]}
          />
        </fieldset>
      </div>

      <aside aria-labelledby="checkout-summary" className="bg-plinth/60 rounded-plinth flex flex-col gap-5 p-6 lg:sticky lg:top-24">
        <h2 id="checkout-summary" className="font-display text-xl">
          {tc("summary")}
        </h2>
        <dl className="flex flex-col gap-3 text-sm" data-agent-id="checkout:totals">
          <div className="flex justify-between gap-4">
            <dt>{tc("subtotal")}</dt>
            <dd className="tabular">{format(chosen.subtotalCents)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt>{tc("shipping")}</dt>
            <dd className="tabular">{chosen.shippingCents === 0 ? tc("shippingFree") : format(chosen.shippingCents)}</dd>
          </div>
          <div className="border-hairline flex justify-between gap-4 border-t pt-3 text-base font-medium">
            <dt>{tc("total")}</dt>
            <dd className="tabular">{format(chosen.totalCents)}</dd>
          </div>
        </dl>
        <p className="text-slate -mt-2 text-xs" data-agent-id="checkout:vat">
          {exportTax === null
            ? tc("vatIncludedCountry", { amount: format(chosen.vatCents), rate, country: inSentence(country) })
            : exportTax.collectedBy === "seller"
              ? tc("exportTaxIncluded", { amount: format(chosen.vatCents), rate: exportRate, country: inSentence(country), tax: taxKey(exportTax.taxName) })
              : tc("exportTaxOnDelivery", { rate: exportRate, country: inSentence(country), tax: taxKey(exportTax.taxName) })}
        </p>
        <p className="text-slate text-sm">{t("testNotice")}</p>
        <Button type="submit" disabled={!hydrated} aria-disabled={pending || undefined} data-agent-id="action:place-order">
          {pending ? t("placing") : t("placeOrder", { amount: format(chosen.totalCents) })}
        </Button>
        <p className="text-slate text-xs">{t("privacy")}</p>
        <ButtonLink href="/cart" variant="tertiary" size="sm">
          {t("backToCart")}
        </ButtonLink>
      </aside>
    </form>
  );
}
