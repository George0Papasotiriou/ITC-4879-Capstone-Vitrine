/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * See-it-in-your-room page that places a product at true scale in a room photo.
 */

import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { ProductImage } from "@/components/commerce/product-image";
import { RoomPlanner } from "@/components/room/room-planner";
import { SmartLink } from "@/components/ui/smart-link";
import { requireLocale } from "@/i18n/params";
import { routing } from "@/i18n/routing";
import { getPlaceable, getProduct } from "@/lib/catalog/server";
import { roomPlacement } from "@/lib/catalog/taxonomy";

/**
 * See it in your room (docs/PLAN.md Phase 10, graded algorithm A4).
 *
 * The server only decides which product is being placed and reads its measured
 * dimensions from the database; everything with the photo happens in the
 * browser (src/components/room/room-planner.tsx), and the photo is never sent
 * anywhere. Without a product, or with one that cannot stand on a floor, the
 * page offers the pieces that can.
 */

export async function generateMetadata({ params }: PageProps<"/[locale]/room">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "room" });
  return {
    title: t("title"),
    description: t("intro"),
    robots: { index: false, follow: true },
    alternates: { languages: Object.fromEntries(routing.locales.map((candidate) => [candidate, `/${candidate}/room`])) },
  };
}

export default async function RoomPage({ params, searchParams }: PageProps<"/[locale]/room">) {
  const locale = await requireLocale(params);
  const t = await getTranslations("room");
  const tp = await getTranslations("product");
  const search = await searchParams;
  const slug = typeof search.product === "string" ? search.product : null;

  const product = slug === null ? null : await getProduct(slug, locale);
  const mode = product === null ? null : roomPlacement(product.kind, product.dimsCm);

  if (product === null || mode === null || product.dimsCm === null) {
    const choices = await getPlaceable({ locale, limit: 12 });
    return (
      <main className="mx-auto w-full max-w-[1440px] px-6 py-10 md:px-10 md:py-16">
        <h1 className="font-display text-3xl">{t("title")}</h1>
        <p className="text-slate mt-3 max-w-[60ch]">{t("intro")}</p>
        {product !== null ? (
          <p role="status" className="text-dusk mt-6 max-w-[60ch]">
            {t("notPlaceable", { title: product.title })}
          </p>
        ) : null}
        <h2 className="font-display mt-12 text-2xl">{t("choose")}</h2>
        <p className="text-slate mt-2 max-w-[60ch] text-sm">{t("chooseIntro")}</p>
        <ul className="mt-8 grid grid-cols-2 gap-x-6 gap-y-10 md:grid-cols-3 lg:grid-cols-4">
          {choices.map((choice) => (
            <li key={choice.id}>
              <SmartLink
                href={`/room?product=${choice.slug}`}
                className="group flex flex-col gap-3 no-underline"
                aria-label={t("placeThis", { title: choice.title })}
                data-agent-id={`room-choice:${choice.id}`}
              >
                <div className="bg-plinth rounded-plinth group-hover:ring-dusk/30 relative aspect-square overflow-hidden transition-shadow group-hover:ring-2">
                  {choice.image === null ? null : (
                    <div className="on-plinth absolute inset-6">
                      <ProductImage image={choice.image} loading="lazy" sizes="(min-width: 1024px) 22vw, 45vw" />
                    </div>
                  )}
                </div>
                <span className="text-slate text-sm">{choice.kindLabel}</span>
                <span className="line-clamp-2">{choice.title}</span>
              </SmartLink>
            </li>
          ))}
        </ul>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-[1440px] px-6 py-10 md:px-10 md:py-14">
      <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="font-display text-3xl">{t("title")}</h1>
          <p className="text-slate mt-3 max-w-[60ch]">{t("intro")}</p>
        </div>
        <div className="flex items-center gap-4" data-agent-id={`room-product:${product.id}`}>
          <div className="bg-plinth rounded-plinth relative size-20 shrink-0 overflow-hidden">
            {product.image === null ? null : (
              <div className="on-plinth absolute inset-2">
                <ProductImage image={product.image} loading="fold" sizes="80px" />
              </div>
            )}
          </div>
          <div className="text-sm">
            <p className="line-clamp-2 max-w-[28ch] font-medium">{product.title}</p>
            <p className="text-slate tabular">{tp("dimensionsValue", product.dimsCm)}</p>
            <p className="mt-1 flex gap-4">
              <SmartLink href={`/p/${product.slug}`} className="underline-offset-4">
                {t("viewProduct")}
              </SmartLink>
              <SmartLink href="/room" className="text-slate underline-offset-4">
                {t("change")}
              </SmartLink>
            </p>
          </div>
        </div>
      </div>

      <div className="mt-10">
        <RoomPlanner
          locale={locale}
          product={{ title: product.title, dims: product.dimsCm, mode, imageSrc: product.image?.src ?? null }}
        />
      </div>
    </main>
  );
}
