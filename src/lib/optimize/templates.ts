/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Budget Stylist templates: slots, product kinds, quantities and size limits.
 */

/**
 * Budget Stylist templates (A3): what a request for "a reading corner" means.
 *
 * A slot names the kinds of product that can fill it (ABO product types), how
 * many units it takes (a dining set needs four chairs), whether it may stay
 * empty, and size limits that follow from what the slot is for — a side table
 * wider than 75 cm is not a side table. Shoppers can tighten the limits with
 * measurements of their room; they cannot loosen a template's own.
 *
 * The plan's outfit template needs the fashion capsule (Phase 3, step 4), which
 * waits for George's approval, so only home templates exist for now.
 */

export type SizeLimit = { maxWidthCm?: number; maxDepthCm?: number; maxHeightCm?: number; minWidthCm?: number };

export type TemplateSlot = {
  id: string;
  kinds: readonly string[];
  quantity: number;
  required: boolean;
  size?: SizeLimit;
};

export type TemplateId = "reading-corner" | "living-room" | "dining" | "bedroom" | "gift-set";

export type Template = { id: TemplateId; slots: readonly TemplateSlot[] };

export const TEMPLATES: Readonly<Record<TemplateId, Template>> = {
  "reading-corner": {
    id: "reading-corner",
    slots: [
      { id: "chair", kinds: ["CHAIR"], quantity: 1, required: true },
      { id: "lamp", kinds: ["LAMP", "HOME_LIGHTING_AND_LAMPS"], quantity: 1, required: true },
      { id: "side-table", kinds: ["TABLE"], quantity: 1, required: true, size: { maxWidthCm: 75 } },
      { id: "rug", kinds: ["RUG"], quantity: 1, required: false, size: { maxWidthCm: 200 } },
    ],
  },
  "living-room": {
    id: "living-room",
    slots: [
      { id: "sofa", kinds: ["SOFA"], quantity: 1, required: true },
      { id: "coffee-table", kinds: ["TABLE"], quantity: 1, required: true, size: { maxHeightCm: 60 } },
      { id: "lighting", kinds: ["LAMP", "LIGHT_FIXTURE", "HOME_LIGHTING_AND_LAMPS"], quantity: 1, required: false },
      { id: "rug", kinds: ["RUG"], quantity: 1, required: false },
      { id: "accent-seat", kinds: ["OTTOMAN", "STOOL_SEATING", "BEAN_BAG_CHAIR"], quantity: 1, required: false },
    ],
  },
  dining: {
    id: "dining",
    slots: [
      { id: "table", kinds: ["TABLE"], quantity: 1, required: true, size: { minWidthCm: 90 } },
      { id: "chairs", kinds: ["CHAIR"], quantity: 4, required: true },
      { id: "pendant", kinds: ["LIGHT_FIXTURE"], quantity: 1, required: false },
    ],
  },
  bedroom: {
    id: "bedroom",
    slots: [
      { id: "bed", kinds: ["BED", "HEADBOARD"], quantity: 1, required: true },
      { id: "bedside-lamp", kinds: ["LAMP"], quantity: 2, required: false },
      { id: "pillows", kinds: ["PILLOW"], quantity: 2, required: false },
      { id: "rug", kinds: ["RUG"], quantity: 1, required: false },
    ],
  },
  "gift-set": {
    id: "gift-set",
    slots: [
      { id: "centrepiece", kinds: ["VASE", "PLANTER", "CANDLE"], quantity: 1, required: true },
      { id: "wall", kinds: ["WALL_ART", "PICTURE_FRAME", "CLOCK", "HOME_MIRROR"], quantity: 1, required: false },
      { id: "soft", kinds: ["PILLOW"], quantity: 1, required: false },
    ],
  },
};

export const TEMPLATE_IDS = Object.keys(TEMPLATES) as TemplateId[];

export function isTemplateId(value: string): value is TemplateId {
  return (TEMPLATE_IDS as string[]).includes(value);
}

export type Dimensions = { w: number; d: number; h: number } | null;

/**
 * Whether a product's dimensions satisfy a slot's limits combined with the
 * shopper's. A product with unknown dimensions passes only when no limit
 * applies: when a room has been measured, an unmeasured sofa cannot be
 * promised to fit.
 */
export function fitsSize(dims: Dimensions, limits: readonly (SizeLimit | undefined)[]): boolean {
  const active = limits.filter((limit): limit is SizeLimit => limit !== undefined && Object.keys(limit).length > 0);
  if (active.length === 0) return true;
  if (dims === null) return false;
  return active.every(
    (limit) =>
      (limit.maxWidthCm === undefined || dims.w <= limit.maxWidthCm) &&
      (limit.maxDepthCm === undefined || dims.d <= limit.maxDepthCm) &&
      (limit.maxHeightCm === undefined || dims.h <= limit.maxHeightCm) &&
      (limit.minWidthCm === undefined || dims.w >= limit.minWidthCm),
  );
}
