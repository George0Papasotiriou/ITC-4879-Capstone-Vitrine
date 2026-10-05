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
 * The white seen *through* a piece — between a table's legs, inside a stool's
 * frame — is enclosed too, but it is the studio's own white: exactly the
 * border's level and flat, where a white part of a product is lit and shaded.
 * Enclosed patches like that, below the top of the piece, are background
 * (docs/adr/053 addendum).
 *
 * Edges are softened: pixels next to the background get partial transparency in
 * proportion to how white they are, so the cutout does not show a hard halo.
 *
 * The soft grey shadow a studio leaves under the product is kept as a shadow:
 * black with transparency, so it darkens the room's floor. A retouched studio
 * shadow can be mid-grey at its core; it is told from a grey product by focus —
 * the shadow is a smooth ramp, the product's outline a sharp step.
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
  {
    threshold = 0.93,
    shadowFloor = 0.7,
    deepShadowFloor = 0.3,
    flatStep = 20,
    minBorderShare = 0.9,
    standing = false,
    openings = false,
  }: {
    threshold?: number;
    shadowFloor?: number;
    deepShadowFloor?: number;
    flatStep?: number;
    minBorderShare?: number;
    /**
     * The photograph is of a piece standing on the studio floor (furniture, a lamp): white seen through it
     * is background, and its shadow may be deep. Off for rugs and wall pieces, whose white motifs, mats
     * and canvases are part of the piece.
     */
    standing?: boolean;
    /**
     * The piece has openings anywhere (a hoop earring, an open heart, a chain's loop): enclosed studio white
     * is background wherever it lies, not only below the top of the piece (the AR Mirror, docs/adr/065).
     */
    openings?: boolean;
  } = {},
): Cutout {
  const rgba = new Uint8ClampedArray(source);
  const pixel = (x: number, y: number) => (y * width + x) * 4;

  // Is this a photo on white at all? Count border pixels that look like background.
  let border = 0;
  let white = 0;
  // The studio's own white, as the border shows it: what background seen through the piece looks like.
  let groundSum = 0;
  const countBorder = (i: number) => {
    border += 1;
    if (!isBackground(rgba, i, threshold)) return;
    white += 1;
    groundSum += luminance(rgba, i) * 255;
  };
  for (let x = 0; x < width; x += 1) {
    for (const y of [0, height - 1]) countBorder(pixel(x, y));
  }
  for (let y = 1; y < height - 1; y += 1) {
    for (const x of [0, width - 1]) countBorder(pixel(x, y));
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

  let top = height;
  let bottom = -1;
  for (let index = 0; index < width * height; index += 1) {
    if (background[index] === 1) continue;
    const y = Math.floor(index / width);
    if (y < top) top = y;
    if (y > bottom) bottom = y;
  }

  // Background seen through the piece: the white between a table's legs or inside a stool's frame, which
  // the fill from the edge cannot reach. Each enclosed patch of near-white is measured as a whole and taken
  // for background only when it is exactly the studio's white (its mean within 2.5 levels of the border's),
  // flat (a standard deviation of at most 2.5 levels, which the anti-aliased rim alone reaches: nothing lit
  // or shaded), and centred below the top 30% of the piece. Measured on the catalogue's photographs, the
  // white between legs and inside frames is 254.6–254.9 on a 255 border with a spread of 0.6–1.7, centred
  // at 46–79% of the height; a real white lamp shade is lit, so darker and uneven, and sits at the top.
  const ground = groundSum / white;
  const gapRow = top + 0.3 * (bottom - top);
  const minGap = Math.max(16, Math.round(width * height * 0.0002));
  const seen = new Uint8Array(width * height);
  for (let start = 0; (standing || openings) && start < width * height; start += 1) {
    if (background[start] === 1 || seen[start] === 1 || !isBackground(rgba, start * 4, threshold)) continue;
    head = 0;
    tail = 0;
    seen[start] = 1;
    queue[tail++] = start;
    let sum = 0;
    let squares = 0;
    let rows = 0;
    while (head < tail) {
      const index = queue[head++]!;
      const light = luminance(rgba, index * 4) * 255;
      sum += light;
      squares += light * light;
      const x = index % width;
      const y = (index - x) / width;
      rows += y;
      for (const next of [x > 0 ? index - 1 : -1, x < width - 1 ? index + 1 : -1, y > 0 ? index - width : -1, y < height - 1 ? index + width : -1]) {
        if (next < 0 || seen[next] === 1 || background[next] === 1 || !isBackground(rgba, next * 4, threshold)) continue;
        seen[next] = 1;
        queue[tail++] = next;
      }
    }
    const mean = sum / tail;
    const spread = Math.sqrt(Math.max(0, squares / tail - mean * mean));
    if (tail >= minGap && Math.abs(mean - ground) <= 2.5 && spread <= 2.5 && (openings || rows / tail >= gapRow)) {
      for (let k = 0; k < tail; k += 1) background[queue[k]!] = 1;
    }
  }

  // Studio shadow: colourless pixels connected to the background, which
  // photographers leave under a product on purpose. Kept as a shadow (black with
  // transparency in proportion to how dark it is), so it darkens the room's
  // floor instead of pasting a pale patch onto it. A second flood fill from the
  // background, through light pixels (no darker than `shadowFloor`) and, at the
  // very bottom, deep but smooth ones (`deepShadowFloor`, `flatStep`).
  // Shadows lie under the product: only the lower 40% of the non-background
  // extent may be light shadow, so a light grey armchair keeps its back and arms,
  // and only the lowest 20% deep shadow, where a studio's shadow lies.
  const shadowFromRow = top + 0.6 * (bottom - top);
  const deepFromRow = top + 0.8 * (bottom - top);
  const shadow = new Uint8Array(width * height);
  head = 0;
  tail = 0;
  // Smooth: no step to a 4-neighbour larger than `flatStep` grey levels. A studio shadow is out of focus, a
  // ramp of at most about 19 levels a pixel from its core to the white (measured on the Canova sofa's
  // photograph); a product is in focus, and its outline steps 38 levels or more within a pixel or two.
  const isFlat = (index: number) => {
    const x = index % width;
    const y = (index - x) / width;
    const own = luminance(rgba, index * 4) * 255;
    for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]] as const) {
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      if (Math.abs(luminance(rgba, (ny * width + nx) * 4) * 255 - own) > flatStep) return false;
    }
    return true;
  };
  const isShadowish = (i: number) => {
    if (i / 4 / width < shadowFromRow) return false;
    const max = Math.max(rgba[i]!, rgba[i + 1]!, rgba[i + 2]!);
    const min = Math.min(rgba[i]!, rgba[i + 1]!, rgba[i + 2]!);
    if (max - min > 14) return false;
    const light = luminance(rgba, i);
    // A light shadow, as before; or a deep one (a studio's retouched shadow can be mid-grey at its core),
    // only where the picture is smooth, so the fill cannot cross a product's edge into a grey product.
    return light >= shadowFloor || (standing && i / 4 / width >= deepFromRow && light >= deepShadowFloor && isFlat(i / 4));
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
