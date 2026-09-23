/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Snap to shop: a photograph of something, and what the shop has like it.
 */

import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { SnapToShop } from "@/components/snap/snap-to-shop";
import { SmartLink } from "@/components/ui/smart-link";
import { requireLocale } from "@/i18n/params";
import { routing } from "@/i18n/routing";
import { COLORS, colorLabel } from "@/lib/search/vocabulary";

/**
 * docs/adr/024. The photograph is measured, not sent anywhere, and the words
 * it becomes are shown before the results, so a shopper can correct them by
 * typing rather than wondering what happened.
 */

export async function generateMetadata({ params }: PageProps<"/[locale]/snap">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "snap" });
  return {
    title: t("title"),
    description: t("lede"),
    alternates: {
      canonical: `/${locale}/snap`,
      languages: Object.fromEntries(routing.locales.map((candidate) => [candidate, `/${candidate}/snap`])),
    },
  };
}

export default async function SnapPage({ params }: PageProps<"/[locale]/snap">) {
  const locale = await requireLocale(params);
  const t = await getTranslations("snap");
  const colourLabels = Object.fromEntries(Object.keys(COLORS).map((id) => [id, colorLabel(id, locale)]));

  return (
    <main className="mx-auto w-full max-w-[52rem] px-6 py-10 md:px-10 md:py-16" data-agent-id="snap:page">
      <h1 className="font-display text-3xl">{t("title")}</h1>
      <p className="text-slate mt-3 max-w-[70ch]">{t("lede")}</p>
      <ul className="text-slate mt-4 flex max-w-[70ch] list-disc flex-col gap-1 pl-5 text-sm">
        <li>{t("promises.colours")}</li>
        <li>{t("promises.here")}</li>
        <li>
          {t("promises.day")}{" "}
          <SmartLink href="/privacy" className="underline underline-offset-4">
            {t("promises.privacyLink")}
          </SmartLink>
        </li>
      </ul>

      <SnapToShop colourLabels={colourLabels} />
    </main>
  );
}
