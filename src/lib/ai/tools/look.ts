/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Shop the look in the Concierge: every piece in the photograph the shopper attached, with the shop's closest pieces for each.
 */

import { z } from "zod";

import { productBriefSchema } from "@/lib/ai/tools/briefs";
import type { VitrineTool } from "@/lib/ai/tools/types";
import { uiCommandSchema } from "@/lib/ai/ui-commands";

/**
 * docs/adr/054. The same pipeline as the Snap page's "Shop the look": the
 * model finds and names the pieces, the shop measures each one's colours and
 * searches its own catalogue. One model call per photograph, inside the
 * shop's guard; without a model it says it read the whole photograph's
 * colours instead.
 */

const define = <I, O>(tool: VitrineTool<I, O>) => tool;

export const shopTheLookTool = define({
  name: "shop_the_look",
  description:
    "Find each piece in the photograph the shopper attached — the sofa, the lamp, the rug — and the shop's closest pieces for every one, searched in the colours the shop measures there. " +
    "Use it for \"shop this look\", \"find everything in this photo\", \"get me this room\". Do not use it for one kind of piece in the photo's colours (find_by_photo is lighter), and never describe people or anything private in the photograph.",
  scope: "read",
  surfaces: ["chat", "voice", "eval"],
  input: z.object({}),
  output: z.discriminatedUnion("ok", [
    z.object({
      ok: z.literal(true),
      drawn: z.boolean(),
      pieces: z.array(z.object({ kind: z.string().nullable(), colours: z.array(z.string()), products: z.array(productBriefSchema) })),
      commands: z.array(uiCommandSchema),
    }),
    z.object({ ok: z.literal(false), reason: z.enum(["no_photo", "nothing", "unavailable"]), commands: z.array(uiCommandSchema) }),
  ]),
  async run(ctx) {
    const photo = await ctx.services.snap.photo();
    if (photo === null) return { ok: false as const, reason: "no_photo" as const, commands: [] };
    const found = await ctx.services.look.find(photo.id);
    if (!found.ok) return { ok: false as const, reason: found.reason === "nothing" ? ("nothing" as const) : ("unavailable" as const), commands: [] };
    return { ok: true as const, drawn: found.drawn, pieces: found.pieces, commands: [] };
  },
});
