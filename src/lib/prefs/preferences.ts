/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * What a shopper tells the shop about themselves — sizes, rooms, likes, a budget — and what the shop does with it.
 */

import { z } from "zod";

import { CAPSULE_SIZES, type CapsuleSize } from "@/lib/catalog/taxonomy";

/**
 * docs/adr/033. The Taste Graph learns from what a shopper does, with their
 * consent (docs/PLAN.md 2.8). These are what they *say*: their size, the rooms
 * they are furnishing, colours and materials they like or would rather not
 * see, what they are comfortable spending. Said once, used everywhere — the
 * size picker starts at their size, a sofa says whether it fits their wall,
 * the Concierge answers with them in mind — and every one of them is shown,
 * changeable and removable on one page.
 *
 * Kept on the device for a guest (a signed cookie), on the account when signed
 * in, and a guest's are carried into the account on sign-in.
 */

/** Garments are sized by where they are worn: a top's size says nothing about trousers. */
export const SIZE_GROUPS = ["upper", "lower", "dress"] as const;
export type SizeGroup = (typeof SIZE_GROUPS)[number];

export function sizeGroupOf(kind: string | null | undefined): SizeGroup | null {
  switch (kind) {
    case "TOP":
    case "SHIRT":
    case "KNIT":
    case "JACKET":
    case "COAT":
      return "upper";
    case "TROUSERS":
    case "SKIRT":
      return "lower";
    case "DRESS":
      return "dress";
    default:
      return null;
  }
}

const size = z.enum(CAPSULE_SIZES);
const word = z.string().trim().toLowerCase().min(2).max(24).regex(/^[\p{L} -]+$/u);
const words = z.array(word).max(12);

export const roomSchema = z.object({
  name: z.string().trim().min(1).max(40),
  /** The wall a piece would stand against, in centimetres. */
  wallCm: z.number().int().min(50).max(2_000),
  /** How far into the room a piece may reach, if the shopper knows. */
  depthCm: z.number().int().min(30).max(2_000).optional(),
});
export type Room = z.infer<typeof roomSchema>;

export const MAX_ROOMS = 5;

export const preferencesSchema = z.object({
  sizes: z.object({ upper: size.optional(), lower: size.optional(), dress: size.optional() }).default({}),
  rooms: z.array(roomSchema).max(MAX_ROOMS).default([]),
  like: z.object({ colors: words.default([]), materials: words.default([]) }).default({ colors: [], materials: [] }),
  avoid: z.object({ colors: words.default([]), materials: words.default([]) }).default({ colors: [], materials: [] }),
  /** What they are comfortable spending on one piece, in whole euros. */
  budgetEuros: z.number().int().min(10).max(50_000).nullable().default(null),
});
export type Preferences = z.infer<typeof preferencesSchema>;

export const EMPTY_PREFERENCES: Preferences = preferencesSchema.parse({});

/** A change: any part may be given; lists given replace the list. `budgetEuros: null` removes the budget. */
export const preferencesPatchSchema = z
  .object({
    sizes: z.object({ upper: size.nullable().optional(), lower: size.nullable().optional(), dress: size.nullable().optional() }).optional(),
    rooms: z.array(roomSchema).max(MAX_ROOMS).optional(),
    like: z.object({ colors: words.optional(), materials: words.optional() }).optional(),
    avoid: z.object({ colors: words.optional(), materials: words.optional() }).optional(),
    budgetEuros: z.number().int().min(10).max(50_000).nullable().optional(),
  })
  .strict();
export type PreferencesPatch = z.infer<typeof preferencesPatchSchema>;

const unique = (list: readonly string[]) => [...new Set(list)];

/** Something liked cannot also be avoided: the latest word wins, so the other list gives it up. */
function reconcile(prefs: Preferences, preferAvoid: boolean): Preferences {
  const pick = (liked: string[], avoided: string[]) =>
    preferAvoid ? { liked: liked.filter((item) => !avoided.includes(item)), avoided } : { liked, avoided: avoided.filter((item) => !liked.includes(item)) };
  const colors = pick(unique(prefs.like.colors), unique(prefs.avoid.colors));
  const materials = pick(unique(prefs.like.materials), unique(prefs.avoid.materials));
  return { ...prefs, like: { colors: colors.liked, materials: materials.liked }, avoid: { colors: colors.avoided, materials: materials.avoided } };
}

export function applyPatch(current: Preferences, patch: PreferencesPatch): Preferences {
  const sizes = { ...current.sizes };
  for (const group of SIZE_GROUPS) {
    const value = patch.sizes?.[group];
    if (value === null) delete sizes[group];
    else if (value !== undefined) sizes[group] = value;
  }
  const next: Preferences = {
    sizes,
    rooms: patch.rooms ?? current.rooms,
    like: { colors: patch.like?.colors ?? current.like.colors, materials: patch.like?.materials ?? current.like.materials },
    avoid: { colors: patch.avoid?.colors ?? current.avoid.colors, materials: patch.avoid?.materials ?? current.avoid.materials },
    budgetEuros: patch.budgetEuros === undefined ? current.budgetEuros : patch.budgetEuros,
  };
  return reconcile(next, patch.avoid !== undefined && patch.like === undefined);
}

