/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Room boards in PostgreSQL: a shopper's boards, their pieces in order, and every change to them.
 */

import type postgres from "postgres";
import { uuidv7 } from "uuidv7";

import { MAX_BOARDS, MAX_ITEMS } from "@/lib/boards/boards";

/**
 * docs/adr/056. Who may call what is decided before the store is reached
 * (src/lib/boards/boards.ts roleFor); the store keeps the board's own rules:
 * at most MAX_BOARDS a shopper and MAX_ITEMS pieces a board, one line per
 * piece (adding it again adds to its quantity), positions without gaps, and
 * `updated_at` moved on by every change, so "my boards" lists the latest first.
 */

export type Board = { id: string; ownerKey: string; title: string; room: { name: string; wallCm: number } | null; linkVersion: number; createdAt: Date; updatedAt: Date };
export type BoardItem = { id: string; boardId: string; productId: string; quantity: number; note: string | null; position: number };
export type BoardSummary = Board & { items: number; productIds: string[] };

type Sql = postgres.Sql<Record<string, unknown>>;

const toBoard = (row: Record<string, unknown>): Board => ({
  id: row.id as string,
  ownerKey: row.owner_key as string,
  title: row.title as string,
  room: row.room_name == null || row.room_wall_cm == null ? null : { name: row.room_name as string, wallCm: Number(row.room_wall_cm) },
  linkVersion: Number(row.link_version),
  createdAt: new Date(row.created_at as string),
  updatedAt: new Date(row.updated_at as string),
});

const toItem = (row: Record<string, unknown>): BoardItem => ({
  id: row.id as string,
  boardId: row.board_id as string,
  productId: row.product_id as string,
  quantity: Number(row.quantity),
  note: (row.note as string | null) ?? null,
  position: Number(row.position),
});

