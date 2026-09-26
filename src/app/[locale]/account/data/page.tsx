/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * "What we know about you": the shopper's own data, read from where it is kept, with a delete for every line.
 */

import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { DataLedger } from "@/components/prefs/data-ledger";
import { requireLocale } from "@/i18n/params";
import { myData } from "@/lib/prefs/ledger";
import { COLORS, colorLabel, MATERIALS, materialLabel } from "@/lib/search/vocabulary";

/** docs/adr/033. Open to guests too: a guest's device holds data about them as well. */

export async function generateMetadata({ params }: PageProps<"/[locale]/account/data">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "ledger" });
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function DataPage({ params }: PageProps<"/[locale]/account/data">) {
  const locale = await requireLocale(params);
  const t = await getTranslations("ledger");
  const ledger = await myData(locale === "el" ? "el" : "en");
  const labels = {
    colors: Object.fromEntries(Object.keys(COLORS).map((id) => [id, colorLabel(id, locale)])),
    materials: Object.fromEntries(Object.keys(MATERIALS).map((id) => [id, materialLabel(id, locale)])),
  };

  return (
    <main className="mx-auto w-full max-w-[900px] px-6 py-10 md:px-10 md:py-16" data-agent-id="ledger:page">
      <h1 className="font-display text-3xl">{t("title")}</h1>
      <p className="text-slate mt-3 max-w-[60ch]">{t("lede")}</p>
      <div className="mt-12">
        <DataLedger ledger={ledger} labels={labels} />
      </div>
    </main>
  );
}
