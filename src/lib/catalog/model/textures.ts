/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Seamless material textures drawn in code: wood grain, weaves, leather, marble, brushed metal, glaze, wicker.
 */

/**
 * docs/adr/058. A made model's surfaces need the detail a real piece has up
 * close — the grain in an oak top, the over-and-under of a linen weave, the
 * creases of leather — or they read as plastic. No photograph of a texture is
 * used (nothing to license, nothing to download): each is drawn here from
 * noise, the way film and game studios make procedural materials.
 *
 * Every texture tiles: its noise is periodic (the lattice wraps at the tile's
 * edge), so the left edge continues the right one and the top the bottom.
 * Each set is three images:
 *
 *   albedo  a grey detail map; the piece's own colour (from its photograph)
 *           multiplies it, so one set serves every colour of oak or velvet;
 *   normal  which way each texel faces, worked out from a height map by
 *           central differences — the light then picks out threads and grain;
 *   orm     occlusion (red), roughness (green) and metalness (blue) packed in
 *           one image, the glTF layout.
 *
 * Images are JPEG: every AR viewer reads it (Quick Look does not read WebP).
 */

export const TEXTURE_KINDS = ["weave", "linen", "velvet", "boucle", "leather", "wood", "marble", "brushed", "ceramic", "rattan", "pile", "jute"] as const;
export type TextureKind = (typeof TEXTURE_KINDS)[number];

/** The width of one repeat on the piece, metres: a weave repeats every few centimetres, marble every metre. */
export const TEXTURE_TILE_M: Readonly<Record<TextureKind, number>> = {
  weave: 0.05,
  linen: 0.09,
  velvet: 0.25,
  boucle: 0.09,
  leather: 0.3,
  wood: 0.45,
  marble: 0.9,
  brushed: 0.35,
  ceramic: 0.3,
  rattan: 0.16,
  pile: 0.14,
  jute: 0.18,
};

export type TextureSet = {
  kind: TextureKind;
  albedo: Uint8Array;
  normal: Uint8Array;
  orm: Uint8Array;
  /** The albedo's average in linear light: the base colour is divided by it, so the piece's colour comes out as photographed. */
  meanLinear: number;
  size: number;
};

/**
 * Pixels per side. Large features (growth rings, marble veins) need 512;
 * the fine ones (threads, grain, loops) read just as well at 256, and a
 * quarter of the pixels keeps each model's download small.
 */
export const TEXTURE_SIZE: Readonly<Record<TextureKind, number>> = {
  weave: 256,
  linen: 256,
  velvet: 256,
  boucle: 256,
  leather: 256,
  wood: 512,
  marble: 512,
  brushed: 256,
  ceramic: 256,
  rattan: 256,
  pile: 256,
  jute: 256,
};

// ─── Periodic noise ─────────────────────────────────────────────────────────

const mod = (a: number, n: number) => ((a % n) + n) % n;

