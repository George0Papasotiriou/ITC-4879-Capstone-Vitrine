/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The Fitting Room: try the capsule on your own photograph, with the photograph kept for a day.
 */

import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { FittingRoom, type TryOnPiece } from "@/components/fitting/fitting-room";
import { SmartLink } from "@/components/ui/smart-link";
import { requireLocale } from "@/i18n/params";
import { routing } from "@/i18n/routing";
import { getFeatured } from "@/lib/catalog/server";

/**
 * docs/adr/023. The page is rendered for the shopper because the Fitting Room
 * is about their own photograph; the capsule it offers comes from the
 * catalogue, so a piece that sells out or is withdrawn leaves it by itself.
 */

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

export default async function FittingRoomPage({ params }: PageProps<"/[locale]/fitting-room">) {
  const locale = await requireLocale(params);
  const t = await getTranslations("fitting");
  const capsule = await getFeatured({ locale, limit: 12, category: "wear" });
  const pieces: TryOnPiece[] = capsule.map((product) => ({
    slug: product.slug,
    title: product.title,
    image: product.image?.src ?? null,
    kindLabel: product.kindLabel,
  }));

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

      <FittingRoom pieces={pieces} />
    </main>
  );
}
