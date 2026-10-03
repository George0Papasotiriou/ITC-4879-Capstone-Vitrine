/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * "Your shop": sizes, rooms, likes and a budget the shopper chooses to tell the shop, for guests and accounts alike.
 */

import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { ComfortLink } from "@/components/comfort/comfort-button";
import { WayIn } from "@/components/fit/way-in";
import { PreferencesForm } from "@/components/prefs/preferences-form";
import { PushPanel } from "@/components/prefs/push-panel";
import { SmartLink } from "@/components/ui/smart-link";
import { serverEnv } from "@/env";
import { requireLocale } from "@/i18n/params";
import { currentPreferences } from "@/lib/prefs/server";
import { COLORS, colorLabel, MATERIALS, materialLabel } from "@/lib/search/vocabulary";

/**
 * docs/adr/033. Open to guests as well as accounts: telling the shop your size
 * should not need an account. A guest's choices stay on their device; signed
 * in, they are kept on the account and follow the shopper everywhere.
 */

export async function generateMetadata({ params }: PageProps<"/[locale]/account/preferences">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "prefs" });
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function PreferencesPage({ params }: PageProps<"/[locale]/account/preferences">) {
  const locale = await requireLocale(params);
  const t = await getTranslations("prefs");
  const tf = await getTranslations("fit");
  const { preferences, signedIn } = await currentPreferences();
  // The same words the shop's filters use, in the page's language.
  const colors = Object.keys(COLORS).map((id) => ({ id, label: colorLabel(id, locale) }));
  const materials = Object.keys(MATERIALS).map((id) => ({ id, label: materialLabel(id, locale) }));

  return (
    <main className="mx-auto w-full max-w-[900px] px-6 py-10 md:px-10 md:py-16" data-agent-id="prefs:page">
      <h1 className="font-display text-3xl">{t("title")}</h1>
      <p className="text-slate mt-3 max-w-[60ch]">{t("lede")}</p>
      <p className="text-slate mt-2 max-w-[60ch] text-sm" data-agent-id="prefs:kept">
        {signedIn ? t("keptAccount") : t("keptDevice")}{" "}
        {signedIn ? null : (
          <SmartLink href="/account/sign-in?next=/account/preferences" className="underline underline-offset-4">
            {t("signIn")}
          </SmartLink>
        )}
      </p>
      <nav aria-label={t("related")} className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <SmartLink href="/account/data" className="underline underline-offset-4" data-agent-id="prefs:data-link">
          {t("dataLink")}
        </SmartLink>
        <ComfortLink />
      </nav>

      <div className="mt-12">
        <PreferencesForm initial={preferences} colors={colors} materials={materials} />
      </div>

      {/* The way into their home, for "will it get in?" on every piece (docs/adr/055). */}
      <section id="way-in" aria-labelledby="way-in-heading" className="border-hairline mt-12 flex scroll-mt-24 flex-col gap-3 border-t pt-8" data-agent-id="prefs:way-in">
        <h2 id="way-in-heading" className="font-display text-2xl">
          {tf("preferencesTitle")}
        </h2>
        <p className="text-slate max-w-[60ch] text-sm">{tf("preferencesLede")}</p>
        <WayIn box={null} saved={preferences.wayIn} agentScope="prefs-fit" />
      </section>

      {/* Notifications on this device (docs/adr/044): offered only when the shop has its VAPID keys. */}
      <section aria-labelledby="push-heading" className="border-hairline mt-12 flex flex-col gap-3 border-t pt-8">
        <h2 id="push-heading" className="font-display text-2xl">
          {t("push.title")}
        </h2>
        <p className="text-slate max-w-[60ch] text-sm">{t("push.lede")}</p>
        <PushPanel publicKey={serverEnv().vapid?.publicKey ?? null} signedIn={signedIn} />
      </section>
    </main>
  );
}
