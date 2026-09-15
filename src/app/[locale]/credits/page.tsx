/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Credits page listing data sources, licences and attributions.
 */

import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { InfoPage } from "@/components/shell/info-page";
import { requireLocale } from "@/i18n/params";
import { routing } from "@/i18n/routing";

export async function generateMetadata({ params }: PageProps<"/[locale]/credits">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "pages" });
  return {
    title: t("creditsTitle"),
    alternates: {
      canonical: `/${locale}/credits`,
      languages: Object.fromEntries(routing.locales.map((candidate) => [candidate, `/${candidate}/credits`])),
    },
  };
}

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function CreditsPage({ params }: PageProps<"/[locale]/credits">) {
  await requireLocale(params);
  const t = await getTranslations("pages");

  return (
    <InfoPage title={t("creditsTitle")} intro={t("creditsIntro")}>
      <p>{t("creditsDataset")}</p>
      <p>{t("creditsSynthetic")}</p>
      <p>{t("creditsTranslation")}</p>
      <p>
        {t.rich("creditsGeo", {
          link: (chunks) => (
            <a href="https://db-ip.com" rel="noopener">
              {chunks}
            </a>
          ),
        })}
      </p>
      <p>{t("creditsType")}</p>
    </InfoPage>
  );
}
