/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Request-scoped room boards: the store, who the visitor is to a board, and the board as a page shows it.
 */

import { connection } from "next/server";

import { knownActor } from "@/lib/ai/server";
import type { CurrentUser } from "@/lib/auth/session";
import { boardHref, boardLinkToken, roleFor, type BoardRole } from "@/lib/boards/boards";
import { createBoardStore, type Board, type BoardItem, type BoardStore } from "@/lib/boards/store";
import { getCardsByIds } from "@/lib/catalog/server";
import { cookieSecret } from "@/lib/commerce/services";
import { sql } from "@/lib/db/client";
import { publishBoard } from "@/lib/kv/live";

let store: BoardStore | undefined;

/** The board store, at request time (docs/adr/056). */
export async function boardStore(): Promise<BoardStore> {
  await connection();
  return (store ??= createBoardStore(sql));
}

/** The board and what this visitor may do with it, or null when they may not see it. */
export async function boardAccess(boardId: string, token: string | null, user: CurrentUser | null): Promise<{ board: Board; role: BoardRole } | null> {
  const board = await (await boardStore()).byId(boardId);
  if (board === null) return null;
  const actor = await knownActor(user);
  const role = roleFor(board, { actorKey: actor?.key ?? null, token }, cookieSecret());
  return role === null ? null : { board, role };
}

/** A change made: everyone with the board open reads it again. */
export const boardChanged = (boardId: string) => publishBoard(boardId, { type: "changed" });

export type BoardPiece = BoardItem & {
  slug: string;
  title: string;
  image: { src: string; alt: string } | null;
  unitCents: number;
  currency: string;
  inStock: boolean;
  dimsCm: { w: number; d: number; h: number } | null;
};

export type BoardView = {
  id: string;
  title: string;
  role: BoardRole;
  room: { name: string; wallCm: number } | null;
  pieces: BoardPiece[];
  totalCents: number;
  currency: string;
  /** Only for the owner: the two links that share it. */
  links: { view: string; edit: string } | null;
  updatedAt: string;
};

/** The board as a page shows it: prices for the visitor's country, read from the catalogue (never stored on the board). */
export async function boardView(board: Board, role: BoardRole, locale: string): Promise<BoardView> {
  const items = await (await boardStore()).items(board.id);
  const ids = items.map((item) => item.productId);
  const [cards, sizes] = await Promise.all([
    getCardsByIds(ids, locale),
    ids.length === 0 ? [] : sql<{ id: string; dims_cm: { w: number; d: number; h: number } | null }[]>`SELECT id, dims_cm FROM products WHERE id = ANY(${ids}::uuid[])`,
  ]);
  const byId = new Map(cards.map((card) => [card.id, card]));
  const dimsOf = new Map(sizes.map((row) => [row.id, row.dims_cm]));
  const pieces: BoardPiece[] = items.flatMap((item) => {
    const card = byId.get(item.productId);
    if (card === undefined) return [];
    return [
      {
        ...item,
        slug: card.slug,
        title: card.title,
        image: card.image === null ? null : { src: card.image.src, alt: card.image.alt },
        unitCents: card.price.cents,
        currency: card.price.currency,
        inStock: card.inStock,
        dimsCm: dimsOf.get(item.productId) ?? null,
      },
    ];
  });
  const secret = cookieSecret();
  return {
    id: board.id,
    title: board.title,
    role,
    room: board.room,
    pieces,
    totalCents: pieces.reduce((sum, piece) => sum + piece.unitCents * piece.quantity, 0),
    currency: pieces[0]?.currency ?? "EUR",
    links:
      role === "owner"
        ? { view: boardHref(board.id, boardLinkToken(board.id, "view", board.linkVersion, secret)), edit: boardHref(board.id, boardLinkToken(board.id, "edit", board.linkVersion, secret)) }
        : null,
    updatedAt: board.updatedAt.toISOString(),
  };
}
