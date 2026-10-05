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
import { sizeChartFor } from "@/lib/catalog/capsule";
import { adviseSize, ASKED_MEASURES, engineAdvice, isAdvice, MEASURE_MAX_CM, MEASURE_MIN_CM } from "@/lib/catalog/size-advice";
import { CAPSULE_SIZES, roomPlacement } from "@/lib/catalog/taxonomy";
import { wayIn } from "@/lib/fit/path";
import { preferencesPatchSchema, roomFits, roomSchema, sizeGroupOf } from "@/lib/prefs/preferences";

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

/** The garments the size charts cover, as a shopper names them, and the kind whose chart each uses. */
const GARMENTS = { top: "TOP", trousers: "TROUSERS", skirt: "SKIRT", dress: "DRESS" } as const;
const MEASURES = ["chest", "waist", "hip"] as const;

export const suggestSize = define({
  name: "suggest_size",
  description:
    "Work out a clothing size from the shopper's body measurements in centimetres, using the shop's own size chart and its Fit Engine: garment top (also shirts, knitwear, jackets, coats), trousers, skirt or dress; chest, waist and/or hip. " +
    "Use it when the shopper gives measurements and asks what size to take. Give productId when they are asking about a particular piece: the advice then allows for how that piece runs, from its reviews and the shop's returns. " +
    "It returns the size, how likely it is to fit (fitChance, percent), the next size when it is close, which measurement decided and whether the measurements are far apart, and the piece's lean; explain that in one or two sentences. " +
    "Do not use it without measurements (ask for them, or point to \"Find your size\" on the piece's page), and do not guess sizes for shoes or furniture. To keep the size, offer remember_preference afterwards.",
  scope: "read",
  input: z.object({
    garment: z.enum(Object.keys(GARMENTS) as [keyof typeof GARMENTS, ...(keyof typeof GARMENTS)[]]),
    productId: z.uuid().optional(),
    chestCm: z.number().optional(),
    waistCm: z.number().optional(),
    hipCm: z.number().optional(),
  }),
  output: z.union([
    z.object({
      size: z.enum(CAPSULE_SIZES),
      beyondChart: z.boolean(),
      decidedBy: z.enum(MEASURES),
      apart: z.number().int(),
      sizeGroup: z.enum(["upper", "lower", "dress"]),
      verdicts: z.array(z.object({ measure: z.enum(MEASURES), cm: z.number(), size: z.enum(CAPSULE_SIZES), upToCm: z.number() })),
      /** The Fit Engine's chance that `size` fits, in percent, and how sure the advice is (docs/adr/064). */
      fitChance: z.number().int(),
      certainty: z.enum(["sure", "likely", "between"]),
      runnerUp: z.object({ size: z.enum(CAPSULE_SIZES), fitChance: z.number().int() }).nullable(),
      /** How the piece runs, when productId was given and the shop knows the piece. */
      piece: z.object({ lean: z.enum(["small", "true", "large"]), cut: z.enum(["close", "usual", "forgiving"]), remarks: z.number().int(), outcomes: z.number().int() }).nullable(),
    }),
    z.object({ problem: z.enum(["no_measurements", "out_of_range", "not_on_chart"]), hint: z.string() }),
  ]),
  async run(ctx, input) {
    const kind = GARMENTS[input.garment];
    const chart = sizeChartFor(kind)!;
    const piece = input.productId === undefined ? null : await ctx.services.fit.forProduct(input.productId);
    // The chart's girth rows, by name: chest and waist above, waist and hip below.
    const named = chart.slice(0, ASKED_MEASURES).map((row) => row.measure.en.toLowerCase() as (typeof MEASURES)[number]);
    const given: Record<(typeof MEASURES)[number], number | undefined> = { chest: input.chestCm, waist: input.waistCm, hip: input.hipCm };
    const unused = MEASURES.filter((measure) => given[measure] !== undefined && !named.includes(measure));
    const result = adviseSize(chart, named.map((measure) => given[measure]));
    if (!isAdvice(result)) {
      if (result.problem === "no_measurements") {
        return unused.length > 0
          ? { problem: "not_on_chart" as const, hint: `This chart is read by ${named.join(" and ")}; ${unused.join(" and ")} is not on it.` }
          : { problem: "no_measurements" as const, hint: `Ask for the shopper's ${named.join(" and ")} in centimetres.` };
      }
      return { problem: "out_of_range" as const, hint: `The ${named[result.index]} must be between ${MEASURE_MIN_CM} and ${MEASURE_MAX_CM} cm; inches times 2.54.` };
    }
    const measured = named.map((measure) => given[measure]);
    const engine = engineAdvice(chart, measured, piece?.item);
    const size = (engine?.best.size ?? result.size) as (typeof CAPSULE_SIZES)[number];
    const chance = (p: number) => Math.round(p * 100);
    return {
      size,
      beyondChart: result.beyondChart,
      decidedBy: named[result.decidedBy]!,
      apart: result.apart,
      sizeGroup: sizeGroupOf(kind)!,
      verdicts: result.verdicts.map((verdict) => ({ measure: named[verdict.index]!, cm: verdict.cm, size: verdict.size, upToCm: verdict.upToCm })),
      fitChance: engine === null ? 0 : chance(engine.best.probabilities.fit),
      certainty: engine?.verdict ?? ("between" as const),
      runnerUp: engine?.runnerUp == null ? null : { size: engine.runnerUp.size as (typeof CAPSULE_SIZES)[number], fitChance: chance(engine.runnerUp.probabilities.fit) },
      piece: piece === null ? null : { lean: piece.lean, cut: piece.cut, remarks: piece.remarks, outcomes: piece.outcomes },
    };
  },
});

