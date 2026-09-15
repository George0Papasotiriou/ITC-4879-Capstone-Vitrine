/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Product listing layout: filters, sort, results grid and pagination.
 */

import { getTranslations } from "next-intl/server";

import { FilterLink } from "@/components/commerce/filter-link";
import { ListingSort } from "@/components/commerce/listing-sort";
import { ProductGrid } from "@/components/commerce/product-grid";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";
import {
  activeFilterCount,
  listingQuery,
  priceBuckets,
  SORTS,
  toggle,
  withChanges,
  type ListingState,
  type Sort,
} from "@/lib/catalog/listing";
import type { Listing } from "@/lib/catalog/queries";
import { formatMoney, money } from "@/lib/commerce/money";

/**
 * A filterable, sortable, paginated product listing (docs/PLAN.md Phase 3).
 *
 * Server-rendered from the URL: every filter is a link to the listing with
 * that filter toggled, so the page works before any JavaScript loads and the
 * Concierge can open any view by URL. Facet counts come from the database with
 * every other active filter applied, so a count is the number of products the
 * reader would actually see.
 */
export async function ListingView({
  basePath,
  state,
  listing,
  locale,
}: {
  basePath: string;
  state: ListingState;
  listing: Listing;
  locale: string;
}) {
  const t = await getTranslations("catalog");
  const href = (next: ListingState) => `${basePath}${listingQuery(next)}`;
  const euro = (cents: number) => formatMoney(money(cents), locale, { hideDecimalsWhenWhole: true });

  const priceLabel = (minCents: number | null, maxCents: number | null) =>
    minCents === null
      ? t("priceUnder", { amount: euro(maxCents ?? 0) })
      : maxCents === null
        ? t("priceOver", { amount: euro(minCents) })
        : t("priceBetween", { min: euro(minCents), max: euro(maxCents) });

  const sortLabels: Record<Sort, string> = {
    featured: t("sortFeatured"),
    "price-asc": t("sortPriceAsc"),
    "price-desc": t("sortPriceDesc"),
    newest: t("sortNewest"),
  };

  const buckets = listing.facets.price === null ? [] : priceBuckets(listing.facets.price.minCents, listing.facets.price.maxCents);
  const filtersActive = activeFilterCount(state);

  const active: { label: string; href: string }[] = [
    ...state.colors.map((id) => ({
      label: listing.facets.colors.find((facet) => facet.value === id)?.label ?? id,
      href: href(toggle(state, "colors", id)),
    })),
    ...state.materials.map((id) => ({
      label: listing.facets.materials.find((facet) => facet.value === id)?.label ?? id,
      href: href(toggle(state, "materials", id)),
    })),
    ...state.brands.map((slug) => ({
      label: listing.facets.brands.find((facet) => facet.value === slug)?.label ?? slug,
      href: href(toggle(state, "brands", slug)),
    })),
    ...(state.minCents === null && state.maxCents === null
      ? []
      : [{ label: priceLabel(state.minCents, state.maxCents), href: href(withChanges(state, { minCents: null, maxCents: null })) }]),
    ...(state.inStock ? [{ label: t("inStockOnly"), href: href(withChanges(state, { inStock: false })) }] : []),
  ];

  const facetGroups = [
    { key: "colors" as const, title: t("color"), values: listing.facets.colors, selected: state.colors },
    { key: "materials" as const, title: t("material"), values: listing.facets.materials, selected: state.materials },
    { key: "brands" as const, title: t("brand"), values: listing.facets.brands, selected: state.brands },
  ].filter((group) => group.values.length > 0);

  const filters = (
    <div className="flex flex-col gap-6">
      {facetGroups.map((group) => (
        <fieldset key={group.key} className="flex flex-col gap-3">
          <legend className="mb-3 text-sm font-medium">{group.title}</legend>
          <div className="flex flex-wrap gap-2">
            {group.values.map((facet) => (
              <FilterLink
                key={facet.value}
                href={href(toggle(state, group.key, facet.value))}
                selected={group.selected.includes(facet.value)}
                selectedLabel={t("selected")}
                count={facet.count}
              >
                {facet.label}
              </FilterLink>
            ))}
          </div>
        </fieldset>
      ))}

      {buckets.length > 0 ? (
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-3 text-sm font-medium">{t("price")}</legend>
          <div className="flex flex-wrap gap-2">
            {buckets.map((bucket) => {
              const selected = state.minCents === bucket.minCents && state.maxCents === bucket.maxCents;
              return (
                <FilterLink
                  key={`${bucket.minCents}-${bucket.maxCents}`}
                  href={href(
                    withChanges(state, selected ? { minCents: null, maxCents: null } : { minCents: bucket.minCents, maxCents: bucket.maxCents }),
                  )}
                  selected={selected}
                  selectedLabel={t("selected")}
                >
                  {priceLabel(bucket.minCents, bucket.maxCents)}
                </FilterLink>
              );
            })}
          </div>
        </fieldset>
      ) : null}

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-3 text-sm font-medium">{t("availability")}</legend>
        <div className="flex flex-wrap gap-2">
          <FilterLink
            href={href(withChanges(state, { inStock: !state.inStock }))}
            selected={state.inStock}
            selectedLabel={t("selected")}
          >
            {t("inStockOnly")}
          </FilterLink>
        </div>
      </fieldset>
    </div>
  );

  return (
    <div className="mt-8" data-agent-id="listing:results">
      <div className="border-hairline flex flex-col gap-4 border-y py-4 sm:flex-row sm:items-end sm:justify-between">
        {/* A heading, so the tiles' h3 titles sit under an h2 rather than straight under the page h1. */}
        <h2 className="text-slate text-sm font-normal" aria-live="polite">
          {t("results", { count: listing.total })}
        </h2>
        <ListingSort
          // Remount on a new sort, so the uncontrolled select shows the URL's order after navigation.
          key={state.sort}
          label={t("sort")}
          submitLabel={t("sort")}
          value={state.sort}
          action={basePath}
          hidden={[...new URLSearchParams(listingQuery(withChanges(state, { sort: "featured", page: 1 })))]}
          options={SORTS.map((sort) => ({ value: sort, label: sortLabels[sort], href: href(withChanges(state, { sort })) }))}
        />
      </div>

      <div className="mt-8 grid gap-10 lg:grid-cols-[16rem_1fr]">
        <aside aria-label={t("filters")}>
          {/* One set of filters: a disclosure on small screens, and always open
              from the large breakpoint (globals.css, .listing-filters). Rendering
              it twice — once per breakpoint — doubled the page's markup. */}
          <details className="listing-filters" open={filtersActive > 0}>
            <summary className="border-hairline flex h-11 cursor-pointer items-center justify-between rounded-sm border px-4 text-sm">
              {t("filters")}
              {filtersActive > 0 ? <span className="tabular text-slate">{filtersActive}</span> : null}
            </summary>
            <div className="pt-6 lg:pt-0">{filters}</div>
          </details>
        </aside>

        <div>
          {active.length > 0 ? (
            <ul className="mb-8 flex flex-wrap items-center gap-2" aria-label={t("filters")}>
              {active.map((filter) => (
                <li key={filter.href}>
                  <FilterLink href={filter.href} selected selectedLabel="">
                    <span className="sr-only">{t("removeFilter", { label: filter.label })}</span>
                    <span aria-hidden="true">{filter.label} ×</span>
                  </FilterLink>
                </li>
              ))}
              <li>
                <ButtonLink href={basePath} variant="tertiary" size="sm">
                  {t("clearFilters")}
                </ButtonLink>
              </li>
            </ul>
          ) : null}

          {listing.products.length === 0 ? (
            <EmptyState
              title={filtersActive > 0 ? t("filteredEmptyTitle") : t("emptyTitle")}
              description={filtersActive > 0 ? t("filteredEmptyDescription") : t("emptyDescription")}
              action={
                filtersActive > 0 || state.page > 1 ? (
                  <ButtonLink href={basePath} variant="secondary">
                    {t("clearFilters")}
                  </ButtonLink>
                ) : undefined
              }
            />
          ) : (
            <ProductGrid products={listing.products} locale={locale} />
          )}

          {listing.pageCount > 1 ? (
            <nav aria-label={t("pagination")} className="mt-16 flex items-center justify-between gap-4">
              {state.page > 1 ? (
                <ButtonLink href={href(withChanges(state, { page: state.page - 1 }))} variant="secondary" rel="prev">
                  {t("previous")}
                </ButtonLink>
              ) : (
                <span />
              )}
              <p className="text-slate tabular text-sm">{t("pageOf", { page: state.page, count: listing.pageCount })}</p>
              {state.page < listing.pageCount ? (
                <ButtonLink href={href(withChanges(state, { page: state.page + 1 }))} variant="secondary" rel="next">
                  {t("next")}
                </ButtonLink>
              ) : (
                <span />
              )}
            </nav>
          ) : null}
        </div>
      </div>
    </div>
  );
}
