/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Prepares a photo for a depth model and maps the model's depth map back onto the photo.
 */

/**
 * The two pieces of plumbing around a depth model, kept away from the model
 * itself so they can be tested without one.
 *
 * A depth model takes a square image of a fixed size (518 × 518 for Depth
 * Anything V2, whose backbone works in 14-pixel patches) and answers with a
 * depth map of that same square. A room photo is neither square nor that size,
 * so it is letterboxed: scaled to fit, centred, and the remaining strip filled
 * with grey. Stretching instead would change the shape of everything in the
 * picture, and the geometry that follows would be measuring the wrong room.
 *
 * Afterwards the depth map has to come back to the photo's own pixels, because
 * that is where the camera matrix K lives. The inverse of the letterbox does
 * that, sampling bilinearly; the padded strips are never sampled.
 */

/** ImageNet statistics, the normalisation Depth Anything and most vision backbones were trained with. */
export const IMAGENET_MEAN: readonly [number, number, number] = [0.485, 0.456, 0.406];
export const IMAGENET_STD: readonly [number, number, number] = [0.229, 0.224, 0.225];

export type Letterbox = {
  /** Model input, planar RGB (1 × 3 × size × size), normalised. */
  tensor: Float32Array;
  size: number;
  /** Photo pixels per model pixel. */
  scale: number;
  /** Where the photo starts inside the square, model pixels. */
  dx: number;
  dy: number;
  /** The photo's size inside the square, model pixels. */
  innerWidth: number;
  innerHeight: number;
};

/**
 * Scales the photo to fit a square of `size`, centres it, and writes it as a
 * normalised planar tensor. Sampling is bilinear, which matters when a 12
 * megapixel photo is reduced to 518 pixels: nearest-neighbour would alias
 * furniture edges into noise the model then reads as structure.
 */
export function letterbox(
  rgba: ArrayLike<number>,
  width: number,
  height: number,
  size: number,
  { mean = IMAGENET_MEAN, std = IMAGENET_STD, pad = 0.5 } = {},
): Letterbox {
  if (!(width > 0 && height > 0 && size > 0)) throw new RangeError("Image and model sizes must be positive");
  const fit = Math.min(size / width, size / height);
  const innerWidth = Math.max(1, Math.round(width * fit));
  const innerHeight = Math.max(1, Math.round(height * fit));
  const dx = Math.floor((size - innerWidth) / 2);
  const dy = Math.floor((size - innerHeight) / 2);
  const scale = width / innerWidth;

  const tensor = new Float32Array(3 * size * size);
  // The padding is grey, and normalised like everything else.
  for (let channel = 0; channel < 3; channel += 1) {
    tensor.fill((pad - mean[channel]!) / std[channel]!, channel * size * size, (channel + 1) * size * size);
  }

  for (let y = 0; y < innerHeight; y += 1) {
    // Pixel centres: model pixel y + 0.5 sits at photo pixel (y + 0.5)·scale.
    const sourceY = (y + 0.5) * scale - 0.5;
    for (let x = 0; x < innerWidth; x += 1) {
      const sourceX = (x + 0.5) * scale - 0.5;
      const [r, g, b] = sampleRgb(rgba, width, height, sourceX, sourceY);
      const index = (y + dy) * size + (x + dx);
      tensor[index] = (r / 255 - mean[0]!) / std[0]!;
      tensor[size * size + index] = (g / 255 - mean[1]!) / std[1]!;
      tensor[2 * size * size + index] = (b / 255 - mean[2]!) / std[2]!;
    }
  }
  return { tensor, size, scale, dx, dy, innerWidth, innerHeight };
}

/** Bilinear read of an RGBA image, clamped at the border. */
function sampleRgb(rgba: ArrayLike<number>, width: number, height: number, x: number, y: number): [number, number, number] {
  const x0 = Math.min(width - 1, Math.max(0, Math.floor(x)));
  const y0 = Math.min(height - 1, Math.max(0, Math.floor(y)));
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const fx = Math.min(1, Math.max(0, x - x0));
  const fy = Math.min(1, Math.max(0, y - y0));
  const out: [number, number, number] = [0, 0, 0];
  for (let channel = 0; channel < 3; channel += 1) {
    const a = rgba[(y0 * width + x0) * 4 + channel]!;
    const b = rgba[(y0 * width + x1) * 4 + channel]!;
    const c = rgba[(y1 * width + x0) * 4 + channel]!;
    const d = rgba[(y1 * width + x1) * 4 + channel]!;
    out[channel] = (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  }
  return out;
}

/**
 * The model's square depth map, back on the photo's pixels.
 *
 * Reads are clamped to the letterboxed photo, never to the grey strips: a photo
 * pixel on the very edge maps half a model pixel outside the picture, and
 * bilinear sampling would otherwise mix a padding value into it. That showed up
 * as a band of impossible depths along the top and bottom of wide photos, which
 * the floor finder then fitted a plane to.
 */
export function depthToPhoto(
  depth: ArrayLike<number>,
  box: Letterbox,
  width: number,
  height: number,
): { data: Float32Array; width: number; height: number } {
  const out = new Float32Array(width * height);
  const inside = (value: number, start: number, length: number) => Math.min(start + length - 1, Math.max(start, value));
  for (let y = 0; y < height; y += 1) {
    const modelY = inside((y + 0.5) / box.scale - 0.5 + box.dy, box.dy, box.innerHeight);
    for (let x = 0; x < width; x += 1) {
      const modelX = inside((x + 0.5) / box.scale - 0.5 + box.dx, box.dx, box.innerWidth);
      out[y * width + x] = sampleScalar(depth, box.size, box.size, modelX, modelY);
    }
  }
  return { data: out, width, height };
}

/** Bilinear read of a single-channel map, clamped at the border. */
function sampleScalar(data: ArrayLike<number>, width: number, height: number, x: number, y: number): number {
  const x0 = Math.min(width - 1, Math.max(0, Math.floor(x)));
  const y0 = Math.min(height - 1, Math.max(0, Math.floor(y)));
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const fx = Math.min(1, Math.max(0, x - x0));
  const fy = Math.min(1, Math.max(0, y - y0));
  const a = data[y0 * width + x0]!;
  const b = data[y0 * width + x1]!;
  const c = data[y1 * width + x0]!;
  const d = data[y1 * width + x1]!;
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
}

/**
 * What share of a depth map carries a reading, and how far it reaches. A model
 * that answers mostly zeros, or a photo of a blank wall where everything is at
 * one distance, is not something to place furniture with.
 */
export function depthStats(depth: { data: ArrayLike<number>; width: number; height: number }): {
  valid: number;
  median: number;
  min: number;
  max: number;
} {
  const values: number[] = [];
  for (let i = 0; i < depth.width * depth.height; i += 1) {
    const z = depth.data[i]!;
    if (z > 0 && Number.isFinite(z)) values.push(z);
  }
  if (values.length === 0) return { valid: 0, median: 0, min: 0, max: 0 };
  values.sort((a, b) => a - b);
  return {
    valid: values.length / (depth.width * depth.height),
    median: values[Math.floor(values.length / 2)]!,
    min: values[0]!,
    max: values[values.length - 1]!,
  };
}
