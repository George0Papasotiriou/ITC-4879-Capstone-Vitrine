/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Staff page to make a new product, as a draft.
 */

import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { NewProductForm, type KindGroup } from "@/components/staff/new-product-form";
import { SmartLink } from "@/components/ui/smart-link";
import { requireLocale } from "@/i18n/params";
import { requirePermission } from "@/lib/auth/session";
import { ABO_PRODUCT_KINDS, CATEGORIES } from "@/lib/catalog/taxonomy";

/**
 * docs/adr/034. The kinds are the catalogue's own, grouped by the category
 * they belong to, so a new product lands in the right aisle and search reads
 * its kind like any imported piece. Clothing in sizes is made by the capsule
 * tool, not here.
 */

export async function generateMetadata({ params }: PageProps<"/[locale]/staff/products/new">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "admin.create" });
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function NewProductPage({ params }: PageProps<"/[locale]/staff/products/new">) {
  const locale = await requireLocale(params);
  await requirePermission(locale, `/${locale}/staff/products/new`, "catalog:edit");
  const t = await getTranslations("admin.create");

  // One label per kind: "Lamp" appears under two ABO types, and the first is enough.
  const groups: KindGroup[] = CATEGORIES.filter((category) => category.slug !== "wear")
    .map((category) => {
      const seen = new Set<string>();
      const kinds = Object.entries(ABO_PRODUCT_KINDS)
        .filter(([, kind]) => kind.category === category.slug)
        .map(([value, kind]) => ({ value, label: locale === "el" ? kind.kindEl : kind.kindEn }))
        .filter((kind) => (seen.has(kind.label) ? false : (seen.add(kind.label), true)));
      return { category: category.slug, label: locale === "el" ? category.nameEl : category.nameEn, kinds };
    })
    .filter((group) => group.kinds.length > 0);

  return (
    <main className="mx-auto w-full max-w-[1100px] px-6 py-10 md:px-10 md:py-16" data-agent-id="staff:product-new">
      <SmartLink href="/staff/products" className="text-sm underline underline-offset-4">
        {t("back")}
      </SmartLink>
      <h1 className="font-display mt-6 text-3xl">{t("title")}</h1>
      <p className="text-slate mt-3 max-w-[65ch]">{t("lede")}</p>
      <div className="mt-10">
        <NewProductForm groups={groups} />
      </div>
    </main>
  );
}
