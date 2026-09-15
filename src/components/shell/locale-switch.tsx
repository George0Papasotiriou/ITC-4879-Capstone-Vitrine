"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Language switch between English and Greek.
 */

import { useLocale, useTranslations } from "next-intl";

import { Link, usePathname } from "@/i18n/navigation";
import { routing, type Locale } from "@/i18n/routing";
import { cx as cn } from "@/lib/ui/cx";

/**
 * Language switch.
 *
 * Two links rather than a select: with two locales a dropdown adds a click and
 * hides the alternative. Each is a real link to the same page in the other
 * language, so it works without JavaScript, can be opened in a new tab, and
 * gives search engines the `hreflang` pair something to point at.
 *
 * Each label is written in its own language — "Ελληνικά", not "Greek" — because
 * the person who needs it is the one who cannot read the current one.
 */
export function LocaleSwitch({ className }: { className?: string }) {
  const t = useTranslations("footer");
  const active = useLocale();
  const pathname = usePathname();

  const labels: Record<Locale, string> = {
    en: t("english"),
    el: t("greek"),
  };

  return (
    <div className={cn("flex items-center gap-1", className)}>
      {routing.locales.map((locale) => {
        const isActive = locale === active;
        return (
          <Link
            key={locale}
            // `usePathname` from next-intl returns the path without the locale
            // prefix, so passing it straight back with a different `locale`
            // lands on the same page in the other language.
            href={pathname}
            locale={locale}
            lang={locale}
            hrefLang={locale}
            aria-current={isActive ? "true" : undefined}
            className={cn(
              "rounded-plinth px-2 py-1 text-sm no-underline",
              "transition-colors duration-quick ease-standard",
              isActive ? "text-dusk font-medium" : "text-slate hover:text-dusk",
            )}
          >
            {labels[locale]}
          </Link>
        );
      })}
    </div>
  );
}
