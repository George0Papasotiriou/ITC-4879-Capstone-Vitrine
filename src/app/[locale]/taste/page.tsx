/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * This-or-That page that learns a new shopper's taste from pairwise choices.
 */

import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { ProductGrid } from "@/components/commerce/product-grid";
import { ProductImage } from "@/components/commerce/product-image";
import { PersonalizationControl } from "@/components/reco/personalization-control";
import { RecordTasteChoices } from "@/components/reco/record-taste-choices";
import { Price } from "@/components/ui/price";
import { SmartLink } from "@/components/ui/smart-link";
import { requireLocale } from "@/i18n/params";
import { routing } from "@/i18n/routing";
import { getCardsByIds } from "@/lib/catalog/server";
import { currentActor, tastePool } from "@/lib/reco/server";
import { nextPair, preferenceScore, preferenceVector } from "@/lib/reco/this-or-that";

/**
 * This-or-That (A2 cold start, Phase 8 step 5).
 *
 * The whole state is in the URL: `c` lists the chosen products and `r` the
 * rejected ones, round by round, and `s` pairs skipped as "neither". Each
 * choice is a link, so the quiz works without JavaScript and can be resumed.
 * After eight choices the page shows products ranked by the learned preference
 * (src/lib/reco/this-or-that.ts).
 */

const ROUNDS = 8;
const UUID = /^[0-9a-f-]{36}$/;

export async function generateMetadata({ params }: PageProps<"/[locale]/taste">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "taste" });
  return {
    title: t("title"),
    description: t("intro"),
    robots: { index: false, follow: true },
    alternates: { languages: Object.fromEntries(routing.locales.map((candidate) => [candidate, `/${candidate}/taste`])) },
  };
}

const list = (value: string | string[] | undefined) =>
  (Array.isArray(value) ? value.join(",") : (value ?? "")).split(",").filter((id) => UUID.test(id)).slice(0, 32);

export default async function TastePage({ params, searchParams }: PageProps<"/[locale]/taste">) {
  const locale = await requireLocale(params);
  const t = await getTranslations("taste");
  const search = await searchParams;

  const pool = await tastePool();
  const byId = new Map(pool.map((item) => [item.id, item]));
  const chosenIds = list(search.c).filter((id) => byId.has(id));
  const rejectedIds = list(search.r).filter((id) => byId.has(id));
  const rounds = Math.min(chosenIds.length, rejectedIds.length);
  const skipped = list(search.s).filter((id) => byId.has(id));

  const length = pool[0]?.vector.length ?? 0;
  const chosen = chosenIds.slice(0, rounds).map((id) => byId.get(id)!.vector);
  const rejected = rejectedIds.slice(0, rounds).map((id) => byId.get(id)!.vector);
  const p = rounds === 0 ? new Float64Array(length) : preferenceVector(chosen, rejected, length);
  const asked = chosen.map((vector, i) => vector.map((value, k) => value - rejected[i]![k]!));
  const shown = new Set([...chosenIds, ...rejectedIds, ...skipped]);

  const pair = rounds < ROUNDS ? nextPair(pool, p, asked, shown) : null;
  const finished = pair === null;

  const href = (next: { c?: string[]; r?: string[]; s?: string[] }) => {
    const query = new URLSearchParams();
    const c = next.c ?? chosenIds.slice(0, rounds);
    const r = next.r ?? rejectedIds.slice(0, rounds);
    const s = next.s ?? skipped;
    if (c.length > 0) query.set("c", c.join(","));
    if (r.length > 0) query.set("r", r.join(","));
    if (s.length > 0) query.set("s", s.join(","));
    const text = query.toString();
    return text === "" ? "/taste" : `/taste?${text}`;
  };

  if (!finished) {
    const [left, right] = await getCardsByIds(pair, locale);
    const cards = [left, right].filter((card) => card !== undefined);
    return (
      <main className="mx-auto w-full max-w-[1100px] px-6 py-10 md:px-10 md:py-16">
        <h1 className="font-display text-3xl">{t("title")}</h1>
        <p className="text-slate mt-3 max-w-[60ch]">{t("intro")}</p>
        <p className="text-slate tabular mt-6 text-sm" aria-live="polite">
          {t("progress", { current: rounds + 1, total: ROUNDS })}
        </p>

        <div className="mt-6 grid items-center gap-6 md:grid-cols-[1fr_auto_1fr]">
          {cards.map((card, index) => {
            const other = cards[1 - index]!;
            return (
              <div key={card.id} className={index === 1 ? "md:order-3" : undefined}>
                <SmartLink
                  href={href({ c: [...chosenIds.slice(0, rounds), card.id], r: [...rejectedIds.slice(0, rounds), other.id] })}
                  scroll={false}
                  aria-label={t("choose", { title: card.title })}
                  data-agent-id={`choice:${card.id}`}
                  className="group flex flex-col gap-3 no-underline"
                >
                  <div className="bg-plinth rounded-plinth group-hover:ring-dusk/30 relative aspect-square overflow-hidden transition-shadow group-hover:ring-2">
                    {card.image === null ? null : (
                      <div className="on-plinth absolute inset-6">
                        <ProductImage image={card.image} loading="fold" sizes="(min-width: 768px) 45vw, 90vw" />
                      </div>
                    )}
                  </div>
                  <span className="text-slate text-sm">{card.brand}</span>
                  <span className="line-clamp-2">{card.title}</span>
                  <Price amount={card.price} locale={locale} size="sm" />
                </SmartLink>
              </div>
            );
          })}
          <p className="text-slate font-display text-center text-xl md:order-2" aria-hidden="true">
            {t("or")}
          </p>
        </div>

        <p className="mt-8 flex flex-wrap gap-6 text-sm">
          <SmartLink href={href({ s: [...skipped, ...pair] })} scroll={false} className="underline-offset-4">
            {t("skip")}
          </SmartLink>
          {rounds > 0 ? (
            <SmartLink href="/taste" className="text-slate underline-offset-4">
              {t("startOver")}
            </SmartLink>
          ) : null}
        </p>
      </main>
    );
  }

  const ranked = pool
    .filter((item) => !shown.has(item.id))
    .map((item) => ({ id: item.id, score: preferenceScore(p, item.vector) }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, 8);
  const cards = await getCardsByIds(ranked.map((item) => item.id), locale);
  const consented = (await currentActor()) !== null;

  return (
    <main className="mx-auto w-full max-w-[1440px] px-6 py-10 md:px-10 md:py-16">
      <RecordTasteChoices productIds={chosenIds.slice(0, rounds)} />
      <h1 className="font-display text-3xl">{t("resultTitle")}</h1>
      <p className="text-slate mt-3 max-w-[60ch]">{rounds < ROUNDS ? t("notEnough") : t("resultIntro")}</p>
      <div className="mt-6">
        <PersonalizationControl enabled={consented} compact />
      </div>
      <ProductGrid products={cards} locale={locale} className="mt-10" />
      <p className="mt-10">
        <SmartLink href="/taste" className="underline-offset-4">
          {t("startOver")}
        </SmartLink>
      </p>
    </main>
  );
}
