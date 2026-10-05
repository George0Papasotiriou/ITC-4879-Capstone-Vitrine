/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The Fitting Room: try clothes, shoes, bags and accessories on your own photograph — one piece or a whole outfit — with the photograph kept for a day.
 */

import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { FittingRoom, type TryOnGroup, type TryOnPiece } from "@/components/fitting/fitting-room";
import { SmartLink } from "@/components/ui/smart-link";
import { requireLocale } from "@/i18n/params";
import { routing } from "@/i18n/routing";
import { currentUser } from "@/lib/auth/session";
import { sameOriginImage } from "@/lib/catalog/media-url";
import { getFeatured, getProduct } from "@/lib/catalog/server";
import { CATEGORIES } from "@/lib/catalog/taxonomy";
import { canAnimate } from "@/lib/fitting/driver";
import { currentStudioMode } from "@/lib/fitting/server";

/**
 * docs/adr/023, docs/adr/063. The page is rendered for the shopper because
 * the Fitting Room is about their own photograph; the pieces it offers come
 * from the catalogue, so a piece that sells out or is withdrawn leaves it by
 * itself. A piece the shopper came from (`?piece=<slug>`) comes first.
 */

const GROUPS = [
  { category: "wear", limit: 12 },
  { category: "shoes", limit: 8 },
  { category: "bags", limit: 6 },
  { category: "accessories", limit: 6 },
] as const;

export async function generateMetadata({ params }: PageProps<"/[locale]/fitting-room">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "fitting" });
  return {
    title: t("title"),
    description: t("lede"),
    alternates: {
      canonical: `/${locale}/fitting-room`,
      languages: Object.fromEntries(routing.locales.map((candidate) => [candidate, `/${candidate}/fitting-room`])),
    },
  };
}

export default async function FittingRoomPage({ params, searchParams }: PageProps<"/[locale]/fitting-room">) {
  const locale = await requireLocale(params);
  const t = await getTranslations("fitting");
  const asked = (await searchParams).piece;
  const wanted = typeof asked === "string" && asked.length <= 200 ? await getProduct(asked, locale) : null;

  const groups: TryOnGroup[] = [];
  for (const group of GROUPS) {
    const featured = await getFeatured({ locale, limit: group.limit, category: group.category, excludeIds: wanted === null ? [] : [wanted.id] });
    const pieces: TryOnPiece[] = featured.map((product) => ({
      slug: product.slug,
      title: product.title,
      // Through the shop's own image server: the page's policy allows no other host (docs/adr/046).
      image: product.image === null ? null : sameOriginImage(product.image.src, 640),
      kind: product.kind,
    }));
    if (wanted !== null && wanted.category === group.category) {
      const image = wanted.media[0] ?? null;
      pieces.unshift({ slug: wanted.slug, title: wanted.title, image: image === null ? null : sameOriginImage(image.src, 640), kind: wanted.kind });
    }
    const category = CATEGORIES.find((entry) => entry.slug === group.category);
    if (pieces.length > 0) groups.push({ id: group.category, title: locale === "el" ? (category?.nameEl ?? group.category) : (category?.nameEn ?? group.category), pieces });
  }

  return (
    <main className="mx-auto w-full max-w-[1100px] px-6 py-10 md:px-10 md:py-16" data-agent-id="fitting:page">
      <h1 className="font-display text-3xl">{t("title")}</h1>
      <p className="text-slate mt-3 max-w-[70ch]">{t("lede")}</p>
      <ul className="text-slate mt-4 flex max-w-[70ch] list-disc flex-col gap-1 pl-5 text-sm">
        <li>{t("promises.day")}</li>
        <li>{t("promises.purpose")}</li>
        <li>{t("promises.delete")}</li>
        <li>
          {t("promises.privacy")}{" "}
          <SmartLink href="/privacy" className="underline underline-offset-4">
            {t("promises.privacyLink")}
          </SmartLink>
        </li>
      </ul>
      {/* Hats, earrings and necklaces can also be worn live, through the camera, on the shopper's own device (docs/adr/065). */}
      <p className="text-slate mt-4 max-w-[70ch] text-sm">
        {t("mirrorNote")}{" "}
        <SmartLink href="/mirror" className="underline underline-offset-4" data-agent-id="fitting:mirror-link">
          {t("mirrorLink")}
        </SmartLink>
      </p>

      <FittingRoom groups={groups} focus={wanted?.slug ?? null} signedIn={(await currentUser()) !== null} canMove={canAnimate(currentStudioMode())} />
    </main>
  );
}
