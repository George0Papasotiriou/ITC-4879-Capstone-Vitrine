/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * UI tools: the Concierge moves the page by returning commands (navigate, filter, highlight, show, open a viewer), never code.
 */

import { z } from "zod";

import { brief, inOrder, productBriefSchema } from "@/lib/ai/tools/briefs";
import type { VitrineTool } from "@/lib/ai/tools/types";
import { agentIdSchema, isAllowedRoute, uiCommandSchema, type UiCommand } from "@/lib/ai/ui-commands";
import { comfortPatchSchema } from "@/lib/comfort/settings";
import { EMPTY_LISTING, listingQuery, SORTS, type Sort } from "@/lib/catalog/listing";
import { CATEGORY_SLUGS, type CategorySlug } from "@/lib/catalog/taxonomy";
import { COLORS, MATERIALS } from "@/lib/search/vocabulary";

/**
 * The page runs these commands through the Spotlight, which shows each one,
 * validates it again and records it with an undo (src/lib/ai/ui-commands.ts,
 * src/components/concierge/spotlight.tsx). Navigation goes only to the
 * allowlisted shop pages, whatever the model asks for.
 */

const define = <I, O>(tool: VitrineTool<I, O>) => tool;
const caption = z.string().trim().min(3).max(80).describe("What the shopper sees while it happens, in their language, e.g. \"Opening the cart\"");
const commandsOutput = z.object({ commands: z.array(uiCommandSchema) });

/** Every command passes the same schema the page will check, so a bad one fails here, not in the browser. */
const commands = (...list: UiCommand[]) => ({ commands: list.map((command) => uiCommandSchema.parse(command)) });

export const navigate = define({
  name: "navigate",
  description:
    "Open a page of the shop: the home page, a category (/c/lighting), a product (/p/<slug>), search (/search?q=…), the cart, checkout, the room planner, the Budget Stylist or the account. " +
    "Use it when the shopper asks to go somewhere. Do not use it to filter a category (use set_filters) or for anything outside the shop.",
  scope: "ui",
  input: z.object({ href: z.string().max(300).refine(isAllowedRoute, "Only pages of this shop."), caption }),
  output: commandsOutput,
  async run(_ctx, { href, caption: text }) {
    return commands({ type: "navigate", href, caption: text });
  },
});

const COLOR_IDS = Object.keys(COLORS) as [string, ...string[]];
const MATERIAL_IDS = Object.keys(MATERIALS) as [string, ...string[]];

export const setFilters = define({
  name: "set_filters",
  description:
    "Show a category, or the whole collection, filtered: colours, materials, a price range in euros, only what is in stock, and a sort order. " +
    "Use it when the shopper wants to browse with conditions. Do not use it for free-text search (use search_products).",
  scope: "ui",
  input: z.object({
    category: z.enum(CATEGORY_SLUGS as [CategorySlug, ...CategorySlug[]]).optional(),
    colors: z.array(z.enum(COLOR_IDS)).max(6).optional(),
    materials: z.array(z.enum(MATERIAL_IDS)).max(6).optional(),
    minEuros: z.number().int().min(0).max(100_000).optional(),
    maxEuros: z.number().int().min(1).max(100_000).optional(),
    inStock: z.boolean().optional(),
    sort: z.enum(SORTS as unknown as [Sort, ...Sort[]]).optional(),
    caption,
  }),
  output: commandsOutput,
  async run(_ctx, input) {
    const [low, high] = input.minEuros !== undefined && input.maxEuros !== undefined && input.minEuros > input.maxEuros ? [input.maxEuros, input.minEuros] : [input.minEuros, input.maxEuros];
    const query = listingQuery({
      ...EMPTY_LISTING,
      colors: [...new Set(input.colors ?? [])].sort(),
      materials: [...new Set(input.materials ?? [])].sort(),
      minCents: low === undefined ? null : low * 100,
      maxCents: high === undefined ? null : high * 100,
      inStock: input.inStock ?? false,
      sort: input.sort ?? "featured",
    });
    return commands({ type: "navigate", href: `/c${input.category === undefined ? "" : `/${input.category}`}${query}`, caption: input.caption });
  },
});

export const highlight = define({
  name: "highlight",
  description:
    "Point at something on the current page, by the target id listed in the page map (for example product:<id> or nav:cart). " +
    "Use it to show the shopper where something is. Do not use it for targets that are not in the page map.",
  scope: "ui",
  input: z.object({ agentId: agentIdSchema, caption }),
  output: commandsOutput,
  async run(_ctx, { agentId, caption: text }) {
    return commands({ type: "highlight", agentId, caption: text });
  },
});

export const showProducts = define({
  name: "show_products",
  description:
    "Show products to the shopper as cards in the Concierge panel, with their photos and prices from the shop. " +
    "Use it after finding products the shopper should look at. Do not describe prices in your answer; the cards show them.",
  scope: "ui",
  input: z.object({ productIds: z.array(z.uuid()).min(1).max(12), caption }),
  output: commandsOutput.extend({ products: z.array(productBriefSchema) }),
  async run(ctx, { productIds, caption: text }) {
    const cards = inOrder(productIds, await ctx.services.cards(productIds));
    return { ...commands({ type: "show_products", productIds: cards.map((card) => card.id), caption: text }), products: cards.map(brief) };
  },
});

export const adjustComfort = define({
  name: "adjust_comfort",
  description:
    "Change how the shop looks and moves for this shopper, on this device: text size (text: 100, 112, 125 or 150), spacing (wide), contrast (more), a more readable font (readable), motion (reduce, full or system), underlined links (underline), larger buttons (targets: large), a reading guide (guide: on), keyboard shortcuts (on or off). " +
    "Use it when the shopper says the text is too small, it is hard to read, the animations bother them, or asks for any of these by name. Never change them unasked, and say they can change them back with the Aa button at the top or undo it.",
  scope: "ui",
  input: z.object({ settings: comfortPatchSchema, caption }),
  output: commandsOutput,
  async run(_ctx, { settings, caption: text }) {
    return commands({ type: "comfort", agentId: "nav:comfort", settings, caption: text });
  },
});

export const openViewer = define({
  name: "open_viewer",
  description:
    "Open a way of seeing a product: \"room\" places it in a photo of the shopper's room at true size; \"ar\" and \"model\" show it in 3D where the product has a 3D model. " +
    "Use it when the shopper wants to see how a piece looks in their space. Do not use it for products you have no id for.",
  scope: "ui",
  input: z.object({ productId: z.uuid(), viewer: z.enum(["room", "ar", "model"]), caption }),
  output: commandsOutput,
  async run(ctx, { productId, viewer, caption: text }) {
    const [card] = await ctx.services.cards([productId]);
    if (card === undefined) return { commands: [] };
    // The room planner takes the product by its address; 3D and AR open on the product page (Phase 9).
    const href = viewer === "room" ? `/room?product=${card.slug}` : `/p/${card.slug}?view=${viewer}`;
    return commands({ type: "navigate", href, caption: text });
  },
});
