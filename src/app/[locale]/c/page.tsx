/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Whole-collection listing page with the same filters as a category.
 */

import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { FilterLink } from "@/components/commerce/filter-link";
import { ListingView } from "@/components/commerce/listing-view";
import { requireLocale } from "@/i18n/params";
import { routing } from "@/i18n/routing";
import { listingQuery, PAGE_SIZE, parseListing } from "@/lib/catalog/listing";
import { getCategories, getListing } from "@/lib/catalog/server";
import { colorLabel, materialLabel } from "@/lib/search/vocabulary";

/** The whole collection, with the same filters as a category. */

export async function generateMetadata({ params, searchParams }: PageProps<"/[locale]/c">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "catalog" });
  const state = parseListing(await searchParams);
  return {
    title: t("allCategories"),
    alternates: {
      canonical: `/${locale}/c`,
      languages: Object.fromEntries(routing.locales.map((candidate) => [candidate, `/${candidate}/c`])),
    },
    robots: listingQuery({ ...state, page: 1 }) === "" ? undefined : { index: false, follow: true },
  };
}

export default async function CollectionPage({ params, searchParams }: PageProps<"/[locale]/c">) {
  const locale = await requireLocale(params);
  const t = await getTranslations("catalog");
  const state = parseListing(await searchParams);

  const [categories, listing] = await Promise.all([
    getCategories(locale),
    getListing({
      category: null,
      state,
      locale,
      pageSize: PAGE_SIZE,
      labels: { color: (id) => colorLabel(id, locale), material: (id) => materialLabel(id, locale) },
    }),
  ]);

  return (
    <main className="mx-auto w-full max-w-[1440px] px-6 py-10 md:px-10 md:py-16">
      <h1 className="font-display text-3xl">{t("allCategories")}</h1>

      <nav aria-label={t("categoryNav")} className="mt-6">
        <ul className="flex flex-wrap gap-2">
          <li>
            <FilterLink href="/c" selected current selectedLabel={t("selected")}>
              {t("allCategories")}
            </FilterLink>
          </li>
          {categories
            .filter((category) => category.productCount > 0)
            .map((category) => (
              <li key={category.slug}>
                <FilterLink href={`/c/${category.slug}`} selected={false} selectedLabel={t("selected")} count={category.productCount}>
                  {category.name}
                </FilterLink>
              </li>
            ))}
        </ul>
      </nav>

      <ListingView basePath="/c" state={state} listing={listing} locale={locale} />
    </main>
  );
}