/**
 * A guest's preferences carried into their account on sign-in. What the
 * account already holds wins where both say something; lists are joined, the
 * account's first, so nothing the shopper said on either is lost.
 */
export function mergePreferences(device: Preferences, account: Preferences): Preferences {
  const rooms = [...account.rooms, ...device.rooms.filter((room) => !account.rooms.some((kept) => kept.name.toLowerCase() === room.name.toLowerCase()))].slice(0, MAX_ROOMS);
  return reconcile(
    {
      sizes: { ...device.sizes, ...account.sizes },
      rooms,
      like: { colors: unique([...account.like.colors, ...device.like.colors]).slice(0, 12), materials: unique([...account.like.materials, ...device.like.materials]).slice(0, 12) },
      avoid: { colors: unique([...account.avoid.colors, ...device.avoid.colors]).slice(0, 12), materials: unique([...account.avoid.materials, ...device.avoid.materials]).slice(0, 12) },
      budgetEuros: account.budgetEuros ?? device.budgetEuros,
    },
    false,
  );
}

/** The change that puts back what `patch` is about to change: for an undo. */
export function undoPatch(before: Preferences, patch: PreferencesPatch): PreferencesPatch {
  const undo: PreferencesPatch = {};
  if (patch.sizes !== undefined) {
    undo.sizes = Object.fromEntries(SIZE_GROUPS.filter((group) => group in patch.sizes!).map((group) => [group, before.sizes[group] ?? null]));
  }
  if (patch.rooms !== undefined) undo.rooms = before.rooms;
  if (patch.like !== undefined) undo.like = { ...(patch.like.colors === undefined ? {} : { colors: before.like.colors }), ...(patch.like.materials === undefined ? {} : { materials: before.like.materials }) };
  if (patch.avoid !== undefined) undo.avoid = { ...(patch.avoid.colors === undefined ? {} : { colors: before.avoid.colors }), ...(patch.avoid.materials === undefined ? {} : { materials: before.avoid.materials }) };
  if (patch.budgetEuros !== undefined) undo.budgetEuros = before.budgetEuros;
  return undo;
}

export function isEmpty(prefs: Preferences): boolean {
  return (
    Object.keys(prefs.sizes).length === 0 &&
    prefs.rooms.length === 0 &&
    prefs.like.colors.length + prefs.like.materials.length + prefs.avoid.colors.length + prefs.avoid.materials.length === 0 &&
    prefs.budgetEuros === null
  );
}

/** The size the picker starts at for a garment of this kind, if the shopper has said. */
export function preferredSize(prefs: Preferences, kind: string | null | undefined): CapsuleSize | null {
  const group = sizeGroupOf(kind);
  return group === null ? null : (prefs.sizes[group] ?? null);
}

/**
 * What the shopper said they like and avoid, applied to suggestions: a piece
 * in a colour or material they would rather not see is left out, and among
 * the rest those matching more of what they like come first. Otherwise the
 * order is kept — the Taste Graph's ranking is the one being refined, not
 * replaced.
 */
export function withTaste<T extends { productId: string }>(items: readonly T[], features: ReadonlyMap<string, { colors: readonly string[]; materials: readonly string[] }>, prefs: Preferences): T[] {
  const avoided = new Set([...prefs.avoid.colors, ...prefs.avoid.materials]);
  const liked = new Set([...prefs.like.colors, ...prefs.like.materials]);
  const wordsOf = (id: string) => {
    const found = features.get(id);
    return found === undefined ? [] : [...found.colors, ...found.materials];
  };
  return items
    .map((item, position) => ({ item, position, words: wordsOf(item.productId) }))
    .filter((entry) => !entry.words.some((word) => avoided.has(word)))
    .map((entry) => ({ ...entry, likes: entry.words.filter((word) => liked.has(word)).length }))
    .sort((a, b) => b.likes - a.likes || a.position - b.position)
    .map((entry) => entry.item);
}

/** Room to walk past and open a drawer: a piece should leave this much of its wall free, in total. */
export const WALL_CLEARANCE_CM = 20;

export type RoomFit = { room: string; wallCm: number; fits: boolean; spareCm: number };

/**
 * Whether a piece fits each of the shopper's rooms: its width against the
 * wall, with a little clearance, and its depth against the room's depth when
 * both are known. Only for pieces with measurements; a lamp's shade is not a
 * question of walls, so pieces narrower than 30 cm are not judged at all.
 */
export function roomFits(dims: { w: number; d: number; h: number } | null, rooms: readonly Room[]): RoomFit[] {
  if (dims === null || dims.w < 30) return [];
  return rooms.map((room) => {
    const spareCm = Math.round(room.wallCm - WALL_CLEARANCE_CM - dims.w);
    const deepEnough = room.depthCm === undefined || dims.d <= room.depthCm;
    return { room: room.name, wallCm: room.wallCm, fits: spareCm >= 0 && deepEnough, spareCm };
  });
}
