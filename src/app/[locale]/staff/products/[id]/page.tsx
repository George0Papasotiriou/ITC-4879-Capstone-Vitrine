/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Editing one product: its words, price and availability, and each variant's stock.
 */

import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";

import { ProductEditor } from "@/components/staff/product-editor";
import { StockForm } from "@/components/staff/stock-form";
import { SmartLink } from "@/components/ui/smart-link";
import { requireLocale } from "@/i18n/params";
import { centsToInput } from "@/lib/admin/catalog";
import { catalogAdmin } from "@/lib/admin/server";
import { requirePermission } from "@/lib/auth/session";

export async function generateMetadata({ params }: PageProps<"/[locale]/staff/products/[id]">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "admin.products" });
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function EditProductPage({ params }: PageProps<"/[locale]/staff/products/[id]">) {
  const locale = await requireLocale(params);
  const { id } = await params;
  await requirePermission(locale, `/${locale}/staff/products/${id}`, "catalog:edit");
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const product = await (await catalogAdmin()).readProduct(id);
  if (product === null) notFound();

  const t = await getTranslations("admin.edit");
  const format = await getFormatter();
  const title = locale === "el" ? (product.titleEl ?? product.titleEn) : product.titleEn;

  return (
    <main className="mx-auto w-full max-w-[1100px] px-6 py-10 md:px-10 md:py-16" data-agent-id={`staff:product-edit:${product.id}`}>
      <SmartLink href="/staff/products" className="text-sm underline underline-offset-4">
        {t("back")}
      </SmartLink>
      <div className="mt-6 flex flex-wrap items-center gap-6">
        {product.image === null ? null : (
          <span className="bg-plinth rounded-plinth relative size-24 shrink-0 overflow-hidden">
            <Image src={product.image} alt="" fill sizes="96px" className="object-contain" />
          </span>
        )}
        <div className="min-w-0">
          <h1 className="font-display text-3xl text-balance">{t("title", { title })}</h1>
          <p className="text-slate mt-2 text-sm">
            <SmartLink href={`/p/${product.slug}`} className="underline underline-offset-4">
              {t("viewInShop")}
            </SmartLink>
            {" · "}
            {t(`translation.${product.translation}`)}
          </p>
        </div>
      </div>
      <p className="bg-plinth/60 rounded-plinth mt-6 p-4 text-sm" data-agent-id="product-edit:ownership">
        {product.staffEditedAt === null ? t("importedNote") : t("editedNote", { date: format.dateTime(product.staffEditedAt, { dateStyle: "medium", timeStyle: "short" }) })}
      </p>

      <div className="mt-10 grid gap-14 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <ProductEditor
          productId={product.id}
          initial={{
            titleEn: product.titleEn,
            titleEl: product.titleEl ?? "",
            descriptionEn: product.descriptionEn ?? "",
            descriptionEl: product.descriptionEl ?? "",
            highlightsEn: product.highlightsEn.join("\n"),
            highlightsEl: (product.highlightsEl ?? []).join("\n"),
            price: centsToInput(product.priceCents),
            compareAt: centsToInput(product.compareAtCents),
            status: product.status === "archived" ? "archived" : "active",
          }}
        />
        <aside aria-labelledby="stock-heading" className="flex flex-col gap-4">
          <h2 id="stock-heading" className="font-display text-xl">
            {t("stock.title")}
          </h2>
          <p className="text-slate text-sm">{t("stock.lede")}</p>
          {product.variants.map((variant) => (
            // Keyed by the stock, so the form starts again from the new number after a save.
            <StockForm key={`${variant.id}:${variant.stock}`} productId={product.id} variant={variant} />
          ))}
        </aside>
      </div>
    </main>
  );
}
