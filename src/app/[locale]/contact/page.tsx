/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Contact information page.
 */

import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { InfoPage } from "@/components/shell/info-page";
import { requireLocale } from "@/i18n/params";
import { routing } from "@/i18n/routing";

export async function generateMetadata({ params }: PageProps<"/[locale]/contact">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "pages" });
  return {
    title: t("contactTitle"),
    alternates: {
      canonical: `/${locale}/contact`,
      languages: Object.fromEntries(routing.locales.map((candidate) => [candidate, `/${candidate}/contact`])),
    },
  };
}

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function ContactPage({ params }: PageProps<"/[locale]/contact">) {
  await requireLocale(params);
  const t = await getTranslations("pages");

  return (
    <InfoPage title={t("contactTitle")} intro={t("contactIntro")}>
      <p>{t("contactBody")}</p>
    </InfoPage>
  );
}
