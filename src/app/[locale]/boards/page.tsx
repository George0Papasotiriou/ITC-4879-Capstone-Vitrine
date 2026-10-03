/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * "Your boards": the shopper's room boards, each with a cover of its first pieces, and a new one started.
 */

import type { Metadata } from "next";
import Image from "next/image";
import { getFormatter, getTranslations } from "next-intl/server";

import { NewBoard } from "@/components/boards/new-board";
import { SmartLink } from "@/components/ui/smart-link";
import { requireLocale } from "@/i18n/params";
import { knownActor } from "@/lib/ai/server";
import { currentUser } from "@/lib/auth/session";
import { boardStore } from "@/lib/boards/server";
import { getCardsByIds } from "@/lib/catalog/server";

/** docs/adr/056. A guest's boards are this browser's until they sign in; reading the page never mints a guest id. */

export async function generateMetadata({ params }: PageProps<"/[locale]/boards">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "boards" });
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function BoardsPage({ params }: PageProps<"/[locale]/boards">) {
  const locale = await requireLocale(params);
  const t = await getTranslations("boards");
  const format = await getFormatter();
  const actor = await knownActor(await currentUser());
  const boards = actor === null ? [] : await (await boardStore()).mine(actor.key);
  const cards = await getCardsByIds([...new Set(boards.flatMap((board) => board.productIds))], locale);
  const imageOf = new Map(cards.map((card) => [card.id, card.image]));

  return (
    <main className="mx-auto w-full max-w-[1280px] px-6 py-10 md:px-10 md:py-16" data-agent-id="boards:page">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-end">
        <div>
          <h1 className="font-display text-4xl md:text-5xl">{t("title")}</h1>
          <p className="text-slate mt-3 max-w-[60ch]">{t("lede")}</p>
        </div>
        <NewBoard />
      </div>

      {boards.length === 0 ? (
        <p className="text-slate border-hairline rounded-plinth mt-12 border border-dashed px-6 py-16 text-center" data-agent-id="boards:empty">
          {t("empty")}
        </p>
      ) : (
        <ul className="mt-12 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3" data-agent-id="boards:list">
          {boards.map((board) => {
            const covers = board.productIds.map((id) => imageOf.get(id)).filter((image) => image != null);
            return (
              <li key={board.id}>
                <SmartLink href={`/b/${board.id}`} className="group flex flex-col gap-3 no-underline" aria-label={t("open", { title: board.title })} data-agent-id={`boards:board:${board.id}`}>
                  <span className="bg-plinth rounded-plinth grid aspect-[4/3] grid-cols-2 grid-rows-2 gap-px overflow-hidden">
                    {[0, 1, 2, 3].map((index) => {
                      const image = covers[index];
                      return (
                        <span key={index} className="bg-plinth relative block">
                          {image === undefined ? null : <Image src={image.src} alt="" fill sizes="200px" className="object-contain p-3 transition-transform duration-[var(--duration-stage)] group-hover:scale-[1.04]" />}
                        </span>
                      );
                    })}
                  </span>
                  <span className="font-display text-xl leading-tight">{board.title}</span>
                  <span className="text-slate text-sm">
                    {t("pieces", { count: board.items })} · {t("updated", { when: format.relativeTime(board.updatedAt) })}
                  </span>
                </SmartLink>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