/** A well-mixed 32-bit hash of a lattice point, as a number in [0, 1). */
function hash(x: number, y: number, seed: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * Gradient (Perlin) noise that repeats every `period` lattice cells: the
 * lattice coordinates wrap before they are hashed, so cell `period` is cell 0
 * again. Each lattice point has a random unit gradient; the value at (x, y)
 * blends the four corners' ramps with a smoothstep. Range about −0.7 … 0.7.
 */
/** Each lattice's gradients, worked out once: (cos, sin) of a hashed angle per lattice point. */
const lattices = new Map<number, Float32Array>();
function lattice(periodX: number, periodY: number, seed: number): Float32Array {
  // A number, not a string: this is asked for millions of times while a texture is drawn.
  const key = periodX + periodY * 8192 + seed * 67_108_864;
  let table = lattices.get(key);
  if (table === undefined) {
    table = new Float32Array(periodX * periodY * 2);
    for (let y = 0; y < periodY; y += 1) {
      for (let x = 0; x < periodX; x += 1) {
        const angle = hash(x, y, seed) * Math.PI * 2;
        table[(y * periodX + x) * 2] = Math.cos(angle);
        table[(y * periodX + x) * 2 + 1] = Math.sin(angle);
      }
    }
    lattices.set(key, table);
  }
  return table;
}

function gradientXY(x: number, y: number, periodX: number, periodY: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const table = lattice(periodX, periodY, seed);
  const corner = (cx: number, cy: number, dx: number, dy: number) => {
    const i = (mod(cy, periodY) * periodX + mod(cx, periodX)) * 2;
    return table[i]! * dx + table[i + 1]! * dy;
  };
  const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
  const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
  const a = corner(xi, yi, xf, yf);
  const b = corner(xi + 1, yi, xf - 1, yf);
  const c = corner(xi, yi + 1, xf, yf - 1);
  const d = corner(xi + 1, yi + 1, xf - 1, yf - 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Fractal noise: octaves of gradient noise, each twice as fine and half as strong; (x, y) in tile units [0, 1). */
function fbm(x: number, y: number, cells: number, octaves: number, seed: number, stretch: [number, number] = [1, 1]): number {
  let sum = 0;
  let amplitude = 0.5;
  let frequency = 1;
  for (let o = 0; o < octaves; o += 1) {
    // Whole numbers of cells across the tile in each direction, or the noise would not meet itself at the edge.
    const px = Math.max(1, Math.round(cells * stretch[0] * frequency));
    const py = Math.max(1, Math.round(cells * stretch[1] * frequency));
    sum += amplitude * gradientXY(x * px, y * py, px, py, seed + o * 31);
    amplitude *= 0.5;
    frequency *= 2;
  }
  return sum;
}

/**
 * Cellular (Worley) noise, periodic: one random point per cell of a
 * `cells` × `cells` grid; for each texel the distances to the nearest (f1) and
 * second-nearest (f2) points, in cell units. f2 − f1 is near zero along the
 * borders between cells — the creases of leather, the gaps between pebbles.
 */
const featureTables = new Map<number, Float32Array>();
function features(cells: number, seed: number): Float32Array {
  const key = cells + seed * 8192;
  let table = featureTables.get(key);
  if (table === undefined) {
    table = new Float32Array(cells * cells * 2);
    for (let y = 0; y < cells; y += 1) {
      for (let x = 0; x < cells; x += 1) {
        table[(y * cells + x) * 2] = hash(x, y, seed);
        table[(y * cells + x) * 2 + 1] = hash(x, y, seed + 7);
      }
    }
    featureTables.set(key, table);
  }
  return table;
}

function worley(x: number, y: number, cells: number, seed: number): { f1: number; f2: number } {
  const px = x * cells;
  const py = y * cells;
  const cx = Math.floor(px);
  const cy = Math.floor(py);
  const table = features(cells, seed);
  let f1 = Infinity;
  let f2 = Infinity;
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      const gx = cx + dx;
      const gy = cy + dy;
      const i = (mod(gy, cells) * cells + mod(gx, cells)) * 2;
      const fx = gx + table[i]!;
      const fy = gy + table[i + 1]!;
      const d = Math.hypot(px - fx, py - fy);
      if (d < f1) {
        f2 = f1;
        f1 = d;
      } else if (d < f2) f2 = d;
    }
  }
  return { f1, f2 };
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

// ─── The materials ──────────────────────────────────────────────────────────

/** What a texel is: height (for the normal map), albedo detail, roughness, occlusion — all 0…1. */
type Texel = { h: number; a: number; r: number; o: number };

/**
 * A plain weave: threads along x (warp) and y (weft) passing over and under
 * each other on a checkerboard. Within a cell the thread on top is a rounded
 * ridge; `slub` adds the irregular thickening of a natural yarn.
 */
function weave(x: number, y: number, threads: number, slub: number, seed: number): Texel {
  const tx = x * threads;
  const ty = y * threads;
  const ix = Math.floor(tx);
  const iy = Math.floor(ty);
  const fx = tx - ix;
  const fy = ty - iy;
  const warpOnTop = (ix + iy) % 2 === 0;
  // A ridge across the thread, and a dip where it dives under its neighbour.
  const across = warpOnTop ? Math.sin(Math.PI * fy) : Math.sin(Math.PI * fx);
  const along = warpOnTop ? Math.sin(Math.PI * fx) : Math.sin(Math.PI * fy);
  const thickness = 1 + slub * fbm(x, y, 6, 3, seed, warpOnTop ? [1, 4] : [4, 1]);
  const h = clamp01(0.25 + 0.55 * across ** 0.6 * (0.6 + 0.4 * along) * thickness);
  const fibre = 0.04 * fbm(x, y, threads, 2, seed + 3);
  return { h, a: clamp01(0.8 + 0.18 * h + fibre + 0.06 * slub * fbm(x, y, 5, 2, seed + 9)), r: 0.88 + 0.08 * (1 - h), o: 0.7 + 0.3 * h };
}

function texel(kind: TextureKind, x: number, y: number): Texel {
  switch (kind) {
    case "weave":
      return weave(x, y, 40, 0.12, 11);
    case "linen":
      return weave(x, y, 34, 0.45, 23);
    case "velvet": {
      // Pile too fine to see; what shows is the crush — soft patches where the nap lies differently.
      const crush = fbm(x, y, 4, 4, 41);
      const fine = fbm(x, y, 64, 2, 43);
      return { h: clamp01(0.5 + 0.2 * crush + 0.15 * fine), a: clamp01(0.93 + 0.07 * crush + 0.03 * fine), r: 0.84 + 0.06 * crush, o: 0.96 + 0.04 * crush };
    }
    case "boucle": {
      // Loops of yarn: a pebbled surface of small bumps.
      const { f1 } = worley(x, y, 22, 51);
      const { f1: g1 } = worley(x + 0.37, y + 0.11, 31, 53);
      const bump = clamp01(1 - f1 * 1.25) * 0.6 + clamp01(1 - g1 * 1.25) * 0.4;
      return { h: bump, a: clamp01(0.78 + 0.24 * bump + 0.05 * fbm(x, y, 8, 2, 55)), r: 0.9, o: 0.6 + 0.4 * bump };
    }
    case "leather": {
      // Grain: cells of hide separated by fine creases (where f2 − f1 is small), with pores.
      const { f1, f2 } = worley(x, y, 30, 61);
      const crease = 1 - smoothstep(0, 0.14, f2 - f1);
      const pores = fbm(x, y, 96, 2, 63);
      const mottle = fbm(x, y, 3, 3, 65);
      const h = clamp01(0.72 - 0.5 * crease + 0.08 * pores);
      return { h, a: clamp01(0.92 + 0.05 * mottle - 0.07 * crease), r: clamp01(0.6 + 0.15 * crease + 0.04 * mottle), o: 1 - 0.25 * crease };
    }
    case "wood": {
      // Flat-sawn boards seen along the grain (x): fine growth lines running nearly straight, wandering a
      // little; open pores drawn out along the grain; each board a shade lighter or darker than the next.
      const board = Math.floor(y * 4);
      const tone = (hash(board, 0, 79) - 0.5) * 0.06;
      const wander = 1.6 * fbm(x, y, 1, 4, 71, [1, 4]) + 0.25 * fbm(x, y, 3, 2, 73, [1, 2]);
      const line = (((y * 64 + wander * 6) % 1) + 1) % 1;
      const latewood = smoothstep(0.62, 0.9, line) * (1 - smoothstep(0.9, 1, line));
      const pores = fbm(x, y, 6, 3, 75, [1, 32]);
      const a = clamp01(0.84 + tone - 0.11 * latewood + 0.05 * pores);
      return { h: clamp01(0.55 - 0.12 * latewood + 0.3 * pores), a, r: clamp01(0.62 + 0.1 * latewood + 0.06 * pores), o: 0.94 + 0.06 * (1 - latewood) };
    }
    case "marble": {
      // Veins: where a turbulent sine crosses zero, a fine dark line; a second, fainter family crosses it.
      const turbulence = fbm(x, y, 3, 5, 81);
      const vein = 1 - Math.abs(Math.sin(Math.PI * 2 * (2 * x + 1 * y) + turbulence * 7));
      const fine = 1 - Math.abs(Math.sin(Math.PI * 2 * (3 * x - 2 * y) + fbm(x, y, 5, 4, 83) * 9));
      const cloud = fbm(x, y, 4, 4, 85);
      const a = clamp01(0.97 - 0.45 * vein ** 14 - 0.18 * fine ** 22 + 0.04 * cloud);
      return { h: 0.5 + 0.02 * cloud, a, r: 0.14 + 0.06 * vein ** 8, o: 1 };
    }
    case "brushed": {
      // Streaks along x from brushing: noise stretched hundreds of times along the stroke.
      const streak = fbm(x, y, 3, 4, 91, [1, 90]);
      return { h: 0.5 + 0.25 * streak, a: clamp01(0.94 + 0.06 * streak), r: clamp01(0.34 + 0.12 * streak), o: 1 };
    }
    case "ceramic": {
      // A glaze: gentle pooling, and the odd speck of iron in the clay.
      const pool = fbm(x, y, 3, 4, 101);
      const speck = hash(Math.floor(x * 220), Math.floor(y * 220), 103) > 0.993 ? 1 : 0;
      return { h: 0.5 + 0.06 * pool, a: clamp01(0.95 + 0.06 * pool - 0.35 * speck), r: clamp01(0.22 + 0.08 * pool), o: 1 };
    }
    case "rattan": {
      // A basket weave of flat strands, two over two under, with dark gaps between them.
      const strands = 12;
      const tx = x * strands;
      const ty = y * strands;
      const ix = Math.floor(tx);
      const iy = Math.floor(ty);
      const fx = tx - ix;
      const fy = ty - iy;
      const horizontal = (Math.floor(ix / 2) + Math.floor(iy / 2)) % 2 === 0;
      const across = horizontal ? fy : fx;
      const along = horizontal ? fx : fy;
      const edge = smoothstep(0, 0.12, across) * smoothstep(0, 0.12, 1 - across);
      const crown = Math.sin(Math.PI * across) * (0.75 + 0.25 * Math.sin(Math.PI * along));
      const fibre = fbm(x, y, 8, 3, 111, horizontal ? [1, 10] : [10, 1]);
      const h = clamp01(0.15 + 0.75 * crown * edge + 0.08 * fibre);
      return { h, a: clamp01(0.42 + 0.55 * edge + 0.08 * fibre), r: 0.62 + 0.15 * (1 - edge), o: 0.55 + 0.45 * edge };
    }
    case "pile": {
      // A rug's pile: tufts close together, each a soft bump, in a fibrous haze.
      const { f1 } = worley(x, y, 40, 121);
      const tuft = clamp01(1 - f1 * 1.15);
      const haze = fbm(x, y, 24, 3, 123);
      return { h: clamp01(0.3 + 0.6 * tuft + 0.15 * haze), a: clamp01(0.82 + 0.16 * tuft + 0.06 * haze), r: 0.96, o: 0.65 + 0.35 * tuft };
    }
    case "jute": {
      // A chunky braid: rows of twisted strands leaning one way, the next row the other.
      const rows = 9;
      const ty = y * rows;
      const row = Math.floor(ty);
      const fy = ty - row;
      const lean = row % 2 === 0 ? 1 : -1;
      const twist = (x * rows * 3 + lean * fy * 1.2) % 1;
      const strand = Math.sin(Math.PI * ((twist + 1) % 1)) * Math.sin(Math.PI * fy);
      const fibre = fbm(x, y, 16, 3, 131);
      const h = clamp01(0.2 + 0.7 * strand + 0.1 * fibre);
      return { h, a: clamp01(0.68 + 0.3 * strand + 0.08 * fibre), r: 0.9, o: 0.55 + 0.45 * strand };
    }
  }
}

/** How strongly each height map tilts the light: a weave's threads stand out more than a glaze's pooling. */
const BUMP: Readonly<Record<TextureKind, number>> = {
  weave: 2.4,
  linen: 3,
  velvet: 0.6,
  boucle: 4.5,
  leather: 1.1,
  wood: 1.1,
  marble: 0.3,
  brushed: 0.5,
  ceramic: 0.4,
  rattan: 5,
  pile: 4,
  jute: 5,
};

const toLinear = (value: number) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);

/** The raw maps of one material, before encoding: pure, so tests can check that every one tiles. */
export function drawTexture(kind: TextureKind, size = TEXTURE_SIZE[kind]): { height: Float32Array; albedo: Float32Array; roughness: Float32Array; occlusion: Float32Array } {
  const height = new Float32Array(size * size);
  const albedo = new Float32Array(size * size);
  const roughness = new Float32Array(size * size);
  const occlusion = new Float32Array(size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const t = texel(kind, x / size, y / size);
      const i = y * size + x;
      height[i] = t.h;
      albedo[i] = t.a;
      roughness[i] = t.r;
      occlusion[i] = t.o;
    }
  }
  return { height, albedo, roughness, occlusion };
}

