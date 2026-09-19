/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Privacy information page.
 */

import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { InfoPage } from "@/components/shell/info-page";
import { requireLocale } from "@/i18n/params";
import { routing } from "@/i18n/routing";

export async function generateMetadata({ params }: PageProps<"/[locale]/privacy">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "pages" });
  return {
    title: t("privacyTitle"),
    alternates: {
      canonical: `/${locale}/privacy`,
      languages: Object.fromEntries(routing.locales.map((candidate) => [candidate, `/${candidate}/privacy`])),
    },
  };
}

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function PrivacyPage({ params }: PageProps<"/[locale]/privacy">) {
  await requireLocale(params);
  const t = await getTranslations("pages");

  return (
    <InfoPage title={t("privacyTitle")} intro={t("privacyIntro")}>
      <p>{t("privacyBody")}</p>
      <p>{t("privacyLocation")}</p>
      <p>{t("privacyRoom")}</p>
      <p>{t("privacyAccount")}</p>
      <p>{t("privacySearch")}</p>
    </InfoPage>
  );
}