export function createBoardStore(sql: Sql, { maxItems = MAX_ITEMS }: { maxItems?: number } = {}) {
  async function touch(tx: Sql | postgres.TransactionSql<Record<string, unknown>>, boardId: string) {
    await tx`UPDATE boards SET updated_at = now() WHERE id = ${boardId}`;
  }

  /** A new board, unless the shopper already has MAX_BOARDS (the count and the insert are one statement). */
  async function create(ownerKey: string, title: string): Promise<{ ok: true; board: Board } | { ok: false; reason: "too_many" }> {
    const rows = await sql`
      INSERT INTO boards (id, owner_key, title)
      SELECT ${uuidv7()}, ${ownerKey}, ${title}
      WHERE (SELECT count(*) FROM boards WHERE owner_key = ${ownerKey}) < ${MAX_BOARDS}
      RETURNING *`;
    return rows[0] === undefined ? { ok: false, reason: "too_many" } : { ok: true, board: toBoard(rows[0]) };
  }

  async function byId(id: string): Promise<Board | null> {
    const [row] = await sql`SELECT * FROM boards WHERE id = ${id}`;
    return row === undefined ? null : toBoard(row);
  }

  /** The shopper's boards, latest change first, each with its piece count and its first four pieces for a cover. */
  async function mine(ownerKey: string): Promise<BoardSummary[]> {
    const rows = await sql`
      SELECT b.*,
             (SELECT count(*)::int FROM board_items i WHERE i.board_id = b.id) AS item_count,
             COALESCE((SELECT array_agg(i.product_id::text ORDER BY i.position) FROM (SELECT * FROM board_items WHERE board_id = b.id ORDER BY position LIMIT 4) i), '{}') AS cover
      FROM boards b WHERE b.owner_key = ${ownerKey}
      ORDER BY b.updated_at DESC, b.id`;
    return rows.map((row) => ({ ...toBoard(row), items: Number(row.item_count), productIds: row.cover as string[] }));
  }

  async function items(boardId: string): Promise<BoardItem[]> {
    const rows = await sql`SELECT * FROM board_items WHERE board_id = ${boardId} ORDER BY position, id`;
    return rows.map(toItem);
  }

  /** Adds a piece, or adds to its quantity if it is there (up to 20); refused past MAX_ITEMS pieces. */
  async function add(boardId: string, productId: string, quantity = 1): Promise<{ ok: true; item: BoardItem; created: boolean } | { ok: false; reason: "full" }> {
    return sql.begin(async (tx) => {
      const [existing] = await tx`SELECT * FROM board_items WHERE board_id = ${boardId} AND product_id = ${productId} FOR UPDATE`;
      if (existing !== undefined) {
        const [row] = await tx`UPDATE board_items SET quantity = LEAST(20, quantity + ${quantity}), updated_at = now() WHERE id = ${existing.id as string} RETURNING *`;
        await touch(tx, boardId);
        return { ok: true as const, item: toItem(row!), created: false };
      }
      // The board's row is locked so two adds at once cannot both take the last place or the same position.
      await tx`SELECT id FROM boards WHERE id = ${boardId} FOR UPDATE`;
      const [{ count, next }] = (await tx`SELECT count(*)::int AS count, COALESCE(max(position) + 1, 0)::int AS next FROM board_items WHERE board_id = ${boardId}`) as unknown as [{ count: number; next: number }];
      if (count >= maxItems) return { ok: false as const, reason: "full" as const };
      const [row] = await tx`
        INSERT INTO board_items (id, board_id, product_id, quantity, position)
        VALUES (${uuidv7()}, ${boardId}, ${productId}, ${Math.min(20, quantity)}, ${next}) RETURNING *`;
      await touch(tx, boardId);
      return { ok: true as const, item: toItem(row!), created: true };
    });
  }

  async function update(boardId: string, itemId: string, change: { quantity?: number; note?: string | null }): Promise<BoardItem | null> {
    const [row] = await sql`
      UPDATE board_items SET
        quantity = COALESCE(${change.quantity ?? null}::int, quantity),
        note = CASE WHEN ${change.note !== undefined} THEN ${change.note === undefined || change.note === "" ? null : change.note} ELSE note END,
        updated_at = now()
      WHERE id = ${itemId} AND board_id = ${boardId} RETURNING *`;
    if (row === undefined) return null;
    await touch(sql, boardId);
    return toItem(row);
  }

  /** Takes a piece off; the others close up, so positions stay 0, 1, 2… Returns what was removed, for an undo. */
  async function remove(boardId: string, itemId: string): Promise<BoardItem | null> {
    return sql.begin(async (tx) => {
      const [row] = await tx`DELETE FROM board_items WHERE id = ${itemId} AND board_id = ${boardId} RETURNING *`;
      if (row === undefined) return null;
      await tx`UPDATE board_items SET position = position - 1 WHERE board_id = ${boardId} AND position > ${Number(row.position)}`;
      await touch(tx, boardId);
      return toItem(row);
    });
  }

  /** Moves a piece to a position (clamped to the board), the pieces between shifting by one. */
  async function move(boardId: string, itemId: string, to: number): Promise<boolean> {
    return sql.begin(async (tx) => {
      const [row] = await tx`SELECT position FROM board_items WHERE id = ${itemId} AND board_id = ${boardId} FOR UPDATE`;
      if (row === undefined) return false;
      const [{ last }] = (await tx`SELECT COALESCE(max(position), 0)::int AS last FROM board_items WHERE board_id = ${boardId}`) as unknown as [{ last: number }];
      const from = Number(row.position);
      const target = Math.max(0, Math.min(last, to));
      if (target === from) return true;
      if (target < from) await tx`UPDATE board_items SET position = position + 1 WHERE board_id = ${boardId} AND position >= ${target} AND position < ${from}`;
      else await tx`UPDATE board_items SET position = position - 1 WHERE board_id = ${boardId} AND position > ${from} AND position <= ${target}`;
      await tx`UPDATE board_items SET position = ${target}, updated_at = now() WHERE id = ${itemId}`;
      await touch(tx, boardId);
      return true;
    });
  }

  async function rename(boardId: string, title: string): Promise<void> {
    await sql`UPDATE boards SET title = ${title}, updated_at = now() WHERE id = ${boardId}`;
  }

  /** The room the pieces are checked against, its wall copied from the owner's preferences; null for none. */
  async function setRoom(boardId: string, room: { name: string; wallCm: number } | null): Promise<void> {
    await sql`UPDATE boards SET room_name = ${room?.name ?? null}, room_wall_cm = ${room?.wallCm ?? null}, updated_at = now() WHERE id = ${boardId}`;
  }

  /** New links: every link given before stops working. */
  async function newLinks(boardId: string): Promise<number> {
    const [row] = await sql`UPDATE boards SET link_version = link_version + 1, updated_at = now() WHERE id = ${boardId} RETURNING link_version`;
    return Number(row?.link_version ?? 0);
  }

  async function remove_(boardId: string): Promise<void> {
    await sql`DELETE FROM boards WHERE id = ${boardId}`;
  }

  /** A guest's boards become their account's on sign-in, as their cart does. */
  async function adopt(fromKey: string, toKey: string): Promise<number> {
    const rows = await sql`UPDATE boards SET owner_key = ${toKey} WHERE owner_key = ${fromKey} RETURNING id`;
    return rows.length;
  }

  return { create, byId, mine, items, add, update, remove, move, rename, setRoom, newLinks, delete: remove_, adopt };
}

export type BoardStore = ReturnType<typeof createBoardStore>;
