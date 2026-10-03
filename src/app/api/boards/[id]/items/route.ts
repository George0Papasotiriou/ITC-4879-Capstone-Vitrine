/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The pieces on a room board: added, changed (quantity, note, place) and taken off, by the owner or an editor.
 */

import { z } from "zod";

import { currentUser } from "@/lib/auth/session";
import { boardNoteSchema, boardQuantitySchema, canEdit } from "@/lib/boards/boards";
import { boardAccess, boardChanged, boardStore } from "@/lib/boards/server";
import type { BoardItem } from "@/lib/boards/store";
import { getProduct } from "@/lib/catalog/server";
import { clientAddress } from "@/lib/geo/ip-country";
import { sharedRateLimiter } from "@/lib/kv/rate-limit";

/** docs/adr/056. Every change is the board's (an editor's link or the owner), and tells everyone with it open. */

export const runtime = "nodejs";

export type BoardItemResponse =
  | { ok: true; item: BoardItem; created: boolean }
  | { ok: true; item: BoardItem }
  | { ok: true; removed: BoardItem }
  | { ok: true; moved: true }
  | { ok: false; reason: "invalid_request" | "not_found" | "forbidden" | "full" | "slow_down" };

const perAddress = sharedRateLimiter({ name: "boards", limit: 120, windowMs: 60_000 });
const addSchema = z.object({ productId: z.uuid().optional(), slug: z.string().trim().min(1).max(200).optional(), quantity: boardQuantitySchema.optional() }).strict();
const changeSchema = z.object({ itemId: z.uuid(), quantity: boardQuantitySchema.optional(), note: boardNoteSchema.nullable().optional(), to: z.number().int().min(0).max(100).optional() }).strict();

const refuse = (reason: Extract<BoardItemResponse, { ok: false }>["reason"], status: number) => Response.json({ ok: false, reason } satisfies BoardItemResponse, { status });

async function editable(request: Request, params: Promise<{ id: string }>): Promise<{ refusal: Response } | { refusal: null; boardId: string }> {
  if (!(await perAddress(clientAddress(request.headers) ?? "unknown"))) return { refusal: refuse("slow_down", 429) };
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return { refusal: refuse("not_found", 404) };
  const found = await boardAccess(id, new URL(request.url).searchParams.get("k"), await currentUser());
  if (found === null) return { refusal: refuse("not_found", 404) };
  if (!canEdit(found.role)) return { refusal: refuse("forbidden", 403) };
  return { refusal: null, boardId: found.board.id };
}

export async function POST(request: Request, { params }: RouteContext<"/api/boards/[id]/items">): Promise<Response> {
  const board = await editable(request, params);
  if (board.refusal !== null) return board.refusal;
  const body = addSchema.safeParse(await request.json().catch(() => null));
  if (!body.success || (body.data.productId === undefined && body.data.slug === undefined)) return refuse("invalid_request", 400);
  const productId = body.data.productId ?? (await getProduct(body.data.slug!, "en"))?.id ?? null;
  if (productId === null) return refuse("not_found", 404);
  const added = await (await boardStore()).add(board.boardId, productId, body.data.quantity ?? 1).catch(() => null);
  if (added === null) return refuse("not_found", 404);
  if (!added.ok) return refuse("full", 409);
  await boardChanged(board.boardId);
  return Response.json({ ok: true, item: added.item, created: added.created } satisfies BoardItemResponse, { status: added.created ? 201 : 200 });
}

export async function PATCH(request: Request, { params }: RouteContext<"/api/boards/[id]/items">): Promise<Response> {
  const board = await editable(request, params);
  if (board.refusal !== null) return board.refusal;
  const body = changeSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return refuse("invalid_request", 400);
  const { itemId, quantity, note, to } = body.data;
  const boards = await boardStore();
  if (to !== undefined) {
    if (!(await boards.move(board.boardId, itemId, to))) return refuse("not_found", 404);
    if (quantity === undefined && note === undefined) {
      await boardChanged(board.boardId);
      return Response.json({ ok: true, moved: true } satisfies BoardItemResponse);
    }
  }
  const item = await boards.update(board.boardId, itemId, { ...(quantity === undefined ? {} : { quantity }), ...(note === undefined ? {} : { note }) });
  if (item === null) return refuse("not_found", 404);
  await boardChanged(board.boardId);
  return Response.json({ ok: true, item } satisfies BoardItemResponse);
}

export async function DELETE(request: Request, { params }: RouteContext<"/api/boards/[id]/items">): Promise<Response> {
  const board = await editable(request, params);
  if (board.refusal !== null) return board.refusal;
  const itemId = new URL(request.url).searchParams.get("item");
  if (itemId === null || !z.uuid().safeParse(itemId).success) return refuse("invalid_request", 400);
  const removed = await (await boardStore()).remove(board.boardId, itemId);
  if (removed === null) return refuse("not_found", 404);
  await boardChanged(board.boardId);
  return Response.json({ ok: true, removed } satisfies BoardItemResponse);
}
