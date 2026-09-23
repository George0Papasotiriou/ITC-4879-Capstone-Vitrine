/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Search by photo: what the shop sees in a photograph, and what it has like it.
 */

import { z } from "zod";

import { knownActor, usageStore } from "@/lib/ai/server";
import { brief, inOrder, type ProductBrief } from "@/lib/ai/tools/briefs";
import { currentUser } from "@/lib/auth/session";
import { getCardsByIds } from "@/lib/catalog/server";
import { CATEGORY_SLUGS } from "@/lib/catalog/taxonomy";
import { photoStore } from "@/lib/photos/server";
import { readPalette, snapSearch } from "@/lib/vision/snap-server";

/**
 * Snap to shop (docs/adr/024). With no multimodal key the shop reads what it
 * can measure — the photograph's colours — names them in its own vocabulary,
 * and searches with them. It says exactly what it saw, so a shopper is never
 * left guessing why these pieces came back.
 */

export const runtime = "nodejs";

const bodySchema = z.object({
  photoId: z.uuid(),
  category: z.enum(CATEGORY_SLUGS as [string, ...string[]]).optional(),
  locale: z.enum(["en", "el"]).catch("en"),
});

export type SnapResponse =
  | {
      ok: true;
      saw: { color: string; share: number }[];
      products: ProductBrief[];
      /** True while the shop has no multimodal key and reads only colour. */
      coloursOnly: boolean;
    }
  | { ok: false; reason: "invalid_request" | "not_found" | "unreadable" };

const refuse = (reason: Extract<SnapResponse, { ok: false }>["reason"], status: number) => Response.json({ ok: false, reason } satisfies SnapResponse, { status });

export async function POST(request: Request): Promise<Response> {
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return refuse("invalid_request", 400);

  const user = await currentUser();
  // The photograph was given a moment ago, so this browser already has a name.
  const actor = await knownActor(user);
  if (actor === null) return refuse("not_found", 404);
  const photo = await (await photoStore()).byId(body.data.photoId, actor.key);
  if (photo === null || photo.kind !== "snap") return refuse("not_found", 404);

  const seen = await readPalette(photo.storageKey);
  if (seen === null) return refuse("unreadable", 400);

  const found = await snapSearch(seen, { category: body.data.category, locale: body.data.locale });
  const cards = found.length === 0 ? [] : await getCardsByIds(found, body.data.locale);
  // Recorded like any other AI feature, so /admin/ai shows what search by photo is doing.
  await (await usageStore()).record({
    feature: "snap",
    model: { provider: "drawn", id: "vitrine-palette", pricing: { kind: "tokens", inputUsdPerMillion: 0, outputUsdPerMillion: 0 } },
    surface: "snap",
    actorKey: actor.key,
    usage: { units: 1 },
  });

  return Response.json({
    ok: true,
    saw: seen.map((entry) => ({ color: entry.color, share: Math.round(entry.share * 100) / 100 })),
    products: inOrder(found, cards).map(brief),
    coloursOnly: true,
  } satisfies SnapResponse);
}