/**
 * "Will it get in?" (docs/adr/055): the piece's catalogue box carried along
 * the way into the shopper's home that they saved — doors, corners, stairs —
 * by the shop's own geometry (src/lib/fit/path.ts), never the model's guess.
 */
export const checkWayIn = define({
  name: "check_way_in",
  description:
    "Say whether a piece of furniture gets into the shopper's home along the way in they saved (doors, corridor corners, stairs): step by step, how it is carried, and by how many centimetres it fits or misses. " +
    "Use it for \"will it get through my door\", \"will it go up my stairs\", \"can I get it in\". Do not use it for whether it fits a wall of a room (that is place_in_room), and never work out a fit yourself. With no way in saved it opens the page where the shopper measures it.",
  scope: "read",
  // The shop's own surfaces: outside agents get the tools ADR-043 opened, not every new one.
  surfaces: ["chat", "voice", "eval"],
  input: z.object({ productId: z.uuid() }),
  output: z.discriminatedUnion("ok", [
    z.object({
      ok: z.literal(true),
      title: z.string(),
      fits: z.boolean(),
      firstFailure: z.number().int().nullable(),
      steps: z.array(z.object({ kind: z.enum(["door", "turn", "stairs"]), fits: z.boolean(), marginCm: z.number().int(), up: z.enum(["w", "d", "h"]).nullable(), tiltDegrees: z.number().int() })),
      commands: z.array(uiCommandSchema),
    }),
    z.object({ ok: z.literal(false), reason: z.enum(["not_found", "not_for_rooms", "no_way_in"]), commands: z.array(uiCommandSchema) }),
  ]),
  async run(ctx, { productId }) {
    const [[detail], prefs] = await Promise.all([ctx.services.details([productId]), ctx.services.preferences.read()]);
    if (detail === undefined) return { ok: false as const, reason: "not_found" as const, commands: [] };
    if (detail.dimsCm === null || roomPlacement(detail.kind, detail.dimsCm) === null) return { ok: false as const, reason: "not_for_rooms" as const, commands: [] };
    if (prefs.wayIn.length === 0) {
      const measure = uiCommandSchema.parse({
        type: "navigate",
        href: "/account/preferences#way-in",
        caption: ctx.locale === "el" ? "Άνοιγμα της διαδρομής σου" : "Opening your way in",
      });
      return { ok: false as const, reason: "no_way_in" as const, commands: [measure] };
    }
    const result = wayIn(detail.dimsCm, prefs.wayIn);
    return {
      ok: true as const,
      title: detail.title,
      fits: result.fits,
      firstFailure: result.firstFailure,
      steps: result.steps.map((step) => ({ kind: step.step.kind, fits: step.fits, marginCm: step.marginCm, up: step.carry?.up ?? null, tiltDegrees: step.carry?.tiltDegrees ?? 0 })),
      commands: [],
    };
  },
});

export const placeInRoom = define({
  name: "place_in_room",
  description:
    "Say whether a piece of furniture fits the shopper's saved rooms (its width against each wall, leaving 20 cm to walk past, and its depth when known), and open the room planner with it, where they can see it at true size in a photo of their room. " +
    "Use it for \"will this fit my living room\", \"show it in my room\". Name a saved room with `room` to point at it. Do not use it for clothing (try_on is for that) or for small things such as vases. With no rooms saved it still opens the planner, where the shopper can save one.",
  scope: "ui",
  input: z.object({ productId: z.uuid(), room: z.string().trim().min(1).max(40).optional(), caption }),
  output: z.object({
    placeable: z.boolean(),
    fits: z.array(z.object({ room: z.string(), wallCm: z.number(), fits: z.boolean(), spareCm: z.number() })),
    roomsSaved: z.number().int(),
    commands: z.array(uiCommandSchema),
  }),
  async run(ctx, { productId, room, caption: text }) {
    const [[detail], prefs] = await Promise.all([ctx.services.details([productId]), ctx.services.preferences.read()]);
    if (detail === undefined || roomPlacement(detail.kind, detail.dimsCm) === null) return { placeable: false, fits: [], roomsSaved: prefs.rooms.length, commands: [] };
    const fits = roomFits(detail.dimsCm, prefs.rooms);
    const named = room === undefined ? undefined : prefs.rooms.find((saved) => saved.name.toLocaleLowerCase() === room.toLocaleLowerCase())?.name;
    const href = `/room?${new URLSearchParams({ product: detail.slug, ...(named === undefined ? {} : { room: named }) }).toString()}`;
    return { placeable: true, fits, roomsSaved: prefs.rooms.length, commands: [uiCommandSchema.parse({ type: "navigate", href, caption: text })] };
  },
});