/**
 * The normal map from the height map. The slope in x and y comes from the
 * neighbours on either side (wrapping round the edges, as the texture does);
 * the normal leans against the slope: (−∂h/∂x · k, ∂h/∂y · k, 1), normalised,
 * then stored as 0…255 per axis. glTF's normal maps are "+Y up": the green
 * channel points towards the top of the image, where rows count downwards —
 * hence the opposite sign on y.
 */
export function normalsFromHeight(height: Float32Array, size: number, strength: number): Uint8Array {
  const out = new Uint8Array(size * size * 3);
  const at = (x: number, y: number) => height[mod(y, size) * size + mod(x, size)]!;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * 0.5 * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * 0.5 * strength;
      const nx = -dx;
      const ny = dy;
      const l = Math.hypot(nx, ny, 1);
      const i = (y * size + x) * 3;
      out[i] = Math.round(((nx / l) * 0.5 + 0.5) * 255);
      out[i + 1] = Math.round(((ny / l) * 0.5 + 0.5) * 255);
      out[i + 2] = Math.round(((1 / l) * 0.5 + 0.5) * 255);
    }
  }
  return out;
}

const cache = new Map<TextureKind, Promise<TextureSet>>();

/** One material's three images, drawn and encoded once per process and shared by every model that uses them. */
export function textureSet(kind: TextureKind): Promise<TextureSet> {
  let pending = cache.get(kind);
  if (pending === undefined) {
    pending = encode(kind);
    cache.set(kind, pending);
    pending.catch(() => cache.delete(kind));
  }
  return pending;
}

