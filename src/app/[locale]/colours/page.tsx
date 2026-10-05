/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Your colours: a colour reading from the camera or a photograph, done on the device, and the shop's colours that suit it.
 */

import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { ColourReadingPanel } from "@/components/colours/colour-reading";
import { requireLocale } from "@/i18n/params";
import { routing } from "@/i18n/routing";

/** docs/adr/066. */

export async function generateMetadata({ params }: PageProps<"/[locale]/colours">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "colours" });
  return {
    title: t("title"),
    description: t("lede"),
    alternates: {
      canonical: `/${locale}/colours`,
      languages: Object.fromEntries(routing.locales.map((candidate) => [candidate, `/${candidate}/colours`])),
    },
  };
}

export default async function ColoursPage({ params }: PageProps<"/[locale]/colours">) {
  await requireLocale(params);
  const t = await getTranslations("colours");
  return (
    <main className="mx-auto w-full max-w-[1100px] px-6 py-10 md:px-10 md:py-16" data-agent-id="colours:page">
      <h1 className="font-display text-3xl">{t("title")}</h1>
      <p className="text-slate mt-3 max-w-[70ch]">{t("lede")}</p>
      <ColourReadingPanel />
    </main>
  );
}
