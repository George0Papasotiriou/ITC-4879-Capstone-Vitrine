/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Cuts a product out of a white studio background with an edge flood fill.
 */

/**
 * A product cutout from a studio photograph on white, for drawing the product
 * into a room photo.
 *
 * Making every near-white pixel transparent would punch holes in white
 * products (a white lamp shade, a cream sofa). The background is not "white
 * pixels", it is "white pixels connected to the edge of the photo": a flood fill
 * from the border through near-white pixels marks exactly that, and a white
 * shade enclosed by the product's darker outline stays opaque.
 *
 * Edges are softened: pixels next to the background get partial transparency in
 * proportion to how white they are, so the cutout does not show a hard halo.
 *
 * The soft grey shadow a studio leaves under the product is kept as a shadow:
 * black with transparency, so it darkens the room's floor.
 *
 * The result also gives the bounding box of the product inside the photograph,
 * without its shadow. Studio shots leave generous margins, and the true-scale
 * drawing must map the product's height (not the photo's) to its height in
 * centimetres.
 */

export type Cutout = {
  /** RGBA with the background made transparent; same size as the input. */
  rgba: Uint8ClampedArray<ArrayBuffer>;
  width: number;
  height: number;
  /** Tight bounding box of the opaque pixels, in pixels. */
  box: { x: number; y: number; width: number; height: number };
  /** False when the photo's border is not mostly white: no background was removed. */
  removed: boolean;
};

const luminance = (rgba: ArrayLike<number>, i: number) => (0.2126 * rgba[i]! + 0.7152 * rgba[i + 1]! + 0.0722 * rgba[i + 2]!) / 255;

/** Near-white: bright and without colour (the chroma limit keeps pale yellow wood from being eaten). */
function isBackground(rgba: ArrayLike<number>, i: number, threshold: number): boolean {
  const max = Math.max(rgba[i]!, rgba[i + 1]!, rgba[i + 2]!);
  const min = Math.min(rgba[i]!, rgba[i + 1]!, rgba[i + 2]!);
  return luminance(rgba, i) >= threshold && max - min <= 18;
}

export function cutoutFromWhite(
  source: ArrayLike<number>,
  width: number,
  height: number,
  { threshold = 0.93, shadowFloor = 0.7, minBorderShare = 0.9 } = {},
): Cutout {
  const rgba = new Uint8ClampedArray(source);
  const pixel = (x: number, y: number) => (y * width + x) * 4;

  // Is this a photo on white at all? Count border pixels that look like background.
  let border = 0;
  let white = 0;
  for (let x = 0; x < width; x += 1) {
    for (const y of [0, height - 1]) {
      border += 1;
      if (isBackground(rgba, pixel(x, y), threshold)) white += 1;
    }
  }
  for (let y = 1; y < height - 1; y += 1) {
    for (const x of [0, width - 1]) {
      border += 1;
      if (isBackground(rgba, pixel(x, y), threshold)) white += 1;
    }
  }
  if (border === 0 || white / border < minBorderShare) {
    return { rgba, width, height, box: { x: 0, y: 0, width, height }, removed: false };
  }

  // Breadth-first flood fill from every white border pixel (an explicit queue, no recursion).
  const background = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;
  const visit = (x: number, y: number) => {
    const index = y * width + x;
    if (background[index] === 1 || !isBackground(rgba, index * 4, threshold)) return;
    background[index] = 1;
    queue[tail] = index;
    tail += 1;
  };
  for (let x = 0; x < width; x += 1) {
    visit(x, 0);
    visit(x, height - 1);
  }
  for (let y = 0; y < height; y += 1) {
    visit(0, y);
    visit(width - 1, y);
  }
  while (head < tail) {
    const index = queue[head]!;
    head += 1;
    const x = index % width;
    const y = (index - x) / width;
    if (x > 0) visit(x - 1, y);
    if (x < width - 1) visit(x + 1, y);
    if (y > 0) visit(x, y - 1);
    if (y < height - 1) visit(x, y + 1);
  }

  // Studio shadow: light, colourless pixels connected to the background, which
  // photographers leave under a product on purpose. Kept as a shadow (black with
  // transparency in proportion to how dark it is), so it darkens the room's
  // floor instead of pasting a pale patch onto it. A second flood fill from the
  // background, through pixels no darker than `shadowFloor`.
  // Shadows lie under the product: only the lower 40% of the non-background
  // extent may be shadow, so a light grey armchair keeps its back and arms.
  let top = height;
  let bottom = -1;
  for (let index = 0; index < width * height; index += 1) {
    if (background[index] === 1) continue;
    const y = Math.floor(index / width);
    if (y < top) top = y;
    if (y > bottom) bottom = y;
  }
  const shadowFromRow = top + 0.6 * (bottom - top);
  const shadow = new Uint8Array(width * height);
  head = 0;
  tail = 0;
  const isShadowish = (i: number) => {
    if (i / 4 / width < shadowFromRow) return false;
    const max = Math.max(rgba[i]!, rgba[i + 1]!, rgba[i + 2]!);
    const min = Math.min(rgba[i]!, rgba[i + 1]!, rgba[i + 2]!);
    return luminance(rgba, i) >= shadowFloor && max - min <= 14;
  };
  const visitShadow = (x: number, y: number) => {
    const index = y * width + x;
    if (background[index] === 1 || shadow[index] === 1 || !isShadowish(index * 4)) return;
    shadow[index] = 1;
    queue[tail] = index;
    tail += 1;
  };
  for (let index = 0; index < width * height; index += 1) {
    if (background[index] !== 1) continue;
    const x = index % width;
    const y = (index - x) / width;
    if (x > 0) visitShadow(x - 1, y);
    if (x < width - 1) visitShadow(x + 1, y);
    if (y > 0) visitShadow(x, y - 1);
    if (y < height - 1) visitShadow(x, y + 1);
  }
  while (head < tail) {
    const index = queue[head]!;
    head += 1;
    const x = index % width;
    const y = (index - x) / width;
    if (x > 0) visitShadow(x - 1, y);
    if (x < width - 1) visitShadow(x + 1, y);
    if (y > 0) visitShadow(x, y - 1);
    if (y < height - 1) visitShadow(x, y + 1);
  }

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const i = index * 4;
      if (background[index] === 1) {
        rgba[i + 3] = 0;
        continue;
      }
      if (shadow[index] === 1) {
        const darkness = Math.max(0, Math.min(1, (threshold - luminance(rgba, i)) / (threshold - shadowFloor)));
        rgba[i] = 0;
        rgba[i + 1] = 0;
        rgba[i + 2] = 0;
        rgba[i + 3] = Math.round(255 * 0.45 * darkness);
        // Shadow is not the product: it does not count towards the bounding box.
        continue;
      }
      // Soft edge: a foreground pixel touching the background fades with its whiteness.
      const touches =
        (x > 0 && background[index - 1] === 1) ||
        (x < width - 1 && background[index + 1] === 1) ||
        (y > 0 && background[index - width] === 1) ||
        (y < height - 1 && background[index + width] === 1);
      if (touches) {
        const whiteness = Math.max(0, Math.min(1, (luminance(rgba, i) - 0.6) / (threshold - 0.6)));
        rgba[i + 3] = Math.round(rgba[i + 3]! * (1 - 0.8 * whiteness));
      }
      if (rgba[i + 3]! > 24) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  const box = maxX < 0 ? { x: 0, y: 0, width, height } : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
  return { rgba, width, height, box, removed: true };
}
