/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The capsule's flat lays: each garment drawn from a handful of curves, in its own fabric colour.
 */

import { CAPSULE_COLOURS, type CapsuleKind, type CapsulePiece } from "@/lib/catalog/capsule";

/**
 * Drawing clothes instead of photographing them (docs/adr/022).
 *
 * Each garment is a closed outline with a few fold lines and a shadow, in the
 * fabric's colour on the white ground the shop's tiles expect. The shapes are
 * deliberately plain: a flat lay is how a shop photographs a folded piece, and
 * a plain one reads at the size of a tile.
 *
 * Two views are drawn for each piece — laid out, and folded — so the grid's
 * hover swap has a second image, as the photographed products do.
 *
 * Everything here is pure: given a piece it returns SVG text. The script turns
 * that into WebP with sharp (scripts/capsule.ts).
 */

/** The square every drawing is composed in; the images are rendered from it. */
export const CANVAS = 1100;

export type View = "flat" | "folded";

const round = (value: number) => Number(value.toFixed(1));

/** A path from points, with an optional close. */
function path(points: readonly (readonly [number, number])[], close = true): string {
  const [first, ...rest] = points;
  if (first === undefined) return "";
  return `M ${round(first[0])} ${round(first[1])} ` + rest.map(([x, y]) => `L ${round(x)} ${round(y)}`).join(" ") + (close ? " Z" : "");
}

/** A rounded blob for a sleeve or a leg: four corners softened by quadratic curves. */
function soft(x: number, y: number, width: number, height: number, radius: number): string {
  const r = Math.min(radius, width / 2, height / 2);
  return [
    `M ${round(x + r)} ${round(y)}`,
    `H ${round(x + width - r)}`,
    `Q ${round(x + width)} ${round(y)} ${round(x + width)} ${round(y + r)}`,
    `V ${round(y + height - r)}`,
    `Q ${round(x + width)} ${round(y + height)} ${round(x + width - r)} ${round(y + height)}`,
    `H ${round(x + r)}`,
    `Q ${round(x)} ${round(y + height)} ${round(x)} ${round(y + height - r)}`,
    `V ${round(y + r)}`,
    `Q ${round(x)} ${round(y)} ${round(x + r)} ${round(y)}`,
    "Z",
  ].join(" ");
}

type Parts = {
  body: string[];
  seams: string[];
  details: string[];
  /** The hem, so the shadow sits under the piece rather than floating below it. */
  bottom: number;
  /** Half the widest part, for the shadow's width. */
  halfWidth: number;
};

const empty = (): Parts => ({ body: [], seams: [], details: [], bottom: CANVAS / 2 + 250, halfWidth: 240 });

