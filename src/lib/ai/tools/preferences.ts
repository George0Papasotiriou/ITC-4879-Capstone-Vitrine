/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Preference tools: the Concierge reads what the shopper has said about themselves, and remembers more only with their approval.
 */

import { z } from "zod";

import type { VitrineTool } from "@/lib/ai/tools/types";
import { uiCommandSchema } from "@/lib/ai/ui-commands";
import { preferencesPatchSchema, roomSchema } from "@/lib/prefs/preferences";
import { CAPSULE_SIZES } from "@/lib/catalog/taxonomy";

/**
 * docs/adr/033. Reading is ordinary: the shopper's own sizes, rooms and likes,
 * compact, for answering with them in mind. Remembering is sensitive — it
 * changes what the shop keeps about a person — so it asks first, with the
 * exact change on the approval card, and then the page saves it through the
 * same address the preferences page uses, with an undo. The model never
 * writes to the account by itself.
 */

const define = <I, O>(tool: VitrineTool<I, O>) => tool;

const caption = z.string().trim().min(3).max(80).describe("What the shopper sees while it happens, in their language, e.g. \"Remembering your size\"");

export const getPreferences = define({
  name: "get_preferences",
  description:
    "Read what the shopper has told the shop about themselves: clothing sizes (upper, lower, dress), their rooms with wall widths in cm, colours and materials they like or avoid, and the budget they are comfortable with per piece. " +
    "Use it when an answer depends on these (\"in my size\", \"will it fit my living room\", \"something I'd like\"). Do not read it out; use it. Do not use it to find other people's details.",
  scope: "read",
  input: z.object({}),
  output: z.object({
    sizes: z.object({ upper: z.enum(CAPSULE_SIZES).optional(), lower: z.enum(CAPSULE_SIZES).optional(), dress: z.enum(CAPSULE_SIZES).optional() }),
    rooms: z.array(roomSchema),
    like: z.object({ colors: z.array(z.string()), materials: z.array(z.string()) }),
    avoid: z.object({ colors: z.array(z.string()), materials: z.array(z.string()) }),
    budgetEuros: z.number().nullable(),
    empty: z.boolean(),
  }),
  async run(ctx) {
    const prefs = await ctx.services.preferences.read();
    const empty = Object.keys(prefs.sizes).length === 0 && prefs.rooms.length === 0 && prefs.like.colors.length + prefs.like.materials.length + prefs.avoid.colors.length + prefs.avoid.materials.length === 0 && prefs.budgetEuros === null;
    return { ...prefs, empty };
  },
});

export const rememberPreference = define({
  name: "remember_preference",
  description:
    `Remember something the shopper has just told you about themselves: a size (sizes.upper for tops, shirts, knitwear and coats; sizes.lower for trousers and skirts; sizes.dress; one of ${CAPSULE_SIZES.join(", ")}), a room and its wall width, colours or materials they like or avoid, or a budget per piece in euros. ` +
    "Use it only when they say it about themselves and would want it kept (\"I'm a medium\", \"my living room wall is 2.4 metres\"). It asks the shopper first. Lists you give replace the list, so include what is already there (read get_preferences first).",
  scope: "sensitive",
  input: z.object({
    patch: preferencesPatchSchema.refine((patch) => Object.keys(patch).length > 0, "Name at least one thing to remember."),
    caption,
  }),
  output: z.object({ commands: z.array(uiCommandSchema) }),
  async run(_ctx, { patch, caption: text }) {
    // The account icon is where preferences live; the light goes there as they are saved.
    return { commands: [uiCommandSchema.parse({ type: "preferences", agentId: "nav:account", patch, caption: text })] };
  },
});

