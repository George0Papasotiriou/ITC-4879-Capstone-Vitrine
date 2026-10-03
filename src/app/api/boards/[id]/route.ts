/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * One room board: read with a link's rights, renamed, checked against a room, given new links, or deleted.
 */

import { z } from "zod";

import { currentUser } from "@/lib/auth/session";
import { boardTitleSchema, canEdit } from "@/lib/boards/boards";
import { boardAccess, boardChanged, boardStore, boardView, type BoardView } from "@/lib/boards/server";
import { clientAddress } from "@/lib/geo/ip-country";
import { sharedRateLimiter } from "@/lib/kv/rate-limit";
import { currentPreferences } from "@/lib/prefs/server";
import { routing } from "@/i18n/routing";

/**
 * docs/adr/056. Every request says which board (`[id]`) and, unless it is the
 * owner's, which link (`?k=`). Anyone with a link may read; editors may
 * rename; only the owner chooses the room (from their own saved rooms, whose
 * wall is copied onto the board), makes new links, or deletes the board.
 * Each change tells everyone with the board open to read it again.
 */

export const runtime = "nodejs";

export type BoardResponse = { ok: true; board: BoardView } | { ok: true; deleted: true } | { ok: false; reason: "invalid_request" | "not_found" | "forbidden" | "slow_down" | "no_room" };

const locale = z.enum(routing.locales).catch(routing.defaultLocale);
const perAddress = sharedRateLimiter({ name: "boards", limit: 60, windowMs: 60_000 });
const changeSchema = z
  .object({ title: boardTitleSchema.optional(), room: z.string().trim().min(1).max(40).nullable().optional(), newLinks: z.literal(true).optional() })
  .strict();

const refuse = (reason: Extract<BoardResponse, { ok: false }>["reason"], status: number) => Response.json({ ok: false, reason } satisfies BoardResponse, { status });

async function access(request: Request, params: Promise<{ id: string }>) {
  const { id } = await params;
  const url = new URL(request.url);
  if (!z.uuid().safeParse(id).success) return null;
  const token = url.searchParams.get("k");
  const found = await boardAccess(id, token, await currentUser());
  return found === null ? null : { ...found, lang: locale.parse(url.searchParams.get("locale")) };
}

export async function GET(request: Request, { params }: RouteContext<"/api/boards/[id]">): Promise<Response> {
  const found = await access(request, params);
  if (found === null) return refuse("not_found", 404);
  return Response.json({ ok: true, board: await boardView(found.board, found.role, found.lang) } satisfies BoardResponse, { headers: { "cache-control": "no-store" } });
}

export async function PATCH(request: Request, { params }: RouteContext<"/api/boards/[id]">): Promise<Response> {
  if (!(await perAddress(clientAddress(request.headers) ?? "unknown"))) return refuse("slow_down", 429);
  const found = await access(request, params);
  if (found === null) return refuse("not_found", 404);
  const change = changeSchema.safeParse(await request.json().catch(() => null));
  if (!change.success) return refuse("invalid_request", 400);
  const { title, room, newLinks } = change.data;
  if (!canEdit(found.role) || ((room !== undefined || newLinks === true) && found.role !== "owner")) return refuse("forbidden", 403);
  const boards = await boardStore();
  if (title !== undefined) await boards.rename(found.board.id, title);
  if (room !== undefined) {
    if (room === null) await boards.setRoom(found.board.id, null);
    else {
      const saved = (await currentPreferences()).preferences.rooms.find((entry) => entry.name.toLocaleLowerCase() === room.toLocaleLowerCase());
      if (saved === undefined) return refuse("no_room", 404);
      await boards.setRoom(found.board.id, { name: saved.name, wallCm: saved.wallCm });
    }
  }
  if (newLinks === true) await boards.newLinks(found.board.id);
  await boardChanged(found.board.id);
  const board = (await boards.byId(found.board.id))!;
  return Response.json({ ok: true, board: await boardView(board, found.role, found.lang) } satisfies BoardResponse);
}

export async function DELETE(request: Request, { params }: RouteContext<"/api/boards/[id]">): Promise<Response> {
  const found = await access(request, params);
  if (found === null) return refuse("not_found", 404);
  if (found.role !== "owner") return refuse("forbidden", 403);
  await (await boardStore()).delete(found.board.id);
  await boardChanged(found.board.id);
  return Response.json({ ok: true, deleted: true } satisfies BoardResponse);
}
