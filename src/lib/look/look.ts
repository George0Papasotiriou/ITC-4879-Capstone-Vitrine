/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Shop the look: the model's boxes checked and turned into the regions the shop measures, and the words it searches with.
 */

import { z } from "zod";

import { STOPWORDS } from "@/lib/search/vocabulary";

/**
 * docs/adr/054. What the model may answer is fixed by `lookSchema` (the AI SDK
 * validates it); what the shop does with it is here, pure and tested:
 * - a box is [ymin, xmin, ymax, xmax] on 0–1000 (Gemini's own convention for
 *   boxes); a box that is inverted, too small to measure or nearly the whole
 *   photograph is dropped — the last is a whole room, not a piece;
 * - boxes that are mostly the same region (intersection over union above
 *   0.6) are one piece, the first kept;
 * - the words are cleaned to plain lower-case letters before they reach a
 *   search: the photograph is data, and nothing written in it can steer one.
 */

export const MAX_PIECES = 6;

export const lookSchema = z.object({
  pieces: z
    .array(
      z.object({
        box_2d: z.array(z.number()).length(4),
        kind: z.string().max(60),
        words: z.array(z.string().max(30)).max(3),
      }),
    )
    .max(12),
});
export type LookAnswer = z.infer<typeof lookSchema>;

/** A region of the photograph, as shares of its width and height (0–1). */
export type Region = { x: number; y: number; width: number; height: number };

/** A piece found: where it is, and the plain words for it. */
export type FoundPiece = { region: Region; kind: string; words: string[] };

const clean = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\s-]/gu, " ")
    .split(/[\s-]+/)
    .filter((word) => word.length > 1 && word.length <= 20 && !STOPWORDS.has(word))
    .slice(0, 3)
    .join(" ");

/** [ymin, xmin, ymax, xmax] on 0–1000 as a region, or null when it cannot be a piece. */
export function regionOf(box: readonly number[]): Region | null {
  if (box.length !== 4 || box.some((value) => !Number.isFinite(value))) return null;
  const [ymin, xmin, ymax, xmax] = box.map((value) => Math.max(0, Math.min(1000, value)) / 1000) as [number, number, number, number];
  const width = xmax - xmin;
  const height = ymax - ymin;
  // Too small to measure a colour in (under 3% each way), or nearly the whole photograph.
  if (width < 0.03 || height < 0.03 || width * height > 0.92) return null;
  // To the box's own resolution, a thousandth: no more digits than Gemini gave.
  const round = (value: number) => Math.round(value * 1000) / 1000;
  return { x: round(xmin), y: round(ymin), width: round(width), height: round(height) };
}

/** Intersection over union of two regions. */
export function overlap(a: Region, b: Region): number {
  const x = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const shared = x * y;
  return shared / (a.width * a.height + b.width * b.height - shared);
}

/** The model's answer as pieces the shop can measure: valid boxes, cleaned words, no repeats, at most MAX_PIECES. */
export function piecesOf(answer: LookAnswer): FoundPiece[] {
  const pieces: FoundPiece[] = [];
  for (const entry of answer.pieces) {
    const region = regionOf(entry.box_2d);
    const kind = clean(entry.kind);
    if (region === null || kind === "") continue;
    if (pieces.some((kept) => overlap(kept.region, region) > 0.6)) continue;
    pieces.push({ region, kind, words: entry.words.map(clean).filter((word) => word !== "") });
    if (pieces.length === MAX_PIECES) break;
  }
  return pieces;
}

/** The search for a piece: the colour the shop measured in its box, then what the model says it is. */
export function lookQuery(piece: FoundPiece, colour: string | null): string {
  return [colour, piece.kind].filter((part) => part !== null && part !== "").join(" ");
}
