/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Site footer: navigation, language, region and licensing notices.
 */

import { getLocale, getTranslations } from "next-intl/server";

import { RegionFooter } from "@/components/commerce/region-control";
import { LocaleSwitch } from "@/components/shell/locale-switch";
import { Link } from "@/i18n/navigation";
import { ComfortLink } from "@/components/comfort/comfort-button";
import { CATEGORIES } from "@/lib/catalog/taxonomy";

/**
 * The footer.
 *
 * It carries the two things this project must be honest about in public: that
 * the photography is licensed for non-commercial use, and that the prices are
 * not real. A capstone that looks like a working shop has a duty to say it is
 * not one.
 */
export async function Footer() {
  const t = await getTranslations("footer");
  const locale = await getLocale();

  return (
    <footer className="border-hairline mt-24 border-t">
      <div className="mx-auto grid w-full max-w-[1440px] gap-10 px-6 py-12 md:grid-cols-4 md:px-10">
        <nav aria-label={t("shop")} className="flex flex-col gap-3">
          <h2 className="text-sm font-medium">{t("shop")}</h2>
          {/* Category names are hand-written in both languages (src/lib/catalog/taxonomy.ts),
              so the footer needs no database query on every page. */}
          {CATEGORIES.map((category) => (
            <Link
              key={category.slug}
              href={`/c/${category.slug}`}
              className="text-slate text-sm no-underline hover:underline underline-offset-4"
            >
              {locale === "el" ? category.nameEl : category.nameEn}
            </Link>
          ))}
          <Link href="/stylist" className="text-slate text-sm no-underline hover:underline underline-offset-4">
            {t("stylist")}
          </Link>
        </nav>

        <nav aria-label={t("help")} className="flex flex-col gap-3">
          <h2 className="text-sm font-medium">{t("help")}</h2>
          {[
            { href: "/shipping", label: t("shipping") },
            { href: "/privacy", label: t("privacy") },
            { href: "/contact", label: t("contact") },
            { href: "/credits", label: t("credits") },
          ].map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-slate text-sm no-underline hover:underline underline-offset-4"
            >
              {item.label}
            </Link>
          ))}
          {/* The comfort settings, for anyone who looks for them where help usually is (docs/adr/032). */}
          <ComfortLink className="text-slate text-sm" />
        </nav>

        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-medium">{t("language")}</h2>
          <LocaleSwitch />
          <h2 className="mt-4 text-sm font-medium">{t("prices")}</h2>
          <RegionFooter />
        </div>

        <div className="flex flex-col gap-3 md:text-right">
          <p className="font-display text-lg">Vitrine</p>
          <p className="text-slate text-sm">{t("capstone")}</p>
        </div>
      </div>

      <div className="border-hairline border-t">
        <p className="text-slate mx-auto w-full max-w-[1440px] px-6 py-6 text-xs md:px-10">
          {t("attribution")}
        </p>
      </div>
    </footer>
  );
}
