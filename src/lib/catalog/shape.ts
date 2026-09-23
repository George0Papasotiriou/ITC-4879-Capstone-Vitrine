/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * A simplified shape for each kind of product, built from its real dimensions.
 */

import type { Part } from "@/lib/catalog/glb";
import { ROOM_PLACEMENT } from "@/lib/catalog/taxonomy";
import { colourSwatch, type Rgb } from "@/lib/vision/palette";
import type { ColorId } from "@/lib/search/vocabulary";

/**
 * The shape of a piece, from what the catalogue knows (docs/adr/025).
 *
 * There is no 3D scan of a photographed sofa, but there is its width, depth
 * and height, and the kind of thing it is. A sofa is a seat, a back and two
 * arms; a table is a top and four legs; a lamp is a base, a stem and a shade.
 * Those few boxes, at the real measurements, answer the question the AR view
 * is there for — how big is this, and does it fit — and they are honest,
 * because the page says a stand-in is what they are.
 *
 * Only the kinds that can stand or lie on a floor get a shape, the same rule
 * the room planner uses: hanging a mirror needs a wall, which neither feature
 * measures.
 */

export type Dimensions = { w: number; d: number; h: number };

/** Centimetres in the catalogue, metres in a model. */
const m = (cm: number) => cm / 100;

const hex = ({ r, g, b }: Rgb) => `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;

/** A shade of the same colour, for parts that read as shadow: legs, a plinth, a base. */
function darker({ r, g, b }: Rgb, amount = 0.72): Rgb {
  return { r: Math.round(r * amount), g: Math.round(g * amount), b: Math.round(b * amount) };
}

/** The colour to build in: the product's first colour word, or a warm grey when it names none. */
export function shapeColour(colors: readonly string[]): Rgb {
  const first = colors[0];
  return first === undefined ? { r: 176, g: 172, b: 166 } : colourSwatch(first as ColorId);
}

/** Whether this kind of product can be shown as a shape at all. */
export function hasShape(kind: string, dims: Dimensions | null): boolean {
  return dims !== null && ROOM_PLACEMENT[kind] !== undefined;
}

/**
 * The parts of a piece, in metres, centred on x and z and standing on y = 0.
 * Sizes that make no sense for the kind (a 20 cm sofa) still produce a shape:
 * the fractions below are all relative, so nothing ever inverts.
 */
export function shapeFor(kind: string, dims: Dimensions, colour: Rgb): Part[] {
  const width = m(dims.w);
  const depth = m(dims.d);
  const height = m(dims.h);
  const main = hex(colour);
  const shade = hex(darker(colour));

  const box = (part: Partial<Part> & { y: number; width: number; height: number; depth: number }): Part => ({
    x: 0,
    z: 0,
    color: main,
    ...part,
  });

  switch (kind) {
    case "SOFA":
    case "CHAIR":
    case "BENCH": {
      // A seat at sitting height, a back above it, and arms when the piece is
      // wide enough to have them.
      const seatTop = Math.min(height * 0.45, 0.48);
      const seatThickness = Math.min(seatTop * 0.5, 0.14);
      const armWidth = Math.min(width * 0.12, 0.16);
      const parts: Part[] = [
        box({ y: (seatTop - seatThickness) / 2, width: width * 0.86, height: seatTop - seatThickness, depth: depth * 0.86, color: shade }),
        box({ y: seatTop - seatThickness / 2, width, height: seatThickness, depth }),
        box({ y: (seatTop + height) / 2, z: -(depth - Math.min(depth * 0.2, 0.12)) / 2, width, height: height - seatTop, depth: Math.min(depth * 0.2, 0.12) }),
      ];
      if (width > 0.7) {
        const armHeight = (height - seatTop) * 0.55;
        for (const side of [-1, 1]) {
          parts.push(box({ x: (side * (width - armWidth)) / 2, y: seatTop + armHeight / 2, width: armWidth, height: armHeight, depth }));
        }
      }
      return parts;
    }

    case "TABLE":
    case "DESK": {
      const topThickness = Math.min(height * 0.12, 0.06);
      const legWidth = Math.min(width, depth) * 0.08;
      const inset = legWidth;
      const parts: Part[] = [box({ y: height - topThickness / 2, width, height: topThickness, depth })];
      for (const x of [-1, 1]) {
        for (const z of [-1, 1]) {
          parts.push(
            box({
              x: (x * (width - legWidth - inset)) / 2,
              z: (z * (depth - legWidth - inset)) / 2,
              y: (height - topThickness) / 2,
              width: legWidth,
              height: height - topThickness,
              depth: legWidth,
              color: shade,
            }),
          );
        }
      }
      return parts;
    }

    case "LAMP":
    case "HOME_LIGHTING_AND_LAMPS": {
      // Tall enough to be a floor lamp, or short enough to be a table one: the
      // shade is a share of the height either way.
      const shadeHeight = Math.min(height * 0.3, 0.32);
      const baseHeight = Math.min(height * 0.06, 0.04);
      const stemWidth = Math.min(width, depth) * 0.12;
      return [
        box({ y: baseHeight / 2, width: width * 0.7, height: baseHeight, depth: depth * 0.7, color: shade }),
        box({ y: (height - shadeHeight) / 2, width: stemWidth, height: height - shadeHeight, depth: stemWidth, color: shade }),
        box({ y: height - shadeHeight / 2, width, height: shadeHeight, depth }),
      ];
    }

    case "BED": {
      const baseHeight = height * 0.35;
      const mattress = height * 0.2;
      const headboard = Math.min(depth * 0.08, 0.08);
      return [
        box({ y: baseHeight / 2, width: width * 0.96, height: baseHeight, depth, color: shade }),
        box({ y: baseHeight + mattress / 2, width, height: mattress, depth: depth * 0.98 }),
        box({ y: height / 2, z: -(depth - headboard) / 2, width, height, depth: headboard }),
      ];
    }

    case "SHELF": {
      // Sides and shelves, so it reads as something you can see through.
      const side = Math.min(width * 0.06, 0.04);
      const parts: Part[] = [
        box({ x: -(width - side) / 2, y: height / 2, width: side, height, depth, color: shade }),
        box({ x: (width - side) / 2, y: height / 2, width: side, height, depth, color: shade }),
      ];
      const levels = Math.max(2, Math.min(5, Math.round(height / 0.4)));
      for (let level = 0; level <= levels; level += 1) {
        parts.push(box({ y: Math.min(height - side / 2, (height * level) / levels + side / 2), width, height: side, depth }));
      }
      return parts;
    }

    case "RUG":
      // A rug is its footprint; the thickness is the pile, not a step.
      return [box({ y: 0.005, width, height: 0.01, depth })];

    default:
      // Cabinets, drawers, baskets, ottomans, planters: a body at true size.
      return [box({ y: height / 2, width, height, depth })];
  }
}
