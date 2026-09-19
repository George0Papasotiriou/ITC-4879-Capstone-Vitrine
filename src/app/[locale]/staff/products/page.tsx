/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Staff product list: search by title or SKU, filter by category and availability, and a low-stock view.
 */

import type { Metadata } from "next";
import Image from "next/image";
import { getTranslations } from "next-intl/server";

import { Button } from "@/components/ui/button";
import { SmartLink } from "@/components/ui/smart-link";
import { requireLocale } from "@/i18n/params";
import { LOW_STOCK } from "@/lib/admin/catalog";
import { catalogAdmin } from "@/lib/admin/server";
import { requirePermission } from "@/lib/auth/session";
import { CATEGORIES, isCategorySlug } from "@/lib/catalog/taxonomy";
import { formatMoney, money } from "@/lib/commerce/money";
import { cn } from "@/lib/ui/cn";

/**
 * For "catalog:edit" (merchandiser and admin). Views and filters are GET
 * parameters, so a list can be bookmarked and shared between staff.
 */

const VIEWS = ["all", "active", "archived", "low"] as const;
type View = (typeof VIEWS)[number];
const PAGE_SIZE = 50;

export async function generateMetadata({ params }: PageProps<"/[locale]/staff/products">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "admin.products" });
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function StaffProductsPage({ params, searchParams }: PageProps<"/[locale]/staff/products">) {
  const locale = await requireLocale(params);
  await requirePermission(locale, `/${locale}/staff/products`, "catalog:edit");
  const query = await searchParams;
  const view: View = VIEWS.find((option) => option === query.view) ?? "all";
  const search = typeof query.q === "string" ? query.q.trim().slice(0, 100) : "";
  const category = typeof query.category === "string" && isCategorySlug(query.category) ? query.category : null;
  const page = Math.max(1, Number.parseInt(typeof query.page === "string" ? query.page : "1", 10) || 1);

  const t = await getTranslations("admin.products");
  const { total, rows } = await (await catalogAdmin()).listProducts({
    query: search,
    category,
    status: view === "active" || view === "archived" ? view : null,
    lowStock: view === "low",
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });
  const categoryName = (slug: string) => {
    const found = CATEGORIES.find((candidate) => candidate.slug === slug);
    return found === undefined ? slug : locale === "el" ? found.nameEl : found.nameEn;
  };
  const link = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams();
    const state: Record<string, string | null> = { view, q: search === "" ? null : search, category, page: null, ...changes };
    for (const [key, value] of Object.entries(state)) if (value !== null && value !== "" && !(key === "view" && value === "all")) next.set(key, value);
    const encoded = next.toString();
    return `/staff/products${encoded === "" ? "" : `?${encoded}`}`;
  };

  return (
    <main className="mx-auto w-full max-w-[1440px] px-6 py-10 md:px-10 md:py-16" data-agent-id="staff:products">
      <h1 className="font-display text-3xl">{t("title")}</h1>
      <p className="text-slate mt-3 max-w-[70ch]">{t("lede")}</p>

      <div className="mt-8 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <nav aria-label={t("viewsLabel")} className="-mx-1 overflow-x-auto">
          <ul className="flex gap-1 px-1">
            {VIEWS.map((option) => (
              <li key={option}>
                <SmartLink
                  href={link({ view: option })}
                  aria-current={option === view ? "page" : undefined}
                  className={cn(
                    "rounded-plinth flex h-11 items-center px-4 text-sm whitespace-nowrap no-underline transition-colors",
                    option === view ? "bg-dusk text-glass" : "text-dusk hover:bg-dusk/[0.05]",
                  )}
                  data-agent-id={`staff:products-view:${option}`}
                >
                  {t(`views.${option}`)}
                </SmartLink>
              </li>
            ))}
          </ul>
        </nav>
        <form method="get" role="search" className="flex flex-wrap items-end gap-2">
          {view === "all" ? null : <input type="hidden" name="view" value={view} />}
          <label className="flex flex-col gap-2 text-sm font-medium">
            {t("category")}
            <select
              name="category"
              defaultValue={category ?? ""}
              className="border-hairline text-dusk rounded-plinth hover:border-dusk/35 h-11 border bg-white px-3 font-normal transition-colors"
              data-agent-id="staff:products-category"
            >
              <option value="">{t("allCategories")}</option>
              {CATEGORIES.map((entry) => (
                <option key={entry.slug} value={entry.slug}>
                  {locale === "el" ? entry.nameEl : entry.nameEn}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-2 text-sm font-medium">
            {t("search")}
            <input
              name="q"
              type="search"
              defaultValue={search}
              maxLength={100}
              autoComplete="off"
              className="border-hairline text-dusk rounded-plinth hover:border-dusk/35 h-11 w-64 border bg-white px-3 font-normal transition-colors"
              data-agent-id="staff:products-search"
            />
          </label>
          <Button type="submit" variant="secondary">
            {t("searchAction")}
          </Button>
        </form>
      </div>

      {rows.length === 0 ? (
        <p className="text-slate mt-10">{search === "" ? t("empty") : t("emptySearch", { query: search })}</p>
      ) : (
        <>
          <div className="border-hairline mt-8 overflow-x-auto border-t">
            <table className="w-full min-w-[48rem] border-collapse text-sm" data-agent-id="staff:products-table">
              <thead>
                <tr className="text-slate text-left">
                  <th scope="col" className="py-3 pr-4 font-medium">{t("columns.product")}</th>
                  <th scope="col" className="py-3 pr-4 font-medium">{t("columns.category")}</th>
                  <th scope="col" className="py-3 pr-4 text-right font-medium">{t("columns.price")}</th>
                  <th scope="col" className="py-3 pr-4 text-right font-medium">{t("columns.stock")}</th>
                  <th scope="col" className="py-3 font-medium">{t("columns.status")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="hover:bg-dusk/[0.02] border-hairline border-t" data-agent-id={`staff:product:${row.id}`}>
                    <th scope="row" className="py-3 pr-4 text-left font-normal">
                      <span className="flex items-center gap-3">
                        <span className="bg-plinth rounded-plinth relative size-12 shrink-0 overflow-hidden">
                          {row.image === null ? null : <Image src={row.image} alt="" fill sizes="48px" className="object-contain" />}
                        </span>
                        <span className="min-w-0">
                          <SmartLink href={`/staff/products/${row.id}`} className="line-clamp-2 font-medium underline underline-offset-4">
                            {locale === "el" ? (row.titleEl ?? row.titleEn) : row.titleEn}
                          </SmartLink>
                          <span className="text-slate tabular block text-xs">
                            {row.skus.join(", ")}
                            {row.staffEditedAt === null ? null : <> · {t("edited")}</>}
                          </span>
                        </span>
                      </span>
                    </th>
                    <td className="py-3 pr-4">{categoryName(row.category)}</td>
                    <td className="tabular py-3 pr-4 text-right whitespace-nowrap">{formatMoney(money(row.priceCents), locale)}</td>
                    <td className={cn("tabular py-3 pr-4 text-right", row.stock <= LOW_STOCK && "text-danger font-medium")}>{row.stock}</td>
                    <td className="py-3">
                      {/* Colour only marks the dot; the words carry the meaning, in Dusk for contrast. */}
                      <span className="inline-flex items-center gap-2 whitespace-nowrap">
                        <span aria-hidden="true" className={cn("size-2 rounded-full", row.status === "active" ? "bg-success" : "bg-slate")} />
                        {t(`statuses.${row.status}`)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <nav aria-label={t("pages")} className="text-slate mt-6 flex items-center justify-between gap-4 text-sm">
            <span className="tabular">{t("showing", { from: (page - 1) * PAGE_SIZE + 1, to: (page - 1) * PAGE_SIZE + rows.length, total })}</span>
            <span className="flex gap-2">
              {page > 1 ? (
                <SmartLink href={link({ page: String(page - 1) })} className="underline underline-offset-4">
                  {t("previous")}
                </SmartLink>
              ) : null}
              {page * PAGE_SIZE < total ? (
                <SmartLink href={link({ page: String(page + 1) })} className="underline underline-offset-4">
                  {t("next")}
                </SmartLink>
              ) : null}
            </span>
          </nav>
        </>
      )}
    </main>
  );
}
