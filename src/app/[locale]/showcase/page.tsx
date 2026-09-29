/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Showcase mode: a themed shop window of pieces that go together, standing at true relative size, bought in one tap.
 */

import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { AddToCart } from "@/components/commerce/add-to-cart";
import { ListenButton } from "@/components/comfort/listen-button";
import { AddWindow } from "@/components/display/add-window";
import { CopyLink } from "@/components/display/copy-link";
import { DisplayStage, type StageItem } from "@/components/display/display-stage";
import { SmartLink } from "@/components/ui/smart-link";
import { requireLocale } from "@/i18n/params";
import { formatMoney, money } from "@/lib/commerce/money";
import { composeDisplay } from "@/lib/display/server";
import { displayFromParams, displayHref, THEMES } from "@/lib/display/themes";
import { cn } from "@/lib/ui/cn";

/**
 * docs/adr/040. The display is the Budget Stylist's best set for the theme
 * (src/lib/display/server.ts): every price and the total come from the
 * database in the shopper's prices. The window above is for looking; the
 * list below it says everything the window shows, in words, with a way to
 * buy each piece — so the page works fully by keyboard and screen reader, and
 * "Listen" reads the theme and every piece aloud.
 */

export async function generateMetadata({ params, searchParams }: PageProps<"/[locale]/showcase">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "showcase" });
  const { theme } = displayFromParams(await searchParams);
  const title = theme === null ? t("custom") : theme.title[locale === "el" ? "el" : "en"];
  return { title: `${title} · ${t("title")}`, description: t("lede") };
}

export default async function ShowcasePage({ params, searchParams }: PageProps<"/[locale]/showcase">) {
  const locale = await requireLocale(params);
  const t = await getTranslations("showcase");
  const lang = locale === "el" ? "el" : "en";
  const { theme, request } = displayFromParams(await searchParams);
  const display = await composeDisplay(request, locale);
  const euro = (cents: number, currency: string) => formatMoney(money(cents, currency), locale, { hideDecimalsWhenWhole: true });
  const size = (dims: { w: number; d: number; h: number } | null) => (dims === null ? t("notMeasured") : t("dims", dims));
  const title = theme === null ? t("custom") : theme.title[lang];
  const line = theme === null ? t("customLine", { budget: euro(request.budgetCents, "EUR") }) : theme.line[lang];

  const items: StageItem[] = display.pieces.map((piece) => ({
    id: piece.id,
    dimsCm: piece.dimsCm,
    hero: piece.hero,
    flat: piece.flat,
    title: piece.title,
    label: t("pieceLabel", { title: piece.title, size: size(piece.dimsCm) }),
    image: piece.image,
  }));

  return (
    <main className="mx-auto w-full max-w-[1440px] px-6 py-10 md:px-10 md:py-14" data-agent-id="page:showcase">
      <p className="text-slate text-xs tracking-[0.08em] uppercase">{t("title")}</p>
      <h1 id="display-title" className="font-display mt-2 text-3xl md:text-4xl">
        {title}
      </h1>
      <p id="display-line" className="text-slate mt-3 max-w-[60ch]">
        {line}
      </p>

      <nav aria-label={t("themes")} className="mt-6 flex flex-wrap gap-2" data-agent-id="showcase:themes">
        {THEMES.map((entry) => (
          <SmartLink
            key={entry.id}
            href={displayHref(entry, entry.id)}
            aria-current={theme?.id === entry.id ? "page" : undefined}
            className={cn(
              "border-hairline rounded-full border px-3 py-1.5 text-sm no-underline",
              theme?.id === entry.id ? "bg-dusk text-white" : "hover:bg-dusk/[0.05]",
            )}
            data-agent-id={`showcase:theme:${entry.id}`}
          >
            {entry.title[lang]}
          </SmartLink>
        ))}
      </nav>

      <div className="mt-8">
        {display.pieces.length === 0 ? (
          <p className="text-slate">{t("empty")}</p>
        ) : (
          <DisplayStage items={items} windowLabel={t("windowLabel", { title })} />
        )}
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          {display.totalCents === null ? (
            <p className="text-slate max-w-[60ch] text-sm">{t("fallback")}</p>
          ) : (
            <>
              <p className="font-display text-2xl tabular-nums" data-agent-id="showcase:total">
                {t("total", { total: euro(display.totalCents, display.pieces[0]?.currency ?? "EUR") })}
              </p>
              <p className="text-slate text-sm">{t("totalNote")}</p>
            </>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <ListenButton targets={["display-title", "display-line", ...display.pieces.map((piece) => `piece-words-${piece.id}`)]} />
          <CopyLink />
          {display.pieces.length === 0 ? null : <AddWindow pieces={display.pieces.map((piece) => ({ productId: piece.id, quantity: piece.quantity, title: piece.title }))} />}
        </div>
      </div>

      <h2 className="font-display mt-12 text-xl">{t("inWindow")}</h2>
      <ol className="border-hairline divide-hairline mt-4 divide-y border-y" data-agent-id="showcase:pieces">
        {display.pieces.map((piece) => (
          <li key={piece.id} id={`piece-${piece.id}`} className="flex flex-col gap-3 py-5 sm:flex-row sm:items-center sm:justify-between">
            <div id={`piece-words-${piece.id}`} className="min-w-0">
              <SmartLink href={`/p/${piece.slug}`} className="font-medium" data-piece-title data-agent-id={`product:${piece.id}`}>
                {piece.title}
              </SmartLink>
              <p className="text-slate text-sm">
                {[piece.brand, piece.kindLabel, size(piece.dimsCm), piece.colorLabel].filter((part) => part !== null && part !== "").join(" · ")}
              </p>
              {piece.hero ? <p className="text-slate mt-1 text-xs">{t("hero")}</p> : null}
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <p className="tabular-nums">
                {euro(piece.priceCents, piece.currency)}
                {piece.quantity > 1 ? <span className="text-slate ml-1 text-sm">{t("quantity", { count: piece.quantity })}</span> : null}
              </p>
              <AddToCart productId={piece.id} inStock={piece.inStock} agentId={`action:add-to-cart:${piece.id}`} flightSource={`#stage-piece-${piece.id} img`} />
            </div>
          </li>
        ))}
      </ol>
    </main>
  );
}