/** The shapes of each kind, drawn in a 1100 × 1100 square around the middle. */
function shapesFor(kind: CapsuleKind, view: View): Parts {
  const c = CANVAS / 2;
  const parts = empty();

  if (view === "folded") {
    // Folded: a stack of two rectangles with a soft top edge, whatever the kind.
    const width = kind === "COAT" || kind === "DRESS" ? 520 : 470;
    const height = kind === "TROUSERS" || kind === "SKIRT" ? 330 : 380;
    parts.body.push(soft(c - width / 2, c - height / 2, width, height, 26));
    parts.seams.push(path([[c - width / 2 + 24, c - height / 6], [c + width / 2 - 24, c - height / 6]], false));
    parts.seams.push(path([[c - width / 2 + 24, c + height / 6], [c + width / 2 - 24, c + height / 6]], false));
    parts.details.push(soft(c - width / 2 + 40, c - height / 2 + 26, width - 80, 54, 18));
    parts.bottom = c + height / 2;
    parts.halfWidth = width / 2;
    return parts;
  }

  switch (kind) {
    case "TOP": {
      // Body with short sleeves and a crew neck.
      parts.body.push(
        path([
          [c - 170, c - 250],
          [c - 90, c - 268],
          [c - 60, c - 236],
          [c + 60, c - 236],
          [c + 90, c - 268],
          [c + 170, c - 250],
          [c + 262, c - 92],
          [c + 196, c - 44],
          [c + 176, c - 110],
          [c + 186, c + 250],
          [c - 186, c + 250],
          [c - 176, c - 110],
          [c - 196, c - 44],
          [c - 262, c - 92],
        ]),
      );
      parts.seams.push(`M ${c - 60} ${c - 236} Q ${c} ${c - 196} ${c + 60} ${c - 236}`);
      parts.seams.push(path([[c - 176, c - 110], [c - 196, c - 44]], false));
      parts.seams.push(path([[c + 176, c - 110], [c + 196, c - 44]], false));
      parts.bottom = c + 250;
      parts.halfWidth = 262;
      break;
    }
    case "SHIRT": {
      parts.body.push(
        path([
          [c - 170, c - 250],
          [c - 70, c - 262],
          [c, c - 216],
          [c + 70, c - 262],
          [c + 170, c - 250],
          [c + 250, c - 60],
          [c + 232, c + 190],
          [c + 176, c + 176],
          [c + 186, c + 262],
          [c - 186, c + 262],
          [c - 176, c + 176],
          [c - 232, c + 190],
          [c - 250, c - 60],
        ]),
      );
      // Collar, placket and cuffs.
      parts.details.push(path([[c - 70, c - 262], [c, c - 216], [c + 70, c - 262], [c + 26, c - 292], [c - 26, c - 292]]));
      parts.seams.push(path([[c, c - 216], [c, c + 262]], false));
      parts.seams.push(path([[c - 232, c + 150], [c - 176, c + 136]], false));
      parts.seams.push(path([[c + 232, c + 150], [c + 176, c + 136]], false));
      parts.details.push(...[0, 1, 2, 3].map((index) => circle(c, c - 120 + index * 110, 9)));
      parts.bottom = c + 262;
      parts.halfWidth = 250;
      break;
    }
    case "KNIT": {
      parts.body.push(
        path([
          [c - 178, c - 236],
          [c - 66, c - 252],
          [c, c - 224],
          [c + 66, c - 252],
          [c + 178, c - 236],
          [c + 256, c - 40],
          [c + 214, c + 168],
          [c + 176, c + 156],
          [c + 186, c + 250],
          [c - 186, c + 250],
          [c - 176, c + 156],
          [c - 214, c + 168],
          [c - 256, c - 40],
        ]),
      );
      // A ribbed neck, cuffs and hem: the knit's signature.
      parts.details.push(`M ${c - 66} ${c - 252} Q ${c} ${c - 196} ${c + 66} ${c - 252} Q ${c} ${c - 232} ${c - 66} ${c - 252} Z`);
      parts.seams.push(...ribs(c - 186, c + 214, 372, 36, 9));
      parts.seams.push(...ribs(c - 214, c + 132, 40, 36, 5));
      parts.seams.push(...ribs(c + 174, c + 132, 40, 36, 5));
      parts.bottom = c + 250;
      parts.halfWidth = 256;
      break;
    }
    case "TROUSERS": {
      parts.body.push(
        path([
          [c - 150, c - 300],
          [c + 150, c - 300],
          [c + 168, c - 120],
          [c + 130, c + 320],
          [c + 26, c + 320],
          [c + 8, c - 20],
          [c - 8, c - 20],
          [c - 26, c + 320],
          [c - 130, c + 320],
          [c - 168, c - 120],
        ]),
      );
      parts.details.push(soft(c - 150, c - 300, 300, 54, 12));
      parts.seams.push(path([[c, c - 246], [c, c - 20]], false));
      parts.seams.push(path([[c - 78, c - 246], [c - 92, c + 320]], false));
      parts.seams.push(path([[c + 78, c - 246], [c + 92, c + 320]], false));
      parts.bottom = c + 320;
      parts.halfWidth = 170;
      break;
    }
    case "SKIRT": {
      parts.body.push(
        path([
          [c - 150, c - 240],
          [c + 150, c - 240],
          [c + 250, c + 280],
          [c - 250, c + 280],
        ]),
      );
      parts.details.push(soft(c - 150, c - 240, 300, 50, 12));
      parts.seams.push(path([[c - 60, c - 190], [c - 110, c + 280]], false));
      parts.seams.push(path([[c + 60, c - 190], [c + 110, c + 280]], false));
      parts.bottom = c + 280;
      parts.halfWidth = 250;
      break;
    }
    case "DRESS": {
      parts.body.push(
        path([
          [c - 140, c - 300],
          [c - 60, c - 316],
          [c, c - 276],
          [c + 60, c - 316],
          [c + 140, c - 300],
          [c + 200, c - 196],
          [c + 150, c - 150],
          [c + 130, c - 60],
          [c + 256, c + 320],
          [c - 256, c + 320],
          [c - 130, c - 60],
          [c - 150, c - 150],
          [c - 200, c - 196],
        ]),
      );
      parts.seams.push(`M ${c - 60} ${c - 316} Q ${c} ${c - 262} ${c + 60} ${c - 316}`);
      parts.seams.push(path([[c - 130, c - 60], [c + 130, c - 60]], false));
      parts.seams.push(path([[c - 60, c - 40], [c - 120, c + 320]], false));
      parts.seams.push(path([[c + 60, c - 40], [c + 120, c + 320]], false));
      parts.bottom = c + 320;
      parts.halfWidth = 256;
      break;
    }
    case "COAT": {
      parts.body.push(
        path([
          [c - 190, c - 290],
          [c - 70, c - 300],
          [c, c - 250],
          [c + 70, c - 300],
          [c + 190, c - 290],
          [c + 280, c - 80],
          [c + 240, c + 210],
          [c + 200, c + 196],
          [c + 210, c + 330],
          [c - 210, c + 330],
          [c - 200, c + 196],
          [c - 240, c + 210],
          [c - 280, c - 80],
        ]),
      );
      // Lapels and a belt.
      parts.details.push(path([[c - 70, c - 300], [c, c - 250], [c - 30, c - 120], [c - 96, c - 230]]));
      parts.details.push(path([[c + 70, c - 300], [c, c - 250], [c + 30, c - 120], [c + 96, c - 230]]));
      parts.details.push(soft(c - 204, c + 40, 408, 34, 10));
      parts.seams.push(path([[c, c - 250], [c, c + 330]], false));
      parts.bottom = c + 330;
      parts.halfWidth = 280;
      break;
    }
    case "JACKET": {
      parts.body.push(
        path([
          [c - 180, c - 260],
          [c - 66, c - 272],
          [c, c - 226],
          [c + 66, c - 272],
          [c + 180, c - 260],
          [c + 258, c - 70],
          [c + 222, c + 150],
          [c + 186, c + 138],
          [c + 196, c + 250],
          [c - 196, c + 250],
          [c - 186, c + 138],
          [c - 222, c + 150],
          [c - 258, c - 70],
        ]),
      );
      parts.details.push(path([[c - 66, c - 272], [c, c - 226], [c - 24, c - 100], [c - 92, c - 210]]));
      parts.details.push(path([[c + 66, c - 272], [c, c - 226], [c + 24, c - 100], [c + 92, c - 210]]));
      parts.details.push(soft(c - 150, c + 60, 96, 20, 8));
      parts.details.push(soft(c + 54, c + 60, 96, 20, 8));
      parts.seams.push(path([[c, c - 226], [c, c + 250]], false));
      parts.bottom = c + 250;
      parts.halfWidth = 258;
      break;
    }
  }
  return parts;
}

