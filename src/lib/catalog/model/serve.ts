/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Making a piece's model once and keeping it: read its photograph, build, store under a key that changes when the piece does.
 */

import { createHash } from "node:crypto";

import { canMakeModel, makeModel, MODELER_VERSION } from "@/lib/catalog/model";
import { familyOf } from "@/lib/catalog/model/family";
import { decodePhoto, lookOfPhoto, paletteFromLook } from "@/lib/catalog/model/look";
import { TEXTURE_TILE_M } from "@/lib/catalog/model/textures";
import { paletteFromWords, type Palette, type PieceFacts } from "@/lib/catalog/model/words";
import type { ModelInput } from "@/lib/catalog/model/write";
import { flatRug } from "@/lib/pictures/studio";
import type { StorageDriver } from "@/lib/storage/types";

/**
 * docs/adr/058. A made model costs a second or two to build (its textures,
 * and the photograph it reads its colours from), so it is built when it is
 * first asked for and stored in the bucket; every later request is a redirect
 * to the stored file, which /media serves as immutable.
 *
 * The storage key carries a hash of everything the model is made from — the
 * modeler's version, the piece's kind, words, colours, measurements and
 * photographs — so a merchandiser's correction or a better modeler simply
 * makes a new file under a new key, and nothing else does: not the time the
 * row was last written, which the catalogue sync renews on every deploy.
 * Nothing is ever deleted.
 *
 * A photograph that could not be fetched (the network, not the picture) is
 * not a reason to store a model coloured from words alone for ever: then the
 * model is served without being stored, and the next request tries again.
 */

export type PieceImage = { src: string; width: number; height: number; studio: boolean };
export type ModelPiece = PieceFacts & { studio: string | null; images?: readonly PieceImage[] };

export type ModelDeps = {
  files: Pick<StorageDriver, "exists" | "putObject">;
  /** The piece's studio photograph's bytes, or null when it could not be fetched. */
  photo: (src: string) => Promise<Uint8Array | null>;
};

export const MADE_PREFIX = `catalog/made-3d/v${MODELER_VERSION}/`;

export function madeModelKey(piece: ModelPiece): string {
  const fingerprint = JSON.stringify({
    v: MODELER_VERSION,
    kind: piece.kind,
    title: piece.title,
    attributes: piece.attributes,
    materials: piece.materials,
    colors: piece.colors,
    dims: piece.dims,
    studio: piece.studio,
    images: (piece.images ?? []).map((image) => image.src),
  });
  const hash = createHash("sha256").update(fingerprint).digest("hex").slice(0, 16);
  const slug = piece.slug.replace(/[^a-z0-9-]/gi, "").slice(0, 80);
  return `${MADE_PREFIX}${slug}-${hash}.glb`;
}

export type MadeResult = { key: string; stored: boolean } | { key: null; glb: Uint8Array };

const building = new Map<string, Promise<MadeResult>>();

/** The stored model's key, building and storing it first if need be. Two requests at once build it once. */
export function madeModelFor(piece: ModelPiece, deps: ModelDeps): Promise<MadeResult> {
  if (!canMakeModel(piece.kind, piece.dims)) throw new RangeError(`No model for a ${piece.kind}`);
  const key = madeModelKey(piece);
  let pending = building.get(key);
  if (pending === undefined) {
    pending = build(piece, key, deps).finally(() => building.delete(key));
    building.set(key, pending);
  }
  return pending;
}

async function build(piece: ModelPiece, key: string, deps: ModelDeps): Promise<MadeResult> {
  if (await deps.files.exists(key).catch(() => false)) return { key, stored: true };
  const read = await readPhoto(piece, deps);
  const glb = await makeModel(piece, { palette: read.palette, photos: read.photos });
  if (!read.fetched) return { key: null, glb };
  await deps.files.putObject({ key, body: glb, contentType: "model/gltf-binary" });
  return { key, stored: false };
}

