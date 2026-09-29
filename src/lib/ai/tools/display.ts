/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The Concierge opens a shop window: a themed display built by the Budget Stylist.
 */

import { z } from "zod";

import type { VitrineTool } from "@/lib/ai/tools/types";
import { uiCommandSchema } from "@/lib/ai/ui-commands";
import { displayHref, THEMES, type DisplayRequest } from "@/lib/display/themes";
import { TEMPLATE_IDS, type TemplateId } from "@/lib/optimize/templates";

const define = <I, O>(tool: VitrineTool<I, O>) => tool;
const caption = z.string().trim().min(3).max(80).describe("What the shopper sees while it happens, in their language, e.g. \"Setting up the window\"");
const THEME_IDS = THEMES.map((theme) => theme.id) as [string, ...string[]];

/**
 * docs/adr/040. One of the curated windows, or one made from a room, a budget
 * and a few words. The pieces come from the Budget Stylist, like build_bundle,
 * and the answer is only their ids and the window's link: the page shows the
 * prices and the total from the database (CLAUDE.md rule 5).
 */
export const composeShowcase = define({
  name: "compose_showcase",
  description:
    "Open a shop window (Showcase mode): a full-screen display of pieces that go together, at true relative size, that the shopper can buy in one tap. " +
    "Name a curated window with `theme`, or make one from `template`, `budgetEuros` and a few `words` for the look. " +
    "Use it for \"show me a window\", \"inspire me\", \"what would a cosy reading corner look like\". Do not use it to find one product (search_products), and use build_bundle instead when the shopper wants to compare several sets in the chat.",
  scope: "ui",
  input: z.object({
    theme: z.enum(THEME_IDS).optional(),
    template: z.enum(TEMPLATE_IDS as [TemplateId, ...TemplateId[]]).optional(),
    budgetEuros: z.number().int().min(10).max(50_000).optional(),
    words: z.string().trim().min(1).max(60).optional(),
    caption,
  }),
  output: z.object({ href: z.string(), productIds: z.array(z.string()), found: z.boolean(), commands: z.array(uiCommandSchema) }),
  async run(ctx, { theme, template, budgetEuros, words, caption: text }) {
    const named = THEMES.find((entry) => entry.id === theme);
    const request: DisplayRequest =
      named ?? (template !== undefined && budgetEuros !== undefined ? { template, budgetCents: budgetEuros * 100, ...(words === undefined ? {} : { query: words }) } : THEMES[0]!);
    const result = await ctx.services.bundles({ template: request.template, budgetCents: request.budgetCents, avoidColors: [], query: request.query });
    const productIds = result.bundles[0]?.picks.map((pick) => pick.productId) ?? [];
    const href = named !== undefined || request === THEMES[0] ? displayHref(request, (named ?? THEMES[0]!).id) : displayHref(request);
    return { href, productIds, found: productIds.length > 0, commands: [uiCommandSchema.parse({ type: "navigate", href, caption: text })] };
  },
});
