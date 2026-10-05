/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Outfits: the roles a piece of clothing plays, what completes a look around one piece, and how well two pieces are worn together.
 */

import { optimizeBundles, type Bundle, type Slot } from "@/lib/optimize/bundle";
import { compatibility, type StylistCandidate } from "@/lib/optimize/compatibility";

/**
 * docs/adr/066. An outfit is pieces in roles: something on top, something
 * below (or a dress for both), shoes, and optionally a coat or jacket over
 * them, a bag and one accessory. "Complete the look" fixes the piece the
 * shopper is looking at in its role and fills the others with the Budget
 * Stylist's optimiser (A3, bundle.ts): each piece's own merit plus λ times
 * how well every two pieces go together, within a budget. What is new here
 * is the outfit's grammar and one more measure of fit between two garments,
 * formality.
 */

export type OutfitRole = "top" | "bottom" | "dress" | "outer" | "shoes" | "bag" | "accessory";
export type Department = "women" | "men";

export const ROLE_KINDS: Readonly<Record<OutfitRole, readonly string[]>> = {
  top: ["TOP", "SHIRT", "KNIT"],
  bottom: ["TROUSERS", "SKIRT"],
  dress: ["DRESS"],
  outer: ["COAT", "JACKET"],
  shoes: ["SHOES", "BOOT", "SANDAL"],
  bag: ["HANDBAG", "BACKPACK", "TOTE_BAG"],
  accessory: ["EARRING", "NECKLACE", "BRACELET", "HAT", "SCARF"],
};

export function roleOf(kind: string): OutfitRole | null {
  for (const [role, kinds] of Object.entries(ROLE_KINDS) as [OutfitRole, readonly string[]][]) if (kinds.includes(kind)) return role;
  return null;
}

/**
 * The roles that complete a look around a piece, each required or not. A
 * dress takes the place of a top and a bottom; a coat needs both under it;
 * shoes, a bag or an accessory need clothes. Men's looks have no dress (the
 * catalogue has none), so a men's top always takes a bottom.
 */
export function rolesToComplete(anchor: OutfitRole, department: Department): { role: OutfitRole; required: boolean }[] {
  const wear = (roles: OutfitRole[], optional: OutfitRole[]) => [...roles.map((role) => ({ role, required: true })), ...optional.map((role) => ({ role, required: false }))];
  switch (anchor) {
    case "top":
      return wear(["bottom", "shoes"], ["outer", "bag", "accessory"]);
    case "bottom":
      return wear(["top", "shoes"], ["outer", "bag", "accessory"]);
    case "dress":
      return wear(["shoes"], ["outer", "bag", "accessory"]);
    case "outer":
      return wear(["top", "bottom", "shoes"], ["bag"]);
    case "shoes":
    case "bag":
    case "accessory": {
      // Clothes to wear them with: a dress for a women's look, a top and a bottom for a men's; and shoes unless they are the piece.
      const clothes: OutfitRole[] = department === "women" ? ["dress"] : ["top", "bottom"];
      return wear(anchor === "shoes" ? clothes : [...clothes, "shoes"], ["outer"]);
    }
  }
}

/**
 * How dressed-up a piece is, from 0 (casual) to 1 (formal): a starting
 * point by kind, moved by the words of its title. A rule, stated as one: no
 * dataset in reach labels formality, and a reader can check every word.
 */
const KIND_FORMALITY: Readonly<Record<string, number>> = {
  TOP: 0.3, SHIRT: 0.6, KNIT: 0.45, TROUSERS: 0.5, SKIRT: 0.55, DRESS: 0.6, COAT: 0.7, JACKET: 0.55,
  SHOES: 0.5, BOOT: 0.45, SANDAL: 0.2, HANDBAG: 0.6, BACKPACK: 0.2, TOTE_BAG: 0.35, EARRING: 0.6, NECKLACE: 0.6, BRACELET: 0.5, HAT: 0.4, SCARF: 0.5,
};
const CASUAL_WORDS = /\b(tee|t-shirt|hoodie|sweatshirt|jogger|sweatpants|trainers?|sneakers?|running|flip[- ]flops?|slides?|cargo|denim|jeans?|fleece|beanie|sports?|hiking|canvas|backpack)\b/i;
const FORMAL_WORDS = /\b(blazer|suit|tailored|oxford|derby|brogues?|loafers?|heels?|pumps?|stiletto|silk|satin|wool coat|trench|dress shirt|pencil|cocktail|evening|formal|leather|pearl|diamond|sapphire|gold)\b/i;

export function formality(kind: string, title: string): number {
  let value = KIND_FORMALITY[kind] ?? 0.5;
  if (CASUAL_WORDS.test(title)) value -= 0.25;
  if (FORMAL_WORDS.test(title)) value += 0.25;
  return Math.min(1, Math.max(0, value));
}

export type OutfitCandidate = StylistCandidate & { role: OutfitRole; formality: number };

/** How much a formality gap costs: trainers with a tailored coat lose about what clashing colours would. */
export const FORMALITY_WEIGHT = 0.5;

/**
 * τ: two pieces "go together" when their outfit compatibility reaches it
 * (about a third of real pairs do). The capsule counts outfits by it, and a
 * look offers an optional extra only when it goes with the piece.
 */
export const GO_TOGETHER = 0.3;

/**
 * Two pieces worn together: the Stylist's compatibility (style vectors and
 * colour harmony, compatibility.ts) less the gap in how dressed-up they are.
 */
export function outfitCompatibility(first: OutfitCandidate, second: OutfitCandidate): number {
  return compatibility(first, second) - FORMALITY_WEIGHT * Math.abs(first.formality - second.formality);
}

export type LookRequest = {
  anchor: OutfitCandidate;
  /** Candidates for each role to fill, most suitable first. */
  candidates: Partial<Record<OutfitRole, readonly OutfitCandidate[]>>;
  roles: { role: OutfitRole; required: boolean }[];
  budgetCents: number;
  lambda?: number;
};

/**
 * The best looks around the anchor: the anchor is a slot of its own with one
 * candidate, so every look contains it and every other piece is judged
 * against it as well as against each other. Up to three looks, each
 * differing from the others in at least two roles.
 *
 * A required role is always filled with the best there is. An optional one
 * (a coat, a bag, an accessory) only from pieces that go with the anchor
 * (GO_TOGETHER): every piece's own merit counts in its favour, so without
 * the bar any affordable extra would be added, a daypack with a tea dress.
 */
export function completeLook(request: LookRequest): Bundle<OutfitCandidate>[] {
  const slots: Slot<OutfitCandidate>[] = [{ id: `anchor:${request.anchor.role}`, required: true, candidates: [request.anchor] }];
  for (const { role, required } of request.roles) {
    const offered = request.candidates[role] ?? [];
    const candidates = required ? offered : offered.filter((candidate) => outfitCompatibility(request.anchor, candidate) >= GO_TOGETHER);
    if (candidates.length === 0 && required) return [];
    if (candidates.length > 0) slots.push({ id: role, required, candidates });
  }
  // The anchor's own price is spent already; the budget is for what goes with it.
  const budget = request.budgetCents + request.anchor.priceCents;
  return optimizeBundles({ slots, budgetCents: budget, lambda: request.lambda ?? 0.6, compatibility: outfitCompatibility }, { count: 3, minDifferentSlots: 2 }).bundles;
}
