/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The shopper's room boards: listed, and a new one made.
 */

import { z } from "zod";

import { aiActor, knownActor } from "@/lib/ai/server";
import { currentUser } from "@/lib/auth/session";
import { boardTitleSchema } from "@/lib/boards/boards";
import { boardStore } from "@/lib/boards/server";
import { getCardsByIds } from "@/lib/catalog/server";
import { clientAddress } from "@/lib/geo/ip-country";
import { sharedRateLimiter } from "@/lib/kv/rate-limit";
import { routing } from "@/i18n/routing";

/**
 * docs/adr/056. A guest's boards are their browser's (the same guest id as
 * their cart and their pictures) until they sign in, when they become the
 * account's. Reading the list never mints a guest id.
 */

export const runtime = "nodejs";

export type BoardCard = { id: string; title: string; items: number; updatedAt: string; covers: { src: string; alt: string }[] };
export type BoardsResponse = { ok: true; boards: BoardCard[] } | { ok: true; board: { id: string } } | { ok: false; reason: "invalid_request" | "too_many" | "slow_down" };

const perAddress = sharedRateLimiter({ name: "boards", limit: 30, windowMs: 60_000 });
const locale = z.enum(routing.locales).catch(routing.defaultLocale);

export async function GET(request: Request): Promise<Response> {
  const actor = await knownActor(await currentUser());
  if (actor === null) return Response.json({ ok: true, boards: [] } satisfies BoardsResponse);
  const mine = await (await boardStore()).mine(actor.key);
  const cards = await getCardsByIds([...new Set(mine.flatMap((board) => board.productIds))], locale.parse(new URL(request.url).searchParams.get("locale")));
  const imageOf = new Map(cards.map((card) => [card.id, card.image]));
  const boards = mine.map((board) => ({
    id: board.id,
    title: board.title,
    items: board.items,
    updatedAt: board.updatedAt.toISOString(),
    covers: board.productIds.flatMap((id) => {
      const image = imageOf.get(id);
      return image == null ? [] : [{ src: image.src, alt: image.alt }];
    }),
  }));
  return Response.json({ ok: true, boards } satisfies BoardsResponse, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request): Promise<Response> {
  if (!(await perAddress(clientAddress(request.headers) ?? "unknown"))) return Response.json({ ok: false, reason: "slow_down" } satisfies BoardsResponse, { status: 429 });
  const body = z.object({ title: boardTitleSchema }).safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ ok: false, reason: "invalid_request" } satisfies BoardsResponse, { status: 400 });
  const actor = await aiActor(await currentUser());
  const created = await (await boardStore()).create(actor.key, body.data.title);
  if (!created.ok) return Response.json({ ok: false, reason: "too_many" } satisfies BoardsResponse, { status: 409 });
  return Response.json({ ok: true, board: { id: created.board.id } } satisfies BoardsResponse, { status: 201 });
}
