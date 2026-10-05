/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The capsule wardrobe: a few pieces within a budget that make the most outfits together.
 */

import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { ProductGrid } from "@/components/commerce/product-grid";
import { ProductImage } from "@/components/commerce/product-image";
import { SmartLink } from "@/components/ui/smart-link";
import { requireLocale } from "@/i18n/params";
import { routing } from "@/i18n/routing";
import type { ProductCard } from "@/lib/catalog/queries";
import { getCardsByIds } from "@/lib/catalog/server";
import { formatMoney } from "@/lib/commerce/money";
import type { Department } from "@/lib/optimize/outfit";
import { capsuleFor, type CapsuleSize } from "@/lib/stylist/server";
import { CAPSULE_BUDGETS as BUDGETS } from "@/lib/stylist/wardrobe";

/**
 * docs/adr/066. A GET form, as the Budget Stylist's: the request is the URL,
 * so a capsule can be shared and the Concierge can open one. The page shows
 * the pieces, how many outfits they make out of how many possible, and some
 * of those outfits.
 */

export async function generateMetadata({ params }: PageProps<"/[locale]/capsule">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "capsule" });
  return {
    title: t("title"),
    description: t("lede"),
    alternates: {
      canonical: `/${locale}/capsule`,
      languages: Object.fromEntries(routing.locales.map((candidate) => [candidate, `/${candidate}/capsule`])),
    },
  };
}

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function CapsulePage({ params, searchParams }: PageProps<"/[locale]/capsule">) {
  const locale = await requireLocale(params);
  const t = await getTranslations("capsule");
  const search = await searchParams;
  const department: Department | null = first(search.for) === "women" ? "women" : first(search.for) === "men" ? "men" : null;
  const size: CapsuleSize = first(search.size) === "medium" ? "medium" : "small";
  const asked = Number(first(search.budget));
  const budget = (BUDGETS as readonly number[]).includes(asked) ? asked : 600;

  const result = department === null ? undefined : await capsuleFor(department, size, budget * 100);
  const cards = result === undefined || result === null ? [] : await getCardsByIds(result.ids, locale);
  const byId = new Map<string, ProductCard>(cards.map((card) => [card.id, card]));
  const fieldClass = "border-hairline text-dusk hover:border-dusk/35 rounded-plinth h-11 w-full border bg-white px-3 transition-colors";

  return (
    <main className="mx-auto w-full max-w-[1440px] px-6 py-10 md:px-10 md:py-16" data-agent-id="capsule:page">
      <h1 className="font-display text-3xl">{t("title")}</h1>
      <p className="text-slate mt-3 max-w-[62ch]">{t("lede")}</p>

      <form action={`/${locale}/capsule`} method="get" className="border-hairline mt-8 grid gap-6 border-y py-8 md:grid-cols-4" data-agent-id="capsule:form">
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-medium">{t("for")}</legend>
          <div className="flex gap-2">
            {(["women", "men"] as const).map((value) => (
              <label key={value} className="border-hairline has-[:checked]:bg-dusk has-[:checked]:text-glass inline-flex h-11 cursor-pointer items-center rounded-full border px-4 text-sm has-[:focus-visible]:outline-2">
                <input type="radio" name="for" value={value} required defaultChecked={department === value || (department === null && value === "women")} className="sr-only" data-agent-id={`capsule:for:${value}`} />
                {t(`forValue.${value}`)}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="flex flex-col gap-2">
          <label htmlFor="capsule-budget" className="text-sm font-medium">
            {t("budget")}
          </label>
          <select id="capsule-budget" name="budget" defaultValue={String(budget)} className={`${fieldClass} cursor-pointer`} data-agent-id="capsule:budget">
            {BUDGETS.map((value) => (
              <option key={value} value={value}>
                {formatMoney({ cents: value * 100, currency: "EUR" }, locale, { hideDecimalsWhenWhole: true })}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="capsule-size" className="text-sm font-medium">
            {t("size")}
          </label>
          <select id="capsule-size" name="size" defaultValue={size} className={`${fieldClass} cursor-pointer`} data-agent-id="capsule:size">
            <option value="small">{t("sizes.small")}</option>
            <option value="medium">{t("sizes.medium")}</option>
          </select>
        </div>
        <div className="flex items-end">
          <button type="submit" className="bg-dusk text-glass rounded-plinth hover:bg-dusk/90 h-11 w-full cursor-pointer px-6 text-sm font-medium transition-colors" data-agent-id="capsule:build">
            {t("build")}
          </button>
        </div>
      </form>

      {result === undefined ? (
        <section className="mt-10 max-w-[62ch]">
          <h2 className="font-display text-xl">{t("howTitle")}</h2>
          <p className="text-slate mt-3">{t("how")}</p>
        </section>
      ) : result === null ? (
        <p className="text-slate mt-10 max-w-[62ch]" role="status" data-agent-id="capsule:none">
          {t("none")}
        </p>
      ) : (
        <section className="mt-10 flex flex-col gap-8" data-agent-id="capsule:result" data-capsule-outfits={result.outfits}>
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="font-display text-2xl">{t("result", { pieces: result.ids.length, outfits: result.outfits })}</h2>
            <p className="text-slate text-sm tabular-nums">{t("total", { price: formatMoney({ cents: cards.reduce((sum, card) => sum + card.price.cents, 0), currency: cards[0]?.price.currency ?? "EUR" }, locale), possible: result.possible })}</p>
          </div>
          <ProductGrid products={cards} locale={locale} priorityCount={0} />
          {result.examples.length === 0 ? null : (
            <div className="flex flex-col gap-4">
              <h3 className="font-display text-xl">{t("examples")}</h3>
              <ol className="grid gap-4 md:grid-cols-2 lg:grid-cols-3" data-agent-id="capsule:outfits">
                {result.examples.map((outfit, index) => (
                  <li key={outfit.join(",")} className="border-hairline rounded-plinth flex flex-col gap-3 border p-4">
                    <span className="text-slate text-xs">{t("outfit", { number: index + 1 })}</span>
                    <div className="flex gap-2">
                      {outfit.map((id) => {
                        const card = byId.get(id);
                        if (card === undefined) return null;
                        return (
                          <SmartLink key={id} href={`/p/${card.slug}`} className="bg-plinth rounded-plinth relative block aspect-square w-1/3 overflow-hidden" aria-label={card.title}>
                            {card.image === null ? null : (
                              <span className="on-plinth absolute inset-0">
                                <ProductImage image={card.image} sizes="120px" decorative />
                              </span>
                            )}
                          </SmartLink>
                        );
                      })}
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
