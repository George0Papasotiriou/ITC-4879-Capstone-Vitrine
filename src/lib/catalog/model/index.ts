/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * A made model of any placeable piece: the right builder for its kind, fitted to its listed size, written as a .glb.
 */

import { buildBeds } from "@/lib/catalog/model/builders/beds";
import { buildLighting } from "@/lib/catalog/model/builders/lighting";
import { buildSeating } from "@/lib/catalog/model/builders/seating";
import { buildBasket, buildPlanter, buildRug } from "@/lib/catalog/model/builders/soft";
import { buildStorage } from "@/lib/catalog/model/builders/storage";
import { buildTables } from "@/lib/catalog/model/builders/tables";
import { context, type Context } from "@/lib/catalog/model/context";
import { canMakeModel, familyOf, type Family } from "@/lib/catalog/model/family";
import { compose, scaling, translation, type Vec3 } from "@/lib/catalog/model/mesh";
import type { Build } from "@/lib/catalog/model/parts";
import { paletteFromWords, type Palette, type PieceFacts } from "@/lib/catalog/model/words";
import { writeModel, type ModelInput, type ModelPart } from "@/lib/catalog/model/write";

/**
 * docs/adr/058. Bump when a change to the modeler should replace the models
 * already stored: the storage key carries it, so old files are simply no
 * longer asked for (nothing is deleted).
 */
export const MODELER_VERSION = 2;

export { canMakeModel, familyOf, type Family };

const BUILDERS: Readonly<Record<Family, (c: Context) => Build>> = {
  seating: buildSeating,
  tables: buildTables,
  lighting: buildLighting,
  storage: buildStorage,
  beds: buildBeds,
  rugs: buildRug,
  planters: buildPlanter,
  baskets: buildBasket,
};

/**
 * Every part moved and stretched together so the whole piece measures exactly
 * the listed width (x), height (y) and depth (z), stands on y = 0 and is
 * centred on x and z. The builders aim for the size themselves; this takes up
 * what is left (a splayed leg's reach, a cushion's crown), so the promise
 * "this is the size it is" holds to the millimetre whatever the style.
 */
export function fitToSize(parts: readonly ModelPart[], size: { w: number; d: number; h: number }): void {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const { mesh } of parts) {
    const box = mesh.bounds();
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis]!, box.min[axis]!);
      max[axis] = Math.max(max[axis]!, box.max[axis]!);
    }
  }
  const extent = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const target = [size.w, size.h, size.d];
  const stretch: Vec3 = [0, 1, 2].map((axis) => (extent[axis]! > 1e-9 ? target[axis]! / extent[axis]! : 1)) as Vec3;
  const move = compose(scaling(stretch), translation([-(min[0] + max[0]) / 2, -min[1], -(min[2] + max[2]) / 2]));
  for (const { mesh } of parts) mesh.transform(move);
}

export type MadeModel = { parts: ModelPart[]; family: Family; triangles: number };

/** The parts of a piece's model, fitted to its size (no file yet: the tests measure these directly). */
export function makeParts(facts: PieceFacts, palette: Palette = paletteFromWords(facts.colors), photo: string | null = null): MadeModel {
  const family = familyOf(facts.kind);
  if (family === null || !canMakeModel(facts.kind, facts.dims)) throw new RangeError(`No model for a ${facts.kind}`);
  const c = context(facts, palette, photo);
  const parts = BUILDERS[family](c).parts.filter((part) => part.mesh.triangleCount > 0);
  fitToSize(parts, c.size);
  return { parts, family, triangles: parts.reduce((sum, part) => sum + part.mesh.triangleCount, 0) };
}

/** The finished .glb of a piece. */
export async function makeModel(facts: PieceFacts, { palette, photos }: { palette?: Palette; photos?: ModelInput["photos"] } = {}): Promise<Uint8Array> {
  const made = makeParts(facts, palette, photos?.rug === undefined ? null : "rug");
  return writeModel({
    name: facts.title,
    parts: made.parts,
    photos,
    extras: { generator: "vitrine-made-model", version: MODELER_VERSION, family: made.family, colours: palette?.source ?? "words" },
  });
}