/** What the photograph gives the model: its colours by band and, for a rug, its flattened picture. */
export async function readPhoto(piece: ModelPiece, deps: Pick<ModelDeps, "photo">): Promise<{ fetched: boolean; palette: Palette; photos?: ModelInput["photos"] }> {
  const words = paletteFromWords(piece.colors);
  if (piece.studio === null) return { fetched: true, palette: words };
  const bytes = await deps.photo(piece.studio).catch(() => null);
  if (bytes === null) return { fetched: false, palette: words };
  try {
    const decoded = await decodePhoto(bytes);
    const look = lookOfPhoto(decoded.data, decoded.width, decoded.height);
    const palette = (look === null ? null : paletteFromLook(look, piece.kind)) ?? words;
    if (familyOf(piece.kind) !== "rugs") return { fetched: true, palette };
    const rug = await rugPicture(piece, bytes, deps);
    return rug === null ? { fetched: true, palette } : { fetched: true, palette: rug.palette ?? palette, photos: { rug: rug.photo } };
  } catch {
    // A photograph that cannot be read (not on a white ground, corrupt): the words will do, and that is stored.
    return { fetched: true, palette: words };
  }
}

/**
 * The best picture of a rug's top, in order of faithfulness:
 *
 *   1. its studio photograph on white, cut out and made flat by homography
 *      (pictures/studio.ts flatRug, the Showcase's own way);
 *   2. a photograph whose proportions are the rug's own (within 8%) — a
 *      full-frame product shot, the rug edge to edge — used whole;
 *   3. failing both, a room photograph: its middle is all rug, so a swatch cut
 *      from there is repeated, mirrored, across the model — the rug's own
 *      colours and texture, if not its whole pattern.
 */
async function rugPicture(piece: ModelPiece, studioBytes: Uint8Array, deps: Pick<ModelDeps, "photo">) {
  const { default: sharp } = await import("sharp");
  const long = Math.max(piece.dims.w, piece.dims.d) / 100;
  const short = Math.min(piece.dims.w, piece.dims.d) / 100;
  const pile: [number, number] = [long / TEXTURE_TILE_M.pile, short / TEXTURE_TILE_M.pile];
  const toJpeg = (input: Buffer | Uint8Array, raw?: { width: number; height: number; channels: 4 }) =>
    sharp(Buffer.from(input), raw === undefined ? {} : { raw })
      .removeAlpha()
      .resize(1024, 1024, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 84 })
      .toBuffer()
      .then((buffer) => new Uint8Array(buffer));

  const images = piece.images ?? [];
  const studio = images.find((image) => image.studio && image.src === piece.studio);
  if (studio !== undefined || images.length === 0) {
    const flat = await flatRug({ bytes: studioBytes, contentType: "image/jpeg" }, piece.dims);
    if (flat !== null) {
      const raw = Buffer.from(flat.data.buffer, flat.data.byteOffset, flat.data.byteLength);
      return { photo: { jpeg: await toJpeg(raw, { width: flat.width, height: flat.height, channels: 4 }), repeat: pile }, palette: null };
    }
  }

  const aspect = long / short;
  const fullFrame = images.find((image) => {
    const own = Math.max(image.width, image.height) / Math.min(image.width, image.height);
    return Math.abs(own - aspect) / aspect < 0.08 && Math.abs(own - 1) > 0.05;
  });
  if (fullFrame !== undefined) {
    const bytes = fullFrame.src === piece.studio ? studioBytes : await deps.photo(fullFrame.src).catch(() => null);
    if (bytes !== null) {
      // Turned so the picture's width is the rug's length, as the model lays it.
      const turned = await sharp(Buffer.from(bytes)).rotate(fullFrame.height > fullFrame.width ? 90 : 0).toBuffer();
      return { photo: { jpeg: await toJpeg(turned), repeat: pile }, palette: null };
    }
  }

  // A swatch from the middle of the room photograph, about 0.6 m of rug per repeat.
  const meta = await sharp(Buffer.from(studioBytes)).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (width < 64 || height < 64) return null;
  const side = Math.round(Math.min(width, height) * 0.32);
  const swatch = await sharp(Buffer.from(studioBytes))
    .extract({ left: Math.round(width / 2 - side / 2), top: Math.round(height * 0.58 - side / 2), width: side, height: side })
    .resize(512, 512)
    .jpeg({ quality: 84 })
    .toBuffer();
  return { photo: { jpeg: new Uint8Array(swatch), repeat: pile, swatch: [long / 0.6, short / 0.6] as [number, number] }, palette: null };
}