const circle = (cx: number, cy: number, r: number) => `M ${round(cx - r)} ${round(cy)} a ${r} ${r} 0 1 0 ${r * 2} 0 a ${r} ${r} 0 1 0 ${-r * 2} 0 Z`;

/** Evenly spaced vertical lines: a rib, a pleat, a corduroy. */
function ribs(x: number, y: number, width: number, height: number, count: number): string[] {
  const step = width / (count + 1);
  return Array.from({ length: count }, (_, index) => path([[x + step * (index + 1), y], [x + step * (index + 1), y + height]], false));
}

/**
 * One drawing as SVG. The ground is the shop's white studio ground, so the
 * tiles can dissolve it the way they do a photograph.
 */
export function garmentSvg(piece: Pick<CapsulePiece, "kind" | "color" | "titleEn">, view: View = "flat"): string {
  const colour = CAPSULE_COLOURS[piece.color] ?? CAPSULE_COLOURS.ecru!;
  const parts = shapesFor(piece.kind, view);
  const middle = CANVAS / 2;
  // The piece rests on its own shadow, whatever its length.
  const shadow = `<ellipse cx="${middle}" cy="${round(parts.bottom + 18)}" rx="${round(parts.halfWidth * 0.92)}" ry="20" fill="rgba(29,35,48,0.06)" />`;
  // Drawn a little larger than its own coordinates, so a tile is filled the way a photograph fills it.
  const zoom = `translate(${middle} ${middle}) scale(1.1) translate(${-middle} ${-middle})`;

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CANVAS} ${CANVAS}" width="${CANVAS}" height="${CANVAS}" role="img" aria-label="${escapeXml(piece.titleEn)}">`,
    `<rect width="${CANVAS}" height="${CANVAS}" fill="#ffffff" />`,
    `<g transform="${zoom}">`,
    shadow,
    ...parts.body.map((d) => `<path d="${d}" fill="${colour.fill}" stroke="${colour.line}" stroke-width="3" stroke-linejoin="round" />`),
    ...parts.details.map((d) => `<path d="${d}" fill="${colour.shade}" stroke="${colour.line}" stroke-width="2.5" stroke-linejoin="round" />`),
    ...parts.seams.map((d) => `<path d="${d}" fill="none" stroke="${colour.line}" stroke-width="2" stroke-linecap="round" opacity="0.65" />`),
    "</g>",
    "</svg>",
  ].join("\n");
}

export function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);
}
