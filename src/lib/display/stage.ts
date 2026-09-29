/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Standing a set of pieces in a shop window at their true relative sizes.
 */

/**
 * docs/adr/040. A window display that shows a lamp as tall as the sofa beside
 * it lies about both. Here every standing piece is drawn with ONE scale s (a
 * share of the window's height per centimetre), so on screen
 *
 *   height_i / height_j = h_i / h_j        and        width_i / width_j = w_i / w_j
 *
 * exactly as in the room. s is the largest scale at which the whole row fits:
 *
 *   s = min( H_max / max_i h_i ,  W_max · A / (Σ_i w_i + gaps) )
 *
 * with H_max the share of the window's height the tallest piece may take,
 * W_max the share of its width the row may take, and A = width / height of
 * the window (so a phone's tall window gets a smaller s than a wide screen).
 *
 * THE ARRANGEMENT. The hero piece stands in the middle. The others take turns
 * left and right of it, shortest first, so the row rises towards its ends and
 * the eye comes back to the centre. A flat piece (a rug) lies on the floor
 * under the row instead, on the same scale. A piece without measurements is
 * given a modest stand-in size and marked, so it is never shown as if measured.
 */

export type StagePiece = { id: string; dimsCm: { w: number; d: number; h: number } | null; hero?: boolean; flat?: boolean };

export type PlacedPiece = {
  id: string;
  /** Percentages of the window: left edge, width, height, and distance from the bottom. */
  leftPct: number;
  widthPct: number;
  heightPct: number;
  bottomPct: number;
  /** Drawing order: the hero in front. */
  z: number;
  /** False when the size shown is a stand-in, not the piece's own measurements. */
  measured: boolean;
  flat: boolean;
};

export type StageLayout = { pieces: PlacedPiece[]; cmPerWindowHeight: number };

const MAX_HEIGHT_SHARE = 0.72;
const MAX_WIDTH_SHARE = 0.92;
const FLOOR_SHARE = 0.14;
/** Stand-in for a piece without measurements. */
const UNMEASURED = { w: 50, d: 50, h: 60 };

export function layoutStage(input: readonly StagePiece[], aspect: number): StageLayout {
  if (input.length === 0 || !(aspect > 0)) return { pieces: [], cmPerWindowHeight: 0 };
  const sized = input.map((piece) => ({ ...piece, dims: piece.dimsCm ?? UNMEASURED, measured: piece.dimsCm !== null, flat: piece.flat === true }));
  const standing = sized.filter((piece) => !piece.flat);
  const flat = sized.filter((piece) => piece.flat);

  // Hero in the middle; the rest alternate outwards, shortest nearest the centre.
  const hero = standing.find((piece) => piece.hero === true) ?? [...standing].sort((a, b) => b.dims.h * b.dims.w - a.dims.h * a.dims.w)[0];
  const others = standing.filter((piece) => piece !== hero).sort((a, b) => a.dims.h - b.dims.h || a.id.localeCompare(b.id));
  const left: typeof standing = [];
  const right: typeof standing = [];
  others.forEach((piece, index) => (index % 2 === 0 ? left : right).push(piece));
  const row = [...left.reverse(), ...(hero === undefined ? [] : [hero]), ...right];

  const widths = row.map((piece) => piece.dims.w);
  const averageWidth = widths.length === 0 ? 0 : widths.reduce((sum, width) => sum + width, 0) / widths.length;
  const gap = Math.max(15, 0.12 * averageWidth);
  const rowWidthCm = widths.reduce((sum, width) => sum + width, 0) + gap * Math.max(0, row.length - 1);
  const tallest = Math.max(1, ...row.map((piece) => piece.dims.h));
  const flatWidest = Math.max(0, ...flat.map((piece) => piece.dims.w));
  // One scale for everything, in window heights per centimetre.
  const scale = Math.min(MAX_HEIGHT_SHARE / tallest, (MAX_WIDTH_SHARE * aspect) / Math.max(1, rowWidthCm, flatWidest));

  const toWidthPct = (cm: number) => ((cm * scale) / aspect) * 100;
  const toHeightPct = (cm: number) => cm * scale * 100;

  const placed: PlacedPiece[] = [];
  let cursor = 50 - toWidthPct(rowWidthCm) / 2;
  row.forEach((piece, index) => {
    const widthPct = toWidthPct(piece.dims.w);
    placed.push({
      id: piece.id,
      leftPct: round(cursor),
      widthPct: round(widthPct),
      heightPct: round(toHeightPct(piece.dims.h)),
      bottomPct: FLOOR_SHARE * 100,
      z: piece === hero ? row.length + 1 : row.length - Math.abs(index - row.indexOf(hero!)),
      measured: piece.measured,
      flat: false,
    });
    cursor += widthPct + toWidthPct(gap);
  });
  // A rug lies centred on the floor, under the row, drawn by its footprint.
  flat.forEach((piece) => {
    const widthPct = toWidthPct(piece.dims.w);
    placed.push({
      id: piece.id,
      leftPct: round(50 - widthPct / 2),
      widthPct: round(widthPct),
      // Its depth on the floor; the window tips it back in perspective, so it shows foreshortened.
      heightPct: round(toHeightPct(Math.min(piece.dims.d, piece.dims.w))),
      bottomPct: FLOOR_SHARE * 100 - 4,
      z: 0,
      measured: piece.measured,
      flat: true,
    });
  });
  return { pieces: placed, cmPerWindowHeight: round(1 / scale) };
}

const round = (value: number) => Math.round(value * 100) / 100;

/** Kinds that lie flat on the floor rather than stand. */
export function isFlatKind(kind: string): boolean {
  return kind === "RUG";
}
