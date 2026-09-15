/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Catalogue photography processing: white-ground check and web master images.
 */

import { createHash } from "node:crypto";

import sharp from "sharp";

/**
 * Catalogue photography processing: the white-ground check and the web master.
 *
 * Runs in the import script now and in the worker later (Phase 3, step 2), so
 * it lives in the library rather than in a script.
 */

/** The longest edge of the stored master. Comfortably above the largest tile at 2x. */
export const MASTER_EDGE = 1100;

/**
 * Whether a photograph sits on a white studio ground.
 *
 * The plinth treatment (docs/PLAN.md 4.4) blends photographs into the plinth
 * with `mix-blend-mode: multiply`, which dissolves white and turns any other
 * background into a visible dark rectangle. So the check measures what the
 * blend needs: the share of the image border that is near-white and neutral.
 *
 * A proportion, not a mean. A mean is fooled both ways — a white-ground shot
 * where a wide table touches the frame edge averages low, and a pale full-bleed
 * photograph averages high — while "85% of the border is white" is right in
 * both cases.
 */
export function isWhiteGround(rgb: Uint8Array | Buffer, size: number, { border = 3, share = 0.85 } = {}): boolean {
  let white = 0;
  let count = 0;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const onBorder = x < border || y < border || x >= size - border || y >= size - border;
      if (!onBorder) continue;
      const i = (y * size + x) * 3;
      const r = rgb[i]!;
      const g = rgb[i + 1]!;
      const b = rgb[i + 2]!;
      const neutral = Math.max(r, g, b) - Math.min(r, g, b) < 12;
      const bright = (r + g + b) / 3 >= 240;
      if (neutral && bright) white += 1;
      count += 1;
    }
  }
  return count > 0 && white / count >= share;
}

export async function hasWhiteGround(image: Buffer): Promise<boolean> {
  const size = 48;
  const { data } = await sharp(image)
    .resize(size, size, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return isWhiteGround(data, size);
}

export type WebMaster = { body: Buffer; width: number; height: number; contentType: "image/webp" };

/** A WebP master, flattened onto white so transparent PNGs blend like the rest. */
export async function webMaster(image: Buffer): Promise<WebMaster> {
  const { data, info } = await sharp(image)
    .rotate()
    .resize(MASTER_EDGE, MASTER_EDGE, { fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .webp({ quality: 82 })
    .toBuffer({ resolveWithObject: true });
  return { body: data, width: info.width, height: info.height, contentType: "image/webp" };
}

/**
 * The storage key for an imported image. Named by a hash of its source id, so a
 * key never points at different bytes — which is what lets `/media` serve it as
 * immutable — and so keys are valid storage keys whatever characters the
 * source id contains ("81oTHF1PcUL", "71T+bO0FkKL").
 */
export function catalogImageKey(source: string, sourceId: string, imageId: string): string {
  const hash = createHash("sha256").update(imageId).digest("hex").slice(0, 16);
  return `catalog/${source}/${sourceId.toLowerCase().replace(/[^a-z0-9]/g, "")}/${hash}.webp`;
}
