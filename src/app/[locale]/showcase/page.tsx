/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Showcase mode: a themed shop window — a lit 3D room with each piece at its true size — priced as a set and bought in one tap.
 */

import type { Metadata } from "next";
import Image from "next/image";
import { getTranslations } from "next-intl/server";

import { AddToCart } from "@/components/commerce/add-to-cart";
import { ListenButton } from "@/components/comfort/listen-button";
import { AddWindow } from "@/components/display/add-window";
import { CopyLink } from "@/components/display/copy-link";
import { WindowScene, type WindowPiece } from "@/components/display/window-scene";
import { SmartLink } from "@/components/ui/smart-link";
import { requireLocale } from "@/i18n/params";
import { formatMoney, money } from "@/lib/commerce/money";
import { TEMPLATE_MOODS } from "@/lib/display/moods";
import { composeDisplay } from "@/lib/display/server";
import { displayFromParams, displayHref, THEMES } from "@/lib/display/themes";
import { cn } from "@/lib/ui/cn";

/**
 * docs/adr/040, docs/adr/048. The display is the Budget Stylist's best set for
 * the theme (src/lib/display/server.ts): every price and the total come from
 * the database in the shopper's prices. It is shown as a shopfront — a fascia
 * with the theme's name in the shop's own heading type, the window itself (a lit 3D room,
 * src/components/display/window-scene.tsx), and a riser below it holding the
 * other windows and the total. Below the shopfront, the list says everything
 * the window shows, in words, with a way to buy each piece — so the page works
 * fully by keyboard and screen reader, and "Listen" reads it all aloud.
 */

export async function generateMetadata({ params, searchParams }: PageProps<"/[locale]/showcase">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "showcase" });
  const { theme } = displayFromParams(await searchParams);
  const title = theme === null ? t("custom") : theme.title[locale === "el" ? "el" : "en"];
  return { title: `${title} · ${t("title")}`, description: t("lede") };
}

