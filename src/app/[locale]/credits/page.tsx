/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Credits page listing data sources, licences and attributions.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

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

/**
 * The depth model for paper-free room placement, when it is installed
 * (`pnpm depth-model`). Attribution is owed only for what the shop actually
 * serves, so the line appears with the files and not before.
 */
async function depthModel(): Promise<{ name: string; licence: string } | null> {
  try {
    const manifest = JSON.parse(await readFile(path.join("public", "models", "depth", "manifest.json"), "utf8")) as {
      name?: string;
      licence?: string;
    };
    return manifest.name === undefined ? null : { name: manifest.name, licence: manifest.licence ?? "see the model's own licence" };
  } catch {
    return null;
  }
}

export default async function CreditsPage({ params }: PageProps<"/[locale]/credits">) {
  await requireLocale(params);
  const t = await getTranslations("pages");
  const model = await depthModel();

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
      {model === null ? null : <p>{t("creditsDepthModel", model)}</p>}
      <p>{t("creditsType")}</p>
    </InfoPage>
  );
}
