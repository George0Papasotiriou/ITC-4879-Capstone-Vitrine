/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Home page: hero plinth, Concierge prompt, featured products and personal recommendations.
 */

import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { HeroPlinth } from "@/components/commerce/hero-plinth";
import { ProductGrid } from "@/components/commerce/product-grid";
import { ProductImage } from "@/components/commerce/product-image";
import { ConciergePrompt } from "@/components/concierge/concierge-prompt";
import { PersonalizationControl } from "@/components/reco/personalization-control";
import { ButtonLink } from "@/components/ui/button";
import { requireLocale } from "@/i18n/params";
import { routing } from "@/i18n/routing";
import { getCardsByIds, getFeatured } from "@/lib/catalog/server";
import { recommendationsForCurrentShopper } from "@/lib/reco/server";

/**
 * Home (docs/PLAN.md 4.3).
 *
 * One lit object on a plinth, a display headline, and the Concierge prompt as
 * the call to action — the shape of a shop window rather than of a catalogue
 * index. The rail below is the Taste Graph (A2): for a shopper who has turned
 * personal recommendations on, a random walk from what they looked at, each
 * pick explained; for everyone else, what is popular, with the opt-in beside it.
 */

export async function generateMetadata({ params }: PageProps<"/[locale]">): Promise<Metadata> {
  const { locale } = await params;
  // hreflang, so each storefront is indexed in its own right rather than one
  // being treated as a duplicate of the other.
  return {
    alternates: {
      canonical: `/${locale}`,
      languages: Object.fromEntries(routing.locales.map((candidate) => [candidate, `/${candidate}`])),
    },
  };
}

export default async function HomePage({ params }: PageProps<"/[locale]">) {
  const locale = await requireLocale(params);
  const t = await getTranslations("home");

  const [hero] = await getFeatured({ locale, limit: 1, category: "lighting" });
  // The hero is left out of the rail: showing one product twice on the same
  // screen wastes a slot, and it would also give two elements the same
  // view-transition name, which makes the browser skip the transition.
  const personal = await recommendationsForCurrentShopper(8);
  const personalCards = personal.items.length > 0 ? await getCardsByIds(personal.items.map((item) => item.productId), locale) : [];
  const showPersonal = personalCards.length >= 4;
  const rail = showPersonal
    ? personalCards.filter((card) => card.id !== hero?.id)
    : await getFeatured({ locale, limit: 8, excludeIds: hero === undefined ? [] : [hero.id] });

  // "Because you viewed …", naming the seed product in the page language.
  const seedIds = [...new Set(personal.items.map((item) => item.because).filter((id): id is string => id !== null))];
  const seedTitles = new Map((showPersonal && seedIds.length > 0 ? await getCardsByIds(seedIds, locale) : []).map((card) => [card.id, card.title]));
  const notes = new Map(
    personal.items
      .filter((item) => item.because !== null && seedTitles.has(item.because))
      .map((item) => [item.productId, t("because", { title: seedTitles.get(item.because!)! })]),
  );

  return (
    <main className="mx-auto w-full max-w-[1440px] px-6 md:px-10">
      {/* ---- Hero: one lit object, and the prompt as its call to action ---- */}
      <section className="grid items-center gap-10 py-10 md:py-16 lg:grid-cols-2 lg:gap-16">
        <HeroPlinth className="aspect-[4/3] w-full lg:order-2 lg:aspect-square">
          {hero?.image == null ? null : (
            <ProductImage image={hero.image} loading="hero" sizes="(min-width: 1024px) 40vw, 90vw" />
          )}
        </HeroPlinth>

        <div className="lg:order-1">
          <p className="text-slate text-sm">{t("eyebrow")}</p>
          <h1 className="font-display mt-3 max-w-[14ch] text-4xl leading-[1.03] md:text-5xl">{t("headline")}</h1>
          <p className="text-slate mt-6 max-w-[52ch] text-lg">{t("intro")}</p>

          <ConciergePrompt className="mt-8 max-w-xl" />

          <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3">
            <ButtonLink href="/c" variant="secondary">
              {t("browseCollection")}
            </ButtonLink>
            <ButtonLink href="/stylist" variant="tertiary">
              {t("stylistLink")}
            </ButtonLink>
            <ButtonLink href="/taste" variant="tertiary">
              {t("tasteLink")}
            </ButtonLink>
          </div>
        </div>
      </section>

      {/* ---- The rail: where the Taste Graph lands in Phase 8 ---- */}
      <section className="border-hairline border-t py-12">
        <div className="flex items-baseline justify-between gap-6">
          <h2 className="font-display text-2xl">{t("forYou")}</h2>
          <p className="text-slate max-w-[48ch] text-sm">{showPersonal ? t("forYouPersonalNote") : t("forYouPopularNote")}</p>
        </div>
        {showPersonal ? null : (
          <div className="mt-4">
            <PersonalizationControl enabled={personal.personalised} compact />
          </div>
        )}

        <ProductGrid products={rail} locale={locale} className="mt-8" priorityCount={0} notes={notes} />
      </section>
    </main>
  );
}
