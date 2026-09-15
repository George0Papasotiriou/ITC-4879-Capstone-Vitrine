/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Search results page with parsed filters, spelling corrections and category facets.
 */

import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { FilterLink } from "@/components/commerce/filter-link";
import { ProductGrid } from "@/components/commerce/product-grid";
import { ButtonLink } from "@/components/ui/button";
import { SmartLink } from "@/components/ui/smart-link";
import { EmptyState } from "@/components/ui/states";
import { requireLocale } from "@/i18n/params";
import { getCardsByIds, runSearch } from "@/lib/catalog/server";
import { CATEGORIES, isCategorySlug } from "@/lib/catalog/taxonomy";
import { formatMoney, money } from "@/lib/commerce/money";
import { colorLabel, materialLabel } from "@/lib/search/vocabulary";

/**
 * Search results (docs/PLAN.md Phase 4, graded algorithm A1).
 *
 * A plain GET form, so a search is a URL: it can be shared, reloaded, opened by
 * the Concierge, and works before JavaScript. The page shows what the search
 * understood — constraints read from the words, Greeklish read as Greek,
 * spelling corrected — because a search that silently reinterprets a query is
 * one nobody can trust or correct.
 */

export async function generateMetadata({ searchParams }: PageProps<"/[locale]/search">): Promise<Metadata> {
  const t = await getTranslations("search");
  const query = typeof (await searchParams).q === "string" ? ((await searchParams).q as string).trim() : "";
  return {
    title: query === "" ? t("title") : t("resultsFor", { query: query.slice(0, 80) }),
    // Result pages are endless and change with stock; keep them out of indexes.
    robots: { index: false, follow: true },
  };
}

const MAX_QUERY_LENGTH = 200;

