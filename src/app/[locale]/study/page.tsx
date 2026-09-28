/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Starting a user-study session on this device with a participant code.
 */

import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { StudyStart } from "@/components/study/study-start";
import { requireLocale } from "@/i18n/params";

/** docs/adr/037. The moderator opens this page on the study device and types the participant's code. */

export async function generateMetadata({ params }: PageProps<"/[locale]/study">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "study" });
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function StudyPage({ params }: PageProps<"/[locale]/study">) {
  await requireLocale(params);
  const t = await getTranslations("study");
  return (
    <main className="mx-auto w-full max-w-[720px] px-6 py-10 md:px-10 md:py-16" data-agent-id="study:start-page">
      <h1 className="font-display text-3xl">{t("title")}</h1>
      <p className="text-slate mt-3">{t("lede")}</p>
      <StudyStart />
    </main>
  );
}