async function encode(kind: TextureKind): Promise<TextureSet> {
  const { default: sharp } = await import("sharp");
  const size = TEXTURE_SIZE[kind];
  const maps = drawTexture(kind, size);
  const grey = new Uint8Array(size * size * 3);
  const orm = new Uint8Array(size * size * 3);
  let linearSum = 0;
  for (let i = 0; i < size * size; i += 1) {
    const a = Math.round(clamp01(maps.albedo[i]!) * 255);
    grey[i * 3] = a;
    grey[i * 3 + 1] = a;
    grey[i * 3 + 2] = a;
    linearSum += toLinear(a / 255);
    orm[i * 3] = Math.round(clamp01(maps.occlusion[i]!) * 255);
    orm[i * 3 + 1] = Math.round(clamp01(maps.roughness[i]!) * 255);
    // Metalness is set per material by its factor; the texture says "fully" everywhere and the factor scales it.
    orm[i * 3 + 2] = 255;
  }
  // Slopes are per pixel: a smaller image has steeper steps between pixels, so the strength scales with its size
  // and the surface looks the same at 256 or 512.
  const normal = normalsFromHeight(maps.height, size, BUMP[kind] * (size / 64));
  const jpeg = (pixels: Uint8Array, quality: number) =>
    sharp(Buffer.from(pixels.buffer, pixels.byteOffset, pixels.byteLength), { raw: { width: size, height: size, channels: 3 } })
      .jpeg({ quality, chromaSubsampling: "4:4:4", mozjpeg: false })
      .toBuffer()
      .then((buffer) => new Uint8Array(buffer));
  const [albedo, normalJpeg, ormJpeg] = await Promise.all([jpeg(grey, 86), jpeg(normal, 84), jpeg(orm, 86)]);
  return { kind, albedo, normal: normalJpeg, orm: ormJpeg, meanLinear: linearSum / (size * size), size };
}
