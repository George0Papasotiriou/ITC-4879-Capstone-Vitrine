/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Offline fallback page served by the service worker when a navigation fails.
 */

import { getTranslations } from "next-intl/server";

import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";
import { requireLocale } from "@/i18n/params";
import { routing } from "@/i18n/routing";

/**
 * Offline fallback, served by the service worker when a navigation fails.
 *
 * It is a real page in both locales rather than a static HTML file, so somebody
 * who loses signal on the Greek storefront does not suddenly get English.
 */
export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function OfflinePage({ params }: PageProps<"/[locale]/offline">) {
  // Validated for its side effect: an invalid locale must 404, not render.
  await requireLocale(params);

  const t = await getTranslations("common");
  const offline = await getTranslations("offline");

  return (
    <main className="mx-auto w-full max-w-[1440px] px-6 py-24 md:px-10">
      <EmptyState
        title={offline("title")}
        description={offline("description")}
        action={
          <ButtonLink href="/" variant="secondary">
            {t("tryAgain")}
          </ButtonLink>
        }
      />
    </main>
  );
}
