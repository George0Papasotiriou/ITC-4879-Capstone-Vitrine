/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Localised 404 page.
 */

import { getTranslations } from "next-intl/server";

import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";

export default async function NotFound() {
  const t = await getTranslations("common");

  return (
    <main className="mx-auto w-full max-w-[1440px] px-6 py-24 md:px-10">
      <EmptyState
        title={t("notFoundTitle")}
        description={t("notFoundDescription")}
        action={
          <ButtonLink href="/" variant="secondary">
            {t("backHome")}
          </ButtonLink>
        }
      />
    </main>
  );
}
