/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The pieces the AR Mirror can put on: how big each really is, and the one earring to take from a photograph of a pair.
 */

/**
 * docs/adr/065. The mirror puts a piece's own studio photograph on the
 * face, cut out of its white ground (cutout.ts), at the piece's true size.
 * The catalogue holds no measurements for jewellery or hats (a box's size is
 * not a ring's), so the size comes from the listing's own words when it says
 * ("10mm Polished Ball Studs", "Pendant Necklace 18\"") and otherwise from
 * what the kind of piece usually measures, stated as such on screen.
 */

export const MIRROR_KINDS = ["HAT", "EARRING", "NECKLACE"] as const;
export type MirrorKind = (typeof MIRROR_KINDS)[number];
export const isMirrorKind = (kind: string): kind is MirrorKind => (MIRROR_KINDS as readonly string[]).includes(kind);

export type EarringStyle = "stud" | "hoop" | "drop" | "threader" | "other";

/** What the title says the earring is. */
export function earringStyle(title: string): EarringStyle {
  if (/\bstuds?\b|\bpost\b/i.test(title)) return "stud";
  if (/\bthreader/i.test(title)) return "threader";
  if (/\bhoops?\b/i.test(title)) return "hoop";
  if (/\b(drops?|dangle|chandelier|tassel|teardrop|linear|french wire|leverback|lever-back)\b/i.test(title)) return "drop";
  return "other";
}

/** Typical length of an earring as it hangs, millimetres, by style: a stud's face, a hoop's diameter, a drop's length. */
const EARRING_TYPICAL_MM: Record<EarringStyle, number> = { stud: 8, hoop: 40, drop: 35, threader: 60, other: 25 };

/** A measurement in the title, in millimetres: "10mm", "1.5 inch", "18\"". */
export function titleMillimetres(title: string): number[] {
  const out: number[] = [];
  for (const match of title.matchAll(/(\d+(?:\.\d+)?)\s*mm\b/gi)) out.push(Number(match[1]));
  for (const match of title.matchAll(/(\d+(?:\.\d+)?)\s*(?:"|”|in\b|inch(?:es)?\b)/gi)) out.push(Number(match[1]) * 25.4);
  for (const match of title.matchAll(/(\d+(?:\.\d+)?)\s*cm\b/gi)) out.push(Number(match[1]) * 10);
  return out;
}

/**
 * An earring's drawn height in true millimetres. A measurement in the title
 * between 3 mm and 10 cm is the earring's (anything else is a chain or a
 * gemstone's weight in another unit).
 */
export function earringHeightMm(title: string): { mm: number; from: "title" | "typical"; style: EarringStyle } {
  const style = earringStyle(title);
  const measured = titleMillimetres(title).filter((mm) => mm >= 3 && mm <= 100);
  if (measured.length > 0) return { mm: Math.max(...measured), from: "title", style };
  return { mm: EARRING_TYPICAL_MM[style], from: "typical", style };
}

/**
 * A necklace is photographed as worn, the chain rising out of the top of the
 * picture: the photograph's width is the width of the neck it goes round
 * plus a little, about 13 cm, and its length follows from its proportions.
 * A chain length in the title (14″–36″) only says how far down it hangs,
 * which the photograph already shows.
 */
export const NECKLACE_WIDTH_MM = 130;

/** A hat in front view is as wide as the head times this: close-fitting caps and beanies a little wider, brims much wider. */
export function hatWidthFactor(title: string): number {
  if (/\b(wide brim|sun hat|safari|aussie|breezer|bucket|derby|bowler|fedora|gatsby|poncho|cowboy|panama|church)\b/i.test(title)) return 1.55;
  if (/\b(beanie|beret|cap|cloche|newsboy|cabbie|cadet|skull)\b/i.test(title)) return 1.12;
  return 1.3;
}

/* -------------------------------------------------------------------------- */
/* One earring out of a pair                                                  */
/* -------------------------------------------------------------------------- */

export type Box = { x: number; y: number; width: number; height: number };

/**
 * Earrings are photographed as a pair, side by side; the mirror needs one
 * for each ear. The cut-out's opaque pixels are split into connected shapes
 * (4-neighbour flood fill over alpha ≥ 32). The largest shape is kept, with
 * any shape whose box overlaps it (a hook that is not quite connected); a
 * photograph of one piece keeps its whole box. Returns the box to crop to.
 */
export function oneEarring(alpha: ArrayLike<number>, width: number, height: number): Box | null {
  const label = new Int32Array(width * height).fill(-1);
  const shapes: { area: number; box: Box }[] = [];
  const stack: number[] = [];
  for (let start = 0; start < width * height; start += 1) {
    if (label[start] !== -1 || alpha[start]! < 32) continue;
    const id = shapes.length;
    let area = 0;
    let x0 = width;
    let y0 = height;
    let x1 = -1;
    let y1 = -1;
    label[start] = id;
    stack.push(start);
    while (stack.length > 0) {
      const index = stack.pop()!;
      const x = index % width;
      const y = (index - x) / width;
      area += 1;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (const next of [x > 0 ? index - 1 : -1, x < width - 1 ? index + 1 : -1, y > 0 ? index - width : -1, y < height - 1 ? index + width : -1]) {
        if (next >= 0 && label[next] === -1 && alpha[next]! >= 32) {
          label[next] = id;
          stack.push(next);
        }
      }
    }
    shapes.push({ area, box: { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 } });
  }
  if (shapes.length === 0) return null;
  // Specks of dust or noise are not earrings.
  const total = shapes.reduce((sum, shape) => sum + shape.area, 0);
  const real = shapes.filter((shape) => shape.area >= total * 0.02);
  const largest = real.reduce((best, shape) => (shape.area > best.area ? shape : best));
  const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  let box = largest.box;
  for (const shape of real) {
    if (shape === largest || !overlaps(shape.box, largest.box)) continue;
    const x = Math.min(box.x, shape.box.x);
    const y = Math.min(box.y, shape.box.y);
    box = { x, y, width: Math.max(box.x + box.width, shape.box.x + shape.box.width) - x, height: Math.max(box.y + box.height, shape.box.y + shape.box.height) - y };
  }
  return box;
}
