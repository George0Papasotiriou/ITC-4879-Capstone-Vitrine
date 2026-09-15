/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Generates sitemap.xml with every page in both languages.
 */

import type { MetadataRoute } from "next";

import { serverEnv } from "@/env";
import { routing } from "@/i18n/routing";
import { getProductSlugs } from "@/lib/catalog/server";
import { CATEGORIES } from "@/lib/catalog/taxonomy";

/**
 * sitemap.xml (docs/PLAN.md Phase 3, step 8): home, the collection, every
 * category and every active product, each in both languages with hreflang
 * alternates, so search engines index the Greek and English pages as
 * translations of each other rather than as duplicates.
 *
 * Read from the database per request, so a product added by an import appears
 * without a rebuild.
 */
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = serverEnv().APP_URL;
  const products = await getProductSlugs();

  const entry = (path: string, lastModified?: Date, priority?: number): MetadataRoute.Sitemap => {
    const languages = Object.fromEntries(routing.locales.map((locale) => [locale, new URL(`/${locale}${path}`, origin).toString()]));
    return routing.locales.map((locale) => ({
      url: languages[locale]!,
      lastModified,
      priority,
      alternates: { languages },
    }));
  };

  return [
    ...entry("", undefined, 1),
    ...entry("/c", undefined, 0.8),
    ...CATEGORIES.flatMap((category) => entry(`/c/${category.slug}`, undefined, 0.8)),
    ...products.flatMap((product) => entry(`/p/${product.slug}`, product.updatedAt, 0.6)),
    ...["/credits", "/shipping", "/privacy", "/contact"].flatMap((path) => entry(path, undefined, 0.2)),
  ];
}
