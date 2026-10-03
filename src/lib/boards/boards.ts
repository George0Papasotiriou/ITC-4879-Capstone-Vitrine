/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Room boards: who may do what with a board, and the links that give it — derived, never stored.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

/**
 * docs/adr/056. A board belongs to whoever made it (an account, or a guest's
 * browser). Two links share it:
 * - the VIEW link lets anyone with it look, and follow along live;
 * - the EDIT link lets them add, remove, note and reorder pieces with you.
 * Only the owner renames it, chooses the room it is checked against, makes
 * new links (which retires the old ones) and deletes it.
 *
 * A link is the board's id and an HMAC of `board:<id>:<role>:<version>`
 * under the shop's cookie secret — the same construction as an order's link.
 * Nothing secret is stored: the owner's page derives the links again, and
 * moving `link_version` on makes every old link fail at once.
 */

export const MAX_BOARDS = 12;
export const MAX_ITEMS = 40;

export type BoardRole = "owner" | "editor" | "viewer";
export type LinkRole = "view" | "edit";

export const boardTitleSchema = z.string().trim().min(1).max(80);
export const boardNoteSchema = z.string().trim().max(200);
export const boardQuantitySchema = z.number().int().min(1).max(20);

const TOKEN_LENGTH = 32;

export function boardLinkToken(boardId: string, role: LinkRole, version: number, secret: string): string {
  return createHmac("sha256", secret).update(`board:${boardId}:${role}:${version}`).digest("base64url").slice(0, TOKEN_LENGTH);
}

const same = (a: string, b: string) => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};

/**
 * What this visitor may do with the board: the owner by who they are, anyone
 * else by the link they came with; null when they may not see it at all.
 */
export function roleFor(board: { id: string; ownerKey: string; linkVersion: number }, visitor: { actorKey: string | null; token: string | null }, secret: string): BoardRole | null {
  if (visitor.actorKey !== null && visitor.actorKey === board.ownerKey) return "owner";
  if (visitor.token === null || visitor.token.length !== TOKEN_LENGTH) return null;
  if (same(visitor.token, boardLinkToken(board.id, "edit", board.linkVersion, secret))) return "editor";
  if (same(visitor.token, boardLinkToken(board.id, "view", board.linkVersion, secret))) return "viewer";
  return null;
}

export const canEdit = (role: BoardRole | null) => role === "owner" || role === "editor";

/** The page a link opens: the board's id in the path, the token as `k`. */
export function boardHref(boardId: string, token: string | null): string {
  return token === null ? `/b/${boardId}` : `/b/${boardId}?k=${token}`;
}
