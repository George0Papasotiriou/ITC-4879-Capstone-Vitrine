/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * AI pictures in the Concierge: one piece in a showroom of one style, or in the room the shopper photographed.
 */

import { z } from "zod";

import type { VitrineTool } from "@/lib/ai/tools/types";
import { uiCommandSchema } from "@/lib/ai/ui-commands";
import { roomPlacement } from "@/lib/catalog/taxonomy";
import { SCENE_STYLE_IDS, type SceneStyle } from "@/lib/pictures/pictures";

/**
 * docs/adr/053. The same pictures as the product page and the room planner,
 * through the same start (src/lib/pictures/start.ts): the guard, the
 * shopper's allowance (an account 3 a day, a guest 1) and the job. It is
 * "costly", so the shopper approves each one; a showroom scene someone has
 * already made comes back at once and spends nothing.
 *
 * "Your room" uses the photograph the shopper attached to their question — a
 * picture of what they showed, approved on the card, kept for a day like the
 * photograph itself. Without one, the tool says so rather than invent a room.
 */

const define = <I, O>(tool: VitrineTool<I, O>) => tool;

export const pictureInRoom = define({
  name: "picture_in_room",
  description:
    "Make an AI picture of one piece of furniture or decor in a room: in a showroom of one style (warm-minimal, scandinavian, dark-moody, mediterranean), or in the room in the photograph the shopper attached. " +
    "Use it when they ask to see a piece in a room, in their room, or pictured for real. It uses one of the shopper's pictures for the day (a ready showroom picture is free), so it asks first; one piece at a time. " +
    "Do not use it for clothes (that is try_on), for an exact size (open the room planner with place_in_room), or to describe what the picture shows: the shopper sees it.",
  scope: "costly",
  surfaces: ["chat", "voice", "eval"],
  input: z.object({
    productId: z.uuid().describe("A product id from a search or the page; furniture, lighting or decor."),
    room: z.enum(["photo", ...SCENE_STYLE_IDS] as ["photo", ...SceneStyle[]]).describe('A showroom style, or "photo" for the room in the photograph the shopper attached.'),
  }),
  output: z.discriminatedUnion("ok", [
    z.object({ ok: z.literal(true), pictureId: z.string(), ready: z.boolean(), slug: z.string(), title: z.string(), room: z.string(), left: z.number().int(), commands: z.array(uiCommandSchema) }),
    z.object({
      ok: z.literal(false),
      reason: z.enum(["not_found", "not_for_rooms", "no_photo", "allowance", "unavailable"]),
      commands: z.array(uiCommandSchema),
    }),
  ]),
  async run(ctx, { productId, room }) {
    const [card] = await ctx.services.details([productId]);
    if (card === undefined) return { ok: false as const, reason: "not_found" as const, commands: [] };
    if (roomPlacement(card.kind, card.dimsCm) === null) return { ok: false as const, reason: "not_for_rooms" as const, commands: [] };

    let photoId: string | null = null;
    if (room === "photo") {
      const photo = await ctx.services.snap.photo();
      if (photo === null) return { ok: false as const, reason: "no_photo" as const, commands: [] };
      photoId = photo.id;
    }

    const started = await ctx.services.pictures.start({ productId, style: room === "photo" ? null : room, photoId });
    if (!started.ok) return { ok: false as const, reason: started.reason === "allowance" ? ("allowance" as const) : ("unavailable" as const), commands: [] };
    return { ok: true as const, pictureId: started.id, ready: started.ready, slug: card.slug, title: card.title, room, left: started.left, commands: [] };
  },
});