/** A photograph through the shop's own image optimizer, so the 3D room can read its pixels (same origin). */
const optimised = (src: string) => `/_next/image?url=${encodeURIComponent(src)}&w=1080&q=75`;

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
  const mood = theme?.mood ?? TEMPLATE_MOODS[request.template];
  const displayKey = theme?.id ?? `custom:${request.template}:${request.budgetCents}:${request.query ?? ""}`;

  const pieces: WindowPiece[] = display.pieces.map((piece) => ({
    id: piece.id,
    label: t("pieceLabel", { title: piece.title, size: size(piece.dimsCm) }),
    role: piece.role,
    kind: piece.kind,
    quantity: piece.quantity,
    model: piece.model?.src ?? null,
    // Only a studio photograph (on white): a room scene would put a whole room on the floor of this one.
    photo: piece.studioImage === null ? null : optimised(piece.studioImage.src),
    dims: piece.dimsCm === null ? null : { x: piece.dimsCm.w / 100, y: piece.dimsCm.h / 100, z: piece.dimsCm.d / 100 },
    placard: {
      id: piece.id,
      slug: piece.slug,
      title: piece.title,
      eyebrow: [piece.kindLabel, piece.brand].filter((part) => part !== null && part !== "").join(" · "),
      size: size(piece.dimsCm),
      materials: piece.colorLabel,
      price: euro(piece.priceCents, piece.currency),
      quantityNote: piece.quantity > 1 ? t("quantity", { count: piece.quantity }) : null,
      inStock: piece.inStock,
      image: piece.image === null ? null : { src: piece.image.src, alt: piece.image.alt },
      shownAs: piece.model === null ? "photo" : "scan",
    },
    stage: {
      id: piece.id,
      dimsCm: piece.dimsCm,
      hero: piece.hero,
      flat: piece.flat,
      title: piece.title,
      label: t("pieceLabel", { title: piece.title, size: size(piece.dimsCm) }),
      image: piece.image,
    },
  }));

  return (
    <main className="w-full pb-14" data-agent-id="page:showcase">
      {/* The shopfront: fascia, window, riser. */}
      <section aria-labelledby="display-title" className="bg-dusk text-white">
        <div className="mx-auto w-full max-w-[1440px] px-4 pt-8 pb-5 md:px-10 md:pt-11 md:pb-7">
          <p className="text-mist text-xs tracking-[0.14em] uppercase">{t("eyebrow", { mood: t(`moods.${mood}`) })}</p>
          <h1 id="display-title" className="font-display mt-2 text-3xl text-white md:text-4xl">
            {title}
          </h1>
          <p id="display-line" className="text-mist mt-3 max-w-[60ch] text-sm md:text-base">
            {line}
          </p>
        </div>

        <div className="mx-auto w-full max-w-[1600px] px-2 md:px-6">
          <div className="ring-gilt/45 relative h-[clamp(440px,72svh,640px)] overflow-hidden ring-1 md:h-[clamp(520px,78vh,860px)]">
            {display.pieces.length === 0 ? (
              <p className="text-mist grid h-full place-items-center px-6 text-center">{t("empty")}</p>
            ) : (
              <WindowScene displayKey={displayKey} template={display.template} mood={mood} pieces={pieces} windowLabel={t("windowLabel", { title })} />
            )}
          </div>
        </div>

        <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-5 px-4 py-6 md:flex-row md:items-center md:justify-between md:px-10 md:py-7">
          <nav aria-label={t("themes")} className="flex flex-wrap gap-2" data-agent-id="showcase:themes">
            {THEMES.map((entry) => (
              <SmartLink
                key={entry.id}
                href={displayHref(entry, entry.id)}
                scroll={false}
                transitionTypes={["window"]}
                aria-current={theme?.id === entry.id ? "page" : undefined}
                className={cn(
                  "rounded-full border px-3.5 py-1.5 text-sm no-underline transition-colors",
                  theme?.id === entry.id ? "border-gilt bg-gilt text-dusk" : "text-mist border-white/20 hover:border-white/45 hover:text-white",
                )}
                data-agent-id={`showcase:theme:${entry.id}`}
              >
                {entry.title[lang]}
              </SmartLink>
            ))}
          </nav>
          <div className="md:text-right">
            {display.totalCents === null ? (
              <p className="text-mist max-w-[60ch] text-sm">{t("fallback")}</p>
            ) : (
              <>
                <p className="font-display text-2xl text-white tabular-nums" data-agent-id="showcase:total">
                  {t("total", { total: euro(display.totalCents, display.pieces[0]?.currency ?? "EUR") })}
                </p>
                <p className="text-mist text-xs">{t("totalNote")}</p>
              </>
            )}
          </div>
        </div>
      </section>

      <div className="mx-auto w-full max-w-[1440px] px-4 md:px-10">
        <div className="mt-6 flex flex-wrap items-center gap-3">
          {display.pieces.length === 0 ? null : <AddWindow pieces={display.pieces.map((piece) => ({ productId: piece.id, quantity: piece.quantity, title: piece.title }))} />}
          <ListenButton targets={["display-title", "display-line", ...display.pieces.map((piece) => `piece-words-${piece.id}`)]} />
          <CopyLink />
        </div>

        <h2 className="font-display mt-12 text-xl">{t("inWindow")}</h2>
        <ol className="border-hairline divide-hairline mt-4 divide-y border-y" data-agent-id="showcase:pieces">
          {display.pieces.map((piece) => (
            <li key={piece.id} id={`piece-${piece.id}`} className="flex flex-col gap-3 py-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-center gap-4">
                {piece.image === null ? null : (
                  <span id={`piece-photo-${piece.id}`} className="bg-plinth relative size-16 shrink-0 overflow-hidden rounded-md">
                    <Image src={piece.image.src} alt="" fill sizes="64px" className="object-contain mix-blend-multiply" />
                  </span>
                )}
                <div id={`piece-words-${piece.id}`} className="min-w-0">
                  <SmartLink href={`/p/${piece.slug}`} className="font-medium" data-piece-title data-agent-id={`product:${piece.id}`}>
                    {piece.title}
                  </SmartLink>
                  <p className="text-slate text-sm">
                    {[piece.brand, piece.kindLabel, size(piece.dimsCm), piece.colorLabel].filter((part) => part !== null && part !== "").join(" · ")}
                  </p>
                  {piece.hero ? <p className="text-slate mt-1 text-xs">{t("hero")}</p> : null}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-4">
                <p className="tabular-nums">
                  {euro(piece.priceCents, piece.currency)}
                  {piece.quantity > 1 ? <span className="text-slate ml-1 text-sm">{t("quantity", { count: piece.quantity })}</span> : null}
                </p>
                <AddToCart productId={piece.id} inStock={piece.inStock} agentId={`action:add-to-cart:${piece.id}`} flightSource={`#piece-photo-${piece.id}`} />
              </div>
            </li>
          ))}
        </ol>
      </div>
    </main>
  );
}
