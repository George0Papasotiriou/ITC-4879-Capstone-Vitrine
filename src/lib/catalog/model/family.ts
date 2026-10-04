/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Which family of builder draws each kind of piece, and which pieces can have a made model at all.
 */

import { ROOM_PLACEMENT } from "@/lib/catalog/taxonomy";

export type Family = "seating" | "tables" | "lighting" | "storage" | "beds" | "rugs" | "planters" | "baskets";

const FAMILY: Readonly<Record<string, Family>> = {
  CHAIR: "seating",
  SOFA: "seating",
  OTTOMAN: "seating",
  STOOL_SEATING: "seating",
  BENCH: "seating",
  BEAN_BAG_CHAIR: "seating",
  TABLE: "tables",
  DESK: "tables",
  LAMP: "lighting",
  HOME_LIGHTING_AND_LAMPS: "lighting",
  CABINET: "storage",
  SHELF: "storage",
  DRESSER: "storage",
  STORAGE_DRAWER: "storage",
  CLOTHES_RACK: "storage",
  BED: "beds",
  RUG: "rugs",
  PLANTER: "planters",
  BASKET: "baskets",
  LAUNDRY_HAMPER: "baskets",
};

export function familyOf(kind: string): Family | null {
  return FAMILY[kind] ?? null;
}

/** Whether the shop can make a model of this piece at all: a kind that stands or lies on a floor, with measurements. */
export function canMakeModel(kind: string, dims: { w: number; d: number; h: number } | null): boolean {
  return dims !== null && dims.w > 0 && dims.d > 0 && dims.h > 0 && ROOM_PLACEMENT[kind] !== undefined && FAMILY[kind] !== undefined;
}