export default async function SearchPage({ params, searchParams }: PageProps<"/[locale]/search">) {
  const locale = await requireLocale(params);
  const t = await getTranslations("search");
  const catalog = await getTranslations("catalog");

  const search = await searchParams;
  const query = (typeof search.q === "string" ? search.q : "").trim().slice(0, MAX_QUERY_LENGTH);
  const categoryParam = typeof search.category === "string" && isCategorySlug(search.category) ? search.category : null;

  const result = query === "" ? null : await runSearch(query, { filters: categoryParam === null ? undefined : { categories: [categoryParam] } });
  const cards = result === null ? [] : await getCardsByIds(result.ids, locale);

  const euro = (cents: number) => formatMoney(money(cents), locale, { hideDecimalsWhenWhole: true });
  const categoryName = (slug: string) => {
    const category = CATEGORIES.find((candidate) => candidate.slug === slug);
    return category === undefined ? slug : locale === "el" ? category.nameEl : category.nameEn;
  };

  const understood: string[] = [];
  if (result !== null) {
    // What the words said, before any relaxation, so the reader sees their own query reflected.
    const parsed = result.query;
    const filters = {
      categories: categoryParam === null ? parsed.categories : [categoryParam],
      colors: parsed.colors,
      materials: parsed.materials,
      minCents: parsed.price?.minCents ?? null,
      maxCents: parsed.price?.maxCents ?? null,
    };
    for (const slug of filters.categories) understood.push(categoryName(slug));
    for (const id of filters.colors) understood.push(colorLabel(id, locale));
    for (const id of filters.materials) understood.push(materialLabel(id, locale));
    if (filters.minCents !== null && filters.maxCents !== null) {
      understood.push(catalog("priceBetween", { min: euro(filters.minCents), max: euro(filters.maxCents) }));
    } else if (filters.maxCents !== null) {
      understood.push(catalog("priceUnder", { amount: euro(filters.maxCents) }));
    } else if (filters.minCents !== null) {
      understood.push(catalog("priceOver", { amount: euro(filters.minCents) }));
    }
  }

  const categoriesInResults = [...new Set(cards.map((card) => card.category))];
  const searchHref = (params: Record<string, string>) => `/search?${new URLSearchParams(params).toString()}`;

  return (
    <main className="mx-auto w-full max-w-[1440px] px-6 py-10 md:px-10 md:py-16">
      <h1 className="font-display text-3xl">{query === "" ? t("title") : t("resultsFor", { query })}</h1>

      <form role="search" action={`/${locale}/search`} method="get" className="mt-6 flex max-w-2xl flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex flex-1 flex-col gap-2">
          <label htmlFor="search-query" className="text-sm font-medium">
            {t("label")}
          </label>
          <input
            id="search-query"
            name="q"
            type="search"
            defaultValue={query}
            placeholder={t("placeholder")}
            maxLength={MAX_QUERY_LENGTH}
            autoComplete="off"
            enterKeyHint="search"
            data-agent-id="input:search"
            className="border-hairline text-dusk placeholder:text-slate/70 hover:border-dusk/35 rounded-plinth h-11 w-full border bg-white px-3 transition-colors"
          />
        </div>
        <button
          type="submit"
          className="bg-dusk text-glass rounded-plinth hover:bg-dusk/90 h-11 cursor-pointer px-6 text-sm font-medium transition-colors"
        >
          {t("submit")}
        </button>
      </form>

      {result === null ? (
        <EmptyState
          className="items-start text-left"
          title={t("emptyTitle")}
          description={t("emptyDescription")}
          action={
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-slate text-sm">{t("examples")}</span>
              {[t("exampleOne"), t("exampleTwo"), t("exampleThree")].map((example) => (
                <FilterLink key={example} href={searchHref({ q: example })} selected={false} selectedLabel="">
                  {example}
                </FilterLink>
              ))}
            </div>
          }
        />
      ) : (
        <>
          <div className="text-slate mt-6 flex flex-col gap-2 text-sm" aria-live="polite">
            <p>{t("count", { count: cards.length })}</p>
            {understood.length > 0 ? (
              <p>
                {t("understood")}: <span className="text-dusk">{understood.join(" · ")}</span>
              </p>
            ) : null}
            {result.readings.map((entry) => (
              <p key={entry.term}>{t("readingNote", { term: entry.term, reading: entry.readings[0]!.greek })}</p>
            ))}
            {result.corrections.map((entry) => (
              <p key={entry.term}>{t("correctionNote", { word: entry.words[0]! })}</p>
            ))}
            {result.relaxed.includes("categories") ? <p>{t("relaxedNote")}</p> : null}
            {result.relaxed.includes("colors") ? <p>{t("relaxedColors")}</p> : null}
            {result.relaxed.includes("materials") ? <p>{t("relaxedMaterials")}</p> : null}
          </div>

          {categoriesInResults.length > 1 || categoryParam !== null ? (
            <nav aria-label={catalog("categoryNav")} className="mt-6">
              <ul className="flex flex-wrap gap-2">
                <li>
                  <FilterLink href={searchHref({ q: query })} selected={categoryParam === null} selectedLabel={catalog("selected")}>
                    {catalog("allCategories")}
                  </FilterLink>
                </li>
                {(categoryParam === null ? categoriesInResults : [categoryParam]).map((slug) => (
                  <li key={slug}>
                    <FilterLink
                      href={searchHref(categoryParam === slug ? { q: query } : { q: query, category: slug })}
                      selected={categoryParam === slug}
                      selectedLabel={catalog("selected")}
                    >
                      {categoryName(slug)}
                    </FilterLink>
                  </li>
                ))}
              </ul>
            </nav>
          ) : null}

          {cards.length === 0 ? (
            <EmptyState
              title={t("noResultsTitle", { query })}
              description={t("noResultsDescription")}
              action={
                <div className="flex flex-col items-center gap-4">
                  {result.suggestions.length > 0 ? (
                    <p className="text-sm">
                      {t("didYouMean")}{" "}
                      {result.suggestions.map((word, index) => (
                        <span key={word}>
                          {index > 0 ? ", " : null}
                          <SmartLink href={searchHref({ q: word })} className="underline-offset-4">
                            {word}
                          </SmartLink>
                        </span>
                      ))}
                    </p>
                  ) : null}
                  <ButtonLink href="/c" variant="secondary">
                    {t("browseAll")}
                  </ButtonLink>
                </div>
              }
            />
          ) : (
            <ProductGrid products={cards} locale={locale} className="mt-10" />
          )}
        </>
      )}
    </main>
  );
}
