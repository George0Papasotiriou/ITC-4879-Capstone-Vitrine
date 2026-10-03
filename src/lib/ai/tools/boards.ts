/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Room boards in the Concierge: a piece put on one of the shopper's boards, at once, with undo.
 */

import { z } from "zod";

import type { VitrineTool } from "@/lib/ai/tools/types";
import { uiCommandSchema } from "@/lib/ai/ui-commands";

/**
 * docs/adr/056. Like a cart change, it runs at once and the dock offers an
 * undo (the board's own API, which knows the shopper is its owner). The
 * board is the one the shopper names, else their latest, else a new one — a
 * board is a collection they keep and can share, never a cart: nothing is
 * bought or reserved by it.
 */

const define = <I, O>(tool: VitrineTool<I, O>) => tool;

export const addToBoard = define({
  name: "add_to_board",
  description:
    "Put a piece on one of the shopper's room boards — a collection for one room they keep, see the total of, and can share with someone to look or to change it with them: the board they name, else their latest, else a new one with that name. " +
    "Use it for \"save this for the living room\", \"add it to my board\", \"keep these together\". It runs at once and can be undone. Do not use it to buy (that is add_to_cart) or to remember what they like (remember_preference).",
  scope: "cart",
  surfaces: ["chat", "voice", "eval"],
  input: z.object({
    productId: z.uuid().describe("A product id from a search or the page."),
    board: z.string().trim().min(1).max(80).optional().describe("The board's name, when the shopper says one (\"the bedroom board\")."),
  }),
  output: z.discriminatedUnion("ok", [
    z.object({
      ok: z.literal(true),
      boardId: z.string(),
      board: z.string(),
      title: z.string(),
      itemId: z.string(),
      created: z.boolean(),
      createdBoard: z.boolean(),
      quantity: z.number().int(),
      commands: z.array(uiCommandSchema),
    }),
    z.object({ ok: z.literal(false), reason: z.enum(["not_found", "too_many", "full"]), commands: z.array(uiCommandSchema) }),
  ]),
  async run(ctx, { productId, board }) {
    const [card] = await ctx.services.cards([productId]);
    if (card === undefined) return { ok: false as const, reason: "not_found" as const, commands: [] };
    const defaultTitle = ctx.locale === "el" ? "Ο πίνακάς μου" : "My board";
    const added = await ctx.services.boards.add({ productId, board, defaultTitle });
    if (!added.ok) return { ok: false as const, reason: added.reason, commands: [] };
    return { ok: true as const, boardId: added.boardId, board: added.title, title: card.title, itemId: added.itemId, created: added.created, createdBoard: added.createdBoard, quantity: added.quantity, commands: [] };
  },
});
