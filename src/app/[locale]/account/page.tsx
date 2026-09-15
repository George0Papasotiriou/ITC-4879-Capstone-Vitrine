/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Account page with the personal recommendation privacy controls.
 */

import { getTranslations } from "next-intl/server";

import { PersonalizationControl } from "@/components/reco/personalization-control";
import { Button } from "@/components/ui/button";
import { requireLocale } from "@/i18n/params";
import { currentActor } from "@/lib/reco/server";

/** Account. Sign-in (Better Auth with passkeys and 2FA) arrives in Phase 5; privacy controls work now. */

export default async function AccountPage({ params }: PageProps<"/[locale]/account">) {
  // Validated for its side effect: an invalid locale must 404, not render.
  await requireLocale(params);

  const t = await getTranslations("account");
  const p = await getTranslations("personalization");
  const enabled = (await currentActor()) !== null;

  return (
    <main className="mx-auto w-full max-w-[1440px] px-6 py-10 md:px-10 md:py-16">
      <h1 className="font-display text-3xl">{t("title")}</h1>
      <p className="text-slate mt-4 max-w-[52ch]">{t("signInDescription")}</p>
      <div className="mt-8">
        <Button disabled>{t("signIn")}</Button>
      </div>

      <section className="border-hairline mt-16 border-t pt-10" aria-labelledby="privacy-heading">
        <h2 id="privacy-heading" className="font-display text-2xl">{t("privacy")}</h2>
        <h3 className="mt-6 text-base font-medium">{p("title")}</h3>
        <div className="mt-3">
          <PersonalizationControl enabled={enabled} />
        </div>
      </section>
    </main>
  );
}
