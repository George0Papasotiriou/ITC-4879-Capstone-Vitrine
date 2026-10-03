/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Shop the look: each piece in a photograph the shopper gave, with what the shop has like it.
 */

import { z } from "zod";

import { knownActor } from "@/lib/ai/server";
import { brief, inOrder, type ProductBrief } from "@/lib/ai/tools/briefs";
import { currentUser } from "@/lib/auth/session";
import { getCardsByIds } from "@/lib/catalog/server";
import { clientAddress } from "@/lib/geo/ip-country";
import { sharedRateLimiter } from "@/lib/kv/rate-limit";
import type { Region } from "@/lib/look/look";
import { shopTheLook } from "@/lib/look/server";
import { photoStore } from "@/lib/photos/server";
import { storage } from "@/lib/storage";

/**
 * docs/adr/054. The photograph is one the shopper gave a moment ago with its
 * consent line (POST /api/photos, kind "snap" or "room"), found only for the
 * browser that gave it and only while it lasts. The answer names where each
 * pin is and what was measured there; prices and pictures come from the
 * catalogue, never from the model.
 */

export const runtime = "nodejs";

export type LookPinView = { region: Region; kind: string | null; colours: string[]; products: ProductBrief[] };
export type LookResponse =
  | { ok: true; drawn: boolean; pins: LookPinView[] }
  | { ok: false; reason: "invalid_request" | "not_found" | "slow_down" | "off" | "kill_switch" | "budget" | "turns" | "credits" | "unreadable" | "nothing" };

const bodySchema = z.object({ photoId: z.uuid(), locale: z.enum(["en", "el"]).catch("en") });
const perAddress = sharedRateLimiter({ name: "look", limit: 10, windowMs: 60_000 });
const refuse = (reason: Extract<LookResponse, { ok: false }>["reason"], status: number) => Response.json({ ok: false, reason } satisfies LookResponse, { status });

export async function POST(request: Request): Promise<Response> {
  if (!(await perAddress(clientAddress(request.headers) ?? "unknown"))) return refuse("slow_down", 429);
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return refuse("invalid_request", 400);
  const actor = await knownActor(await currentUser());
  if (actor === null) return refuse("not_found", 404);
  const photo = await (await photoStore()).byId(body.data.photoId, actor.key);
  if (photo === null || photo.expiresAt.getTime() <= Date.now() || (photo.kind !== "snap" && photo.kind !== "room")) return refuse("not_found", 404);
  const file = await (await storage()).getObject(photo.storageKey);
  if (file === null) return refuse("not_found", 404);

  const result = await shopTheLook({ bytes: Buffer.from(file.body), mediaType: file.contentType }, { actorKey: actor.key, locale: body.data.locale });
  if (!result.ok) return refuse(result.reason, result.reason === "unreadable" || result.reason === "nothing" ? 422 : 429);
  const cards = await getCardsByIds([...new Set(result.pins.flatMap((pin) => pin.productIds))], body.data.locale);
  return Response.json({
    ok: true,
    drawn: result.drawn,
    pins: result.pins.map((pin) => ({ region: pin.region, kind: pin.kind, colours: pin.colours, products: inOrder(pin.productIds, cards).map(brief) })),
  } satisfies LookResponse);
}
