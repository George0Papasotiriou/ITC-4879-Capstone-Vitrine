/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Category listing page with URL-based filters, sorting and pagination.
 */

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { FilterLink } from "@/components/commerce/filter-link";
import { ListingView } from "@/components/commerce/listing-view";
import { requireLocale } from "@/i18n/params";
import { routing } from "@/i18n/routing";
import { listingQuery, PAGE_SIZE, parseListing } from "@/lib/catalog/listing";
import { getCategories, getListing } from "@/lib/catalog/server";
import { CATEGORIES, isCategorySlug } from "@/lib/catalog/taxonomy";
import { colorLabel, materialLabel } from "@/lib/search/vocabulary";

/**
 * Category listing (docs/PLAN.md Phase 3, step 5): the category's products
 * with facets, sort and pagination, all held in the URL.
 */

export async function generateMetadata({ params, searchParams }: PageProps<"/[locale]/c/[slug]">): Promise<Metadata> {
  const { locale, slug } = await params;
  const category = CATEGORIES.find((candidate) => candidate.slug === slug);
  if (category === undefined) return {};

  const greek = locale === "el";
  const state = parseListing(await searchParams);
  // Filtered and sorted variants point search engines at the plain category.
  const path = `/c/${slug}`;
  return {
    title: greek ? category.nameEl : category.nameEn,
    description: greek ? category.descriptionEl : category.descriptionEn,
    alternates: {
      canonical: `/${locale}${path}${state.page > 1 ? listingQuery({ ...parseListing({}), page: state.page }) : ""}`,
      languages: Object.fromEntries(routing.locales.map((candidate) => [candidate, `/${candidate}${path}`])),
    },
    robots: listingQuery({ ...state, page: 1 }) === "" ? undefined : { index: false, follow: true },
  };
}

export default async function CategoryPage({ params, searchParams }: PageProps<"/[locale]/c/[slug]">) {
  const locale = await requireLocale(params);
  const { slug } = await params;
  if (!isCategorySlug(slug)) notFound();

  const t = await getTranslations("catalog");
  const state = parseListing(await searchParams);

  const [categories, listing] = await Promise.all([
    getCategories(locale),
    getListing({
      category: slug,
      state,
      locale,
      pageSize: PAGE_SIZE,
      labels: { color: (id) => colorLabel(id, locale), material: (id) => materialLabel(id, locale) },
    }),
  ]);
  const category = categories.find((candidate) => candidate.slug === slug);
  if (category === undefined) notFound();

  return (
    <main className="mx-auto w-full max-w-[1440px] px-6 py-10 md:px-10 md:py-16">
      <h1 className="font-display text-3xl">{category.name}</h1>
      {category.description === null ? null : <p className="text-slate mt-3 max-w-[60ch]">{category.description}</p>}

      <nav aria-label={t("categoryNav")} className="mt-6">
        <ul className="flex flex-wrap gap-2">
          {categories
            .filter((candidate) => candidate.productCount > 0 || candidate.slug === slug)
            .map((candidate) => (
              <li key={candidate.slug}>
                <FilterLink
                  href={`/c/${candidate.slug}`}
                  selected={candidate.slug === slug}
                  current={candidate.slug === slug}
                  selectedLabel={t("selected")}
                  count={candidate.productCount}
                >
                  {candidate.name}
                </FilterLink>
              </li>
            ))}
        </ul>
      </nav>

      <ListingView basePath={`/c/${slug}`} state={state} listing={listing} locale={locale} />
    </main>
  );
}
