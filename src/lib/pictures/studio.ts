/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * A piece's own photographs, made ready for the image model: which ones, how large, and a close crop of the piece itself.
 */

import { cutoutFromWhite } from "@/lib/vision/cutout";
import { quadFromMask, targetRectangle, warp } from "@/lib/vision/rectify";

/**
 * docs/adr/060. The image model can only copy what it is shown, so a piece is
 * shown well: up to three of its catalogue photographs, its studio shots on
 * white first (the clearest view of its shape and colour), then the others in
 * the listing's order — a second angle shows the back legs a first one hides.
 * Each is sent at up to 1536 px, enough for the model's high-fidelity reading
 * of an object and no more than it reads.
 *
 * A studio photograph often shows the piece small in a wide white frame. The
 * fourth image is the piece itself: cut out of its white (src/lib/vision/
 * cutout.ts), cropped tight with a little margin and enlarged, so its seams,
 * weave and grain fill the frame.
 */

export type PictureImage = { bytes: Uint8Array; contentType: string };

/** A product photograph as the catalogue lists it. */
export type MediaRow = { src: string; kind: string; whiteGround: boolean; position: number };

/** At most this many of a piece's own photographs go to the model (Nano Banana Pro reads six objects in high fidelity). */
export const MAX_REFERENCES = 3;
/** The long side of every image sent to the model. */
export const REFERENCE_LONG_SIDE = 1536;

/** The photographs to show the model, in the order to show them: studio shots on white, then the rest, no repeats. */
export function chooseReferenceMedia(media: readonly MediaRow[], max = MAX_REFERENCES): MediaRow[] {
  const images = media.filter((entry) => entry.kind === "image");
  const ordered = [...images.filter((entry) => entry.whiteGround), ...images.filter((entry) => !entry.whiteGround)].sort(
    (a, b) => Number(b.whiteGround) - Number(a.whiteGround) || a.position - b.position,
  );
  const seen = new Set<string>();
  const chosen: MediaRow[] = [];
  for (const entry of ordered) {
    if (seen.has(entry.src)) continue;
    seen.add(entry.src);
    chosen.push(entry);
    if (chosen.length === max) break;
  }
  return chosen;
}

/** A photograph as the model reads it: upright, at most `longSide` px, a high-quality JPEG with its metadata gone. */
export async function prepareImage(image: PictureImage, longSide = REFERENCE_LONG_SIDE): Promise<PictureImage | null> {
  const { default: sharp } = await import("sharp");
  try {
    const bytes = await sharp(Buffer.from(image.bytes))
      .rotate()
      .resize(longSide, longSide, { fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 92, chromaSubsampling: "4:4:4" })
      .toBuffer();
    return { bytes: new Uint8Array(bytes), contentType: "image/jpeg" };
  } catch {
    return null;
  }
}

/** The studio photograph as RGBA pixels, at most `longSide` px. */
export async function studioPixels(studio: PictureImage, longSide = 900) {
  const { default: sharp } = await import("sharp");
  const { data, info } = await sharp(Buffer.from(studio.bytes)).resize(longSide, longSide, { fit: "inside", withoutEnlargement: true }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength), width: info.width, height: info.height };
}

/**
 * The piece alone: its studio photograph cropped to the piece's own outline
 * (found by cutting it out of its white) with a margin of 6% on every side,
 * on white, enlarged to `longSide`. Null when the photograph is not on white
 * or the piece fills it already (the photograph itself is then the close view).
 */
export async function detailCrop(studio: PictureImage, longSide = REFERENCE_LONG_SIDE): Promise<PictureImage | null> {
  const { default: sharp } = await import("sharp");
  const photo = await studioPixels(studio, 1200).catch(() => null);
  if (photo === null) return null;
  const cut = cutoutFromWhite(photo.data, photo.width, photo.height, { standing: true });
  if (!cut.removed || cut.box.width < 16 || cut.box.height < 16) return null;
  // Already tight: a crop would show nothing the photograph does not.
  if (cut.box.width * cut.box.height > 0.6 * photo.width * photo.height) return null;
  const margin = Math.round(0.06 * Math.max(cut.box.width, cut.box.height));
  const left = Math.max(0, cut.box.x - margin);
  const top = Math.max(0, cut.box.y - margin);
  const width = Math.min(photo.width - left, cut.box.width + 2 * margin);
  const height = Math.min(photo.height - top, cut.box.height + 2 * margin);
  // The crop is taken from the original photograph at its full resolution, not from the 1200 px copy used to find it.
  // Catalogue photographs carry no camera orientation, so the two share their axes.
  const meta = await sharp(Buffer.from(studio.bytes)).metadata();
  const scale = (meta.width ?? photo.width) / photo.width;
  const box = {
    left: Math.floor(left * scale),
    top: Math.floor(top * scale),
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
  };
  try {
    const bytes = await sharp(Buffer.from(studio.bytes))
      .extract({ ...box, width: Math.min(box.width, (meta.width ?? box.width) - box.left), height: Math.min(box.height, (meta.height ?? box.height) - box.top) })
      .resize(longSide, longSide, { fit: "inside" })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 92, chromaSubsampling: "4:4:4" })
      .toBuffer();
    return { bytes: new Uint8Array(bytes), contentType: "image/jpeg" };
  } catch {
    return null;
  }
}

/**
 * A rug's studio photograph made flat, the Showcase's own way (docs/adr/048):
 * cut out, its four corners found, warped to a rectangle of its true
 * proportions — turned, if need be, so its long side runs across the picture.
 */
export async function flatRug(studio: PictureImage, dims: { w: number; d: number }) {
  const photo = await studioPixels(studio);
  const cut = cutoutFromWhite(photo.data, photo.width, photo.height);
  if (!cut.removed) return null;
  const mask = new Uint8Array(cut.width * cut.height);
  for (let index = 0; index < mask.length; index += 1) mask[index] = cut.rgba[index * 4 + 3]! > 200 ? 1 : 0;
  const quad = quadFromMask({ data: mask, width: cut.width, height: cut.height });
  if (quad === null) return null;
  const target = targetRectangle(quad, { long: Math.max(dims.w, dims.d), short: Math.min(dims.w, dims.d) }, 1024);
  const flat = warp(photo, quad, target);
  if (target.width >= target.height) return { data: flat, width: target.width, height: target.height };
  // A quarter turn, so the picture's width is the rug's length.
  const turned = new Uint8ClampedArray(flat.length);
  for (let y = 0; y < target.height; y += 1) {
    for (let x = 0; x < target.width; x += 1) turned.set(flat.subarray((y * target.width + x) * 4, (y * target.width + x) * 4 + 4), (x * target.height + (target.height - 1 - y)) * 4);
  }
  return { data: turned, width: target.height, height: target.width };
}
