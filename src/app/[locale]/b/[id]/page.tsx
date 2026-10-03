/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * A room board's page, for its owner and for anyone with one of its links.
 */

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { z } from "zod";

import { BoardRoom } from "@/components/boards/board-room";
import { requireLocale } from "@/i18n/params";
import { currentUser } from "@/lib/auth/session";
import { boardAccess, boardView } from "@/lib/boards/server";
import { currentRegion } from "@/lib/commerce/region";
import { currentPreferences } from "@/lib/prefs/server";

/**
 * docs/adr/056. `?k=` carries the link; the owner needs none. A board this
 * visitor may not see is "not found", the same as one that does not exist, so
 * a link cannot be used to learn which boards there are.
 */

export async function generateMetadata({ params, searchParams }: PageProps<"/[locale]/b/[id]">): Promise<Metadata> {
  const { locale, id } = await params;
  const k = (await searchParams).k;
  const t = await getTranslations({ locale, namespace: "boards.board" });
  const found = z.uuid().safeParse(id).success ? await boardAccess(id, typeof k === "string" ? k : null, await currentUser()) : null;
  // Shared links are private: never in a search engine.
  return { title: found === null ? t("kicker") : found.board.title, robots: { index: false, follow: false } };
}

export default async function BoardPage({ params, searchParams }: PageProps<"/[locale]/b/[id]">) {
  const locale = await requireLocale(params);
  const { id } = await params;
  const k = (await searchParams).k;
  const token = typeof k === "string" ? k : null;
  if (!z.uuid().safeParse(id).success) notFound();
  const found = await boardAccess(id, token, await currentUser());
  if (found === null) notFound();
  const view = await boardView(found.board, found.role, locale);
  // The owner checks the board against their own saved rooms; nobody else sees those.
  const rooms = found.role === "owner" ? (await currentPreferences()).preferences.rooms.map((room) => room.name) : [];
  const country = new Intl.DisplayNames([locale], { type: "region" }).of((await currentRegion()).country) ?? (await currentRegion()).country;

  return (
    <main className="mx-auto w-full max-w-[1280px] px-6 py-10 md:px-10 md:py-14" data-agent-id="board:page">
      <BoardRoom initial={view} token={found.role === "owner" ? null : token} rooms={rooms} country={country} />
    </main>
  );
}
