/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The quality check on an AI picture: the verdict's shape, the bar a picture must clear, and which of two is better.
 */

import { z } from "zod";

import type { PictureKind } from "@/lib/pictures/pictures";

/**
 * docs/adr/060. Before anyone sees an AI picture, a second model looks at it
 * beside the piece's own photographs (and the shopper's room, when it is
 * theirs) and scores it out of 10 on four questions:
 *
 * - fidelity: is it the same piece — shape, legs, details, material, colour?
 * - realism: would a careful eye take it for an unedited photograph?
 * - scale: is it a believable size for its measurements, against the room?
 * - roomKept: for a shopper's own room, is everything else left as it was?
 *   (null for a showroom, which is the shop's own.)
 *
 * and names what is wrong, each as an instruction ("the back legs are
 * missing: show four tapered legs"). A picture that falls short is made once
 * more with those instructions added; the better of the two is kept, and if
 * neither clears the bar the shopper is told, and nothing is taken from
 * their day. The bar is set below perfect on purpose: a judge that demands 10
 * sends back good pictures, and each attempt is paid for.
 */

export const verdictSchema = z.object({
  fidelity: z.number().int().min(0).max(10),
  realism: z.number().int().min(0).max(10),
  scale: z.number().int().min(0).max(10),
  roomKept: z.number().int().min(0).max(10).nullable(),
  issues: z.array(z.string().max(240)).max(6),
});
export type Verdict = z.infer<typeof verdictSchema>;

/** The lowest score each question may have for a picture to be shown. */
export const QUALITY_BAR = { fidelity: 7, realism: 7, scale: 6, roomKept: 7 } as const;

/** Whether the room question applies: only a shopper's own room must be kept as it was. */
export const asksRoomKept = (kind: PictureKind) => kind !== "scene";

/** Whether a picture clears the bar. A missing room score on a shopper's own room is a failure, not a pass. */
export function passes(verdict: Verdict, kind: PictureKind): boolean {
  if (verdict.fidelity < QUALITY_BAR.fidelity || verdict.realism < QUALITY_BAR.realism || verdict.scale < QUALITY_BAR.scale) return false;
  if (!asksRoomKept(kind)) return true;
  return verdict.roomKept !== null && verdict.roomKept >= QUALITY_BAR.roomKept;
}

/**
 * One number for comparing two attempts: a weighted mean in which looking
 * like the piece counts most and looking like a photograph next, pulled down
 * by the weakest answer — a picture with one glaring fault is worse than one
 * that is merely good everywhere.
 */
export function overall(verdict: Verdict, kind: PictureKind): number {
  const room = asksRoomKept(kind) ? (verdict.roomKept ?? 0) : null;
  const weighted =
    room === null
      ? (0.45 * verdict.fidelity + 0.4 * verdict.realism + 0.15 * verdict.scale)
      : (0.4 * verdict.fidelity + 0.3 * verdict.realism + 0.15 * verdict.scale + 0.15 * room);
  const weakest = Math.min(verdict.fidelity, verdict.realism, verdict.scale, room ?? 10);
  return 0.7 * weighted + 0.3 * weakest;
}

/**
 * Which of two judged attempts to keep: one that clears the bar beats one
 * that does not; otherwise the higher overall score; on a tie, the first
 * (it was cheaper to stop at). An attempt the judge could not read is
 * compared as if it had cleared the bar at the bar's own scores.
 */
export function better<T extends { verdict: Verdict | null }>(first: T, second: T, kind: PictureKind): T {
  const bar: Verdict = { fidelity: QUALITY_BAR.fidelity, realism: QUALITY_BAR.realism, scale: QUALITY_BAR.scale, roomKept: QUALITY_BAR.roomKept, issues: [] };
  const a = first.verdict ?? bar;
  const b = second.verdict ?? bar;
  const passA = passes(a, kind);
  const passB = passes(b, kind);
  if (passA !== passB) return passA ? first : second;
  return overall(b, kind) > overall(a, kind) ? second : first;
}

/**
 * The judge's issues as instructions for the second attempt. They are the
 * shop's own model's words, but are treated like any text from a model:
 * one line each, no quotes or control characters, short, at most five.
 */
export function corrections(verdict: Verdict): string[] {
  return verdict.issues
    .map((issue) =>
      issue
        .replace(/[\u0000-\u001f\u007f"`]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 160),
    )
    .filter((issue) => issue.length > 3)
    .slice(0, 5);
}
