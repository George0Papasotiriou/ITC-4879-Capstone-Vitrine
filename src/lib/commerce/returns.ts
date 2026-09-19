/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Customer returns: the reasons a customer can give and the last day a return can be asked for.
 */

import { RETURN_WINDOW_DAYS } from "@/lib/commerce/order-state";

/**
 * Returns (docs/adr/017). The EU right of withdrawal gives 14 days from
 * delivery (order-state.ts enforces it for customers; staff may accept a late
 * one). The reason is a short fixed list, so the order desk can see patterns —
 * many "damaged" returns of one piece point at its packaging — plus a note.
 */
export const RETURN_REASONS = ["changed_mind", "damaged", "not_as_described", "wrong_item", "other"] as const;
export type ReturnReason = (typeof RETURN_REASONS)[number];

/** The last moment a customer may ask for a return: delivery plus the window. */
export function returnDeadline(deliveredAt: Date): Date {
  return new Date(deliveredAt.getTime() + RETURN_WINDOW_DAYS * 24 * 60 * 60 * 1000);
}
