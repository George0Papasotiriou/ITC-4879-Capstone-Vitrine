/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Wardrobe tools: completing a look around a piece, building a capsule wardrobe, and opening the colour reading.
 */

import { z } from "zod";

import { brief, productBriefSchema } from "@/lib/ai/tools/briefs";
import type { VitrineTool } from "@/lib/ai/tools/types";
import { uiCommandSchema } from "@/lib/ai/ui-commands";
import { CAPSULE_BUDGETS } from "@/lib/stylist/wardrobe";

/**
 * docs/adr/066. The outfit builder decides; the model only asks and
 * explains. Both tools read: nothing is added to a cart, and the shopper
 * sees every piece on the page before choosing.
 */

const define = <I, O>(tool: VitrineTool<I, O>) => tool;
const caption = z.string().trim().min(3).max(80).describe("What the shopper sees while it happens, in their language, e.g. \"Opening your capsule\"");

export const completeTheLook = define({
  name: "complete_the_look",
  description:
    "Complete an outfit around one piece of clothing, shoes, a bag or an accessory: the shop's outfit builder picks a piece for every role the look needs (bottom and shoes for a top, shoes for a dress…), for the same person, matching in colour, style and formality. " +
    "Use it for \"what goes with this\", \"complete the look\", \"style this for me\". Then show the pieces. Do not use it for furniture (that is build_bundle), and do not choose the pieces yourself.",
  scope: "read",
  input: z.object({ productId: z.uuid(), budgetEuros: z.number().int().min(10).max(5_000).optional().describe("For the other pieces; by default about three times the piece's price, at least €150") }),
  output: z.discriminatedUnion("ok", [
    z.object({ ok: z.literal(true), looks: z.array(z.object({ totalCents: z.number().int(), products: z.array(productBriefSchema) })) }),
    z.object({ ok: z.literal(false), reason: z.enum(["not_found", "not_wearable", "nothing_fits"]) }),
  ]),
  async run(ctx, { productId, budgetEuros }) {
    const result = await ctx.services.wardrobe.look(productId, budgetEuros === undefined ? undefined : budgetEuros * 100);
    if (result === "not_found" || result === "not_wearable") return { ok: false as const, reason: result };
    if (result.looks.length === 0) return { ok: false as const, reason: "nothing_fits" as const };
    const cards = new Map((await ctx.services.cards([...new Set(result.looks.flatMap((look) => look.ids))])).map((card) => [card.id, card]));
    return {
      ok: true as const,
      // Totals from the prices read now, not the optimiser's (golden rule 5).
      looks: result.looks.slice(0, 2).map((look) => {
        const products = look.ids.flatMap((id) => (cards.has(id) ? [brief(cards.get(id)!)] : []));
        return { totalCents: products.reduce((sum, product) => sum + product.priceCents, 0), products };
      }),
    };
  },
});

/** The page's budgets: a request between them is taken to the nearest, so the page shows the very capsule the tool found. */
const nearestBudget = (euros: number) => CAPSULE_BUDGETS.reduce((best, value) => (Math.abs(value - euros) < Math.abs(best - euros) ? value : best));

export const buildCapsuleTool = define({
  name: "build_capsule",
  description:
    "Build a capsule wardrobe: a few clothes and shoes for women or men that all go together, chosen to make the most outfits within a budget (small: 8 pieces; medium: 12). Opens it on the capsule page and returns how many outfits it makes. " +
    "Use it for \"a capsule wardrobe\", \"a few pieces that all go together\", \"a work wardrobe for €600\". Budgets are €300, €450, €600, €800 or €1,000; another amount is taken to the nearest. Do not use it for one outfit around a piece (complete_the_look).",
  scope: "read",
  input: z.object({ for: z.enum(["women", "men"]), budgetEuros: z.number().int().min(100).max(5_000), size: z.enum(["small", "medium"]).optional(), caption }),
  output: z.discriminatedUnion("ok", [
    z.object({ ok: z.literal(true), budgetEuros: z.number().int(), pieces: z.number().int(), outfits: z.number().int(), possible: z.number().int(), totalCents: z.number().int(), productIds: z.array(z.string()), commands: z.array(uiCommandSchema) }),
    z.object({ ok: z.literal(false), reason: z.literal("budget_too_small"), budgetEuros: z.number().int(), commands: z.array(uiCommandSchema) }),
  ]),
  async run(ctx, { for: department, budgetEuros, size, caption: text }) {
    const budget = nearestBudget(budgetEuros);
    const chosenSize = size ?? "small";
    const commands = [uiCommandSchema.parse({ type: "navigate", href: `/capsule?for=${department}&budget=${budget}&size=${chosenSize}`, caption: text })];
    const result = await ctx.services.wardrobe.capsule(department, chosenSize, budget * 100);
    if (result === null) return { ok: false as const, reason: "budget_too_small" as const, budgetEuros: budget, commands };
    const cards = await ctx.services.cards(result.ids);
    const totalCents = cards.reduce((sum, card) => sum + card.price.cents, 0);
    return { ok: true as const, budgetEuros: budget, pieces: result.ids.length, outfits: result.outfits, possible: result.possible, totalCents, productIds: result.ids, commands };
  },
});

export const readMyColours = define({
  name: "read_my_colours",
  description:
    "Open the colour reading, where the shopper's camera or a photograph of them is read on their own device (nothing is sent) to suggest the colours that suit their skin, eyes and hair. " +
    "Use it for \"what colours suit me\", \"colour analysis\", \"which season am I\". Do not guess anyone's colours yourself.",
  scope: "ui",
  input: z.object({ caption }),
  output: z.object({ commands: z.array(uiCommandSchema) }),
  async run(_ctx, { caption: text }) {
    return { commands: [uiCommandSchema.parse({ type: "navigate", href: "/colours", caption: text })] };
  },
});
