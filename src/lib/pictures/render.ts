/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Making an AI picture: the image model with the room and the piece, or — without a key — a picture the shop draws itself.
 */

import { generateImage, type ImageModel } from "ai";

import { picturePrompt, type PicturePiece } from "@/lib/ai/prompts/picture-v1";
import { aspectFor, SCENE_ASPECT, type PictureKind, type SceneStyle } from "@/lib/pictures/pictures";
import type { Point2 } from "@/lib/vision/camera";
import { cutoutFromWhite } from "@/lib/vision/cutout";
import { quadFromMask, targetRectangle, warp, warpOnto, type Quad } from "@/lib/vision/rectify";

/**
 * docs/adr/053.
 *
 * WITH A KEY the image model (Nano Banana 2, MODELS.image) gets the versioned
 * prompt (src/lib/ai/prompts/picture-v1.ts) and the images in the order it
 * names: the room (the planner's own picture, or the shopper's photograph)
 * and then the piece's studio photograph — or, for a showroom scene, the
 * studio photograph alone. The picture keeps the photograph's framing
 * (aspectFor). The prompt carries only the piece's facts from the database.
 *
 * WITHOUT A KEY (demo mode, or AI switched off) the shop draws the picture
 * itself, so every flow works and can be tested for nothing, and the page
 * labels it "a preview, without AI":
 * - room: the planner's picture as it is, graded like a photograph;
 * - quick: the piece's studio photograph, cut out of its white
 *   (src/lib/vision/cutout.ts), stood on the floor of the room with a soft
 *   shadow — its size a guess, as the quick picture's always is;
 * - scene: a room in the style's colours and light — a wall, a skirting
 *   board, a floor of planks or tiles drawn in one-point perspective
 *   (`showroomSvg`) — with the piece standing in it at its catalogue size for
 *   that camera (`showroomGeometry`), lit like the room, on two shadows.
 * The grade warms each colour channel; sharp's tint() was not used, since it
 * keeps only brightness and turned every room grey.
 *
 * Every picture is stored as WebP, at most 1600 px on its long side.
 */

export type PictureImage = { bytes: Uint8Array; contentType: string };

export type RenderInput = {
  kind: PictureKind;
  piece: PicturePiece;
  style: SceneStyle | null;
  /** The room: the planner's picture (room) or the shopper's photograph (quick); null for a scene. */
  room: PictureImage | null;
  /** The piece's studio photograph. */
  studio: PictureImage;
};

export type Rendered = { ok: true; image: Uint8Array; drawn: boolean } | { ok: false; reason: "no_room" | "model_refused" | "no_image" | "unreadable" };

const LONG_SIDE = 1600;

async function webp(input: Uint8Array | Buffer): Promise<Uint8Array> {
  const { default: sharp } = await import("sharp");
  const out = await sharp(Buffer.from(input)).rotate().resize(LONG_SIDE, LONG_SIDE, { fit: "inside", withoutEnlargement: true }).webp({ quality: 86 }).toBuffer();
  return new Uint8Array(out);
}

/** The image model's picture. */
export async function renderWithModel(model: ImageModel, input: RenderInput): Promise<Rendered> {
  const { default: sharp } = await import("sharp");
  if (input.kind !== "scene" && input.room === null) return { ok: false, reason: "no_room" };
  let aspectRatio = SCENE_ASPECT;
  if (input.room !== null) {
    const meta = await sharp(Buffer.from(input.room.bytes)).metadata();
    if (meta.width === undefined || meta.height === undefined) return { ok: false, reason: "unreadable" };
    aspectRatio = aspectFor(meta.width, meta.height);
  }
  const images = input.room === null ? [input.studio.bytes] : [input.room.bytes, input.studio.bytes];
  try {
    const result = await generateImage({
      model,
      prompt: { text: picturePrompt(input.kind, input.piece, input.style ?? undefined), images },
      aspectRatio,
      maxRetries: 1,
    });
    const image = result.images[0];
    if (image === undefined) return { ok: false, reason: "no_image" };
    return { ok: true, image: await webp(image.uint8Array), drawn: false };
  } catch {
    // Never logged with its input: the room is the shopper's.
    return { ok: false, reason: "model_refused" };
  }
}

/** The studio photograph as RGBA pixels, at most 900 px on its long side. */
async function studioPixels(studio: PictureImage) {
  const { default: sharp } = await import("sharp");
  const { data, info } = await sharp(Buffer.from(studio.bytes)).resize(900, 900, { fit: "inside", withoutEnlargement: true }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength), width: info.width, height: info.height };
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

/** The piece's studio photograph cut out of its white, as a PNG with alpha, and its size. */
async function cutPiece(studio: PictureImage): Promise<{ png: Buffer; width: number; height: number } | null> {
  const { default: sharp } = await import("sharp");
  const photo = await studioPixels(studio);
  // A standing piece: the white seen between its legs is the studio's, and its studio shadow may be deep.
  const cut = cutoutFromWhite(photo.data, photo.width, photo.height, { standing: true });
  if (!cut.removed || cut.box.width < 8 || cut.box.height < 8) return null;
  const png = await sharp(Buffer.from(cut.rgba.buffer, cut.rgba.byteOffset, cut.rgba.byteLength), { raw: { width: cut.width, height: cut.height, channels: 4 } })
    .extract({ left: cut.box.x, top: cut.box.y, width: cut.box.width, height: cut.box.height })
    .png()
    .toBuffer();
  return { png, width: cut.box.width, height: cut.box.height };
}

/** A soft elliptical shadow, as an SVG the size of the picture. */
const shadow = (cx: number, cy: number, rx: number, ry: number, width: number, height: number, opacity = 0.42) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><filter id="b" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${Math.max(6, ry * 0.6)}"/></filter></defs><ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="rgba(0,0,0,${opacity})" filter="url(#b)"/></svg>`,
  );

/** A photograph's grade: a touch of contrast and warmth, and a quiet vignette. */
async function grade(input: Buffer, width: number, height: number): Promise<Uint8Array> {
  const { default: sharp } = await import("sharp");
  const vignette = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><radialGradient id="v" cx="50%" cy="48%" r="75%"><stop offset="60%" stop-color="#000" stop-opacity="0"/><stop offset="100%" stop-color="#000" stop-opacity="0.32"/></radialGradient></defs><rect width="100%" height="100%" fill="url(#v)"/></svg>`,
  );
  // Warmth per channel, not sharp's tint(): tint keeps only brightness and paints every colour with one hue,
  // which turned a terracotta floor (and a shopper's own room) grey.
  const out = await sharp(input).removeAlpha().linear([1.07, 1.05, 1.01], [-6, -6, -5]).modulate({ saturation: 1.04 }).composite([{ input: vignette }]).png().toBuffer();
  return webp(out);
}

/** The picture the shop draws itself when there is no model to pay. */
export async function renderDrawn(input: RenderInput): Promise<Rendered> {
  const { default: sharp } = await import("sharp");
  if (input.kind === "room") {
    if (input.room === null) return { ok: false, reason: "no_room" };
    const meta = await sharp(Buffer.from(input.room.bytes)).metadata();
    if (meta.width === undefined || meta.height === undefined) return { ok: false, reason: "unreadable" };
    return { ok: true, image: await grade(Buffer.from(input.room.bytes), meta.width, meta.height), drawn: true };
  }

  if (input.piece.lies === true) return renderRug(input);
  const piece = await cutPiece(input.studio);
  if (piece === null) return { ok: false, reason: "unreadable" };

  let base: Buffer;
  let width: number;
  let height: number;
  // Where the piece stands (the bottom of its photograph), and how tall it is drawn.
  let baseY: number;
  let pieceHeight: number;
  let light: [number, number, number] = [1, 1, 1];
  if (input.kind === "quick") {
    if (input.room === null) return { ok: false, reason: "no_room" };
    const room = sharp(Buffer.from(input.room.bytes)).rotate().resize(LONG_SIDE, LONG_SIDE, { fit: "inside", withoutEnlargement: true });
    base = await room.png().toBuffer();
    const meta = await sharp(base).metadata();
    width = meta.width!;
    height = meta.height!;
    // A quick picture guesses where the floor is and how big the piece is, as its label says.
    baseY = Math.round(height * 0.86);
    pieceHeight = Math.round(height * 0.42);
  } else {
    const style = input.style ?? "warm-minimal";
    width = SHOWROOM.width;
    height = SHOWROOM.height;
    base = await sharp(Buffer.from(showroomSvg(style, width, height))).png().toBuffer();
    // The piece stands a little way into the room, not against the wall, at the size its catalogue gives.
    const camera = showroomGeometry(height);
    baseY = camera.baseY;
    pieceHeight = input.piece.dimsCm === null ? Math.round(height * 0.4) : Math.round(input.piece.dimsCm.h * camera.pxPerCm);
    light = SHOWROOM_STYLES[style].light;
  }

  // The front view keeps its proportions; a very wide or very tall piece is fitted inside the frame.
  let pieceWidth = Math.round((piece.width * pieceHeight) / piece.height);
  const fit = Math.min(1, (width * 0.78) / pieceWidth, (baseY * 0.86) / pieceHeight);
  pieceWidth = Math.max(8, Math.round(pieceWidth * fit));
  pieceHeight = Math.max(8, Math.round(pieceHeight * fit));
  // The room's light on the piece: warm sun, cool daylight, or a dim lamp (the alpha left alone).
  const placed = await sharp(piece.png)
    .resize(pieceWidth, pieceHeight)
    .linear([...light, 1], [0, 0, 0, 0])
    .png()
    .toBuffer();
  const left = Math.round((width - pieceWidth) / 2);
  const top = baseY - pieceHeight;
  const composed = await sharp(base)
    .composite([
      // Two shadows, as a lit room gives: a wide soft one from the room's light, a tight dark one where it touches.
      { input: shadow(width / 2, baseY - 4, pieceWidth * 0.56, Math.max(14, pieceHeight * 0.09), width, height, 0.26), left: 0, top: 0 },
      { input: shadow(width / 2, baseY - 1, pieceWidth * 0.47, Math.max(5, pieceHeight * 0.025), width, height, 0.5), left: 0, top: 0 },
      { input: placed, left, top },
    ])
    .png()
    .toBuffer();
  return { ok: true, image: await grade(composed, width, height), drawn: true };
}

/** A rug lies on the floor: its flat picture laid onto the floor in the room's perspective, no shadow of its own. */
async function renderRug(input: RenderInput): Promise<Rendered> {
  const { default: sharp } = await import("sharp");
  const dims = input.piece.dimsCm ?? { w: 200, d: 140, h: 1 };
  const flat = await flatRug(input.studio, dims);
  if (flat === null) return { ok: false, reason: "unreadable" };
  const long = Math.max(dims.w, dims.d);
  const short = Math.min(dims.w, dims.d);

  let base: Buffer;
  let width: number;
  let height: number;
  let quad: Quad;
  let light: [number, number, number] = [1, 1, 1];
  if (input.kind === "quick") {
    if (input.room === null) return { ok: false, reason: "no_room" };
    base = await sharp(Buffer.from(input.room.bytes)).rotate().resize(LONG_SIDE, LONG_SIDE, { fit: "inside", withoutEnlargement: true }).png().toBuffer();
    const meta = await sharp(base).metadata();
    width = meta.width!;
    height = meta.height!;
    // Where the floor probably is in someone's photograph: a guess, as the quick picture's label says.
    const near = Math.min(0.32, (0.32 * long) / 240) * width;
    const far = near * 0.7;
    const depth = Math.min(0.2, (0.2 * short) / 170) * height;
    quad = [
      [width / 2 - near, height * 0.95],
      [width / 2 + near, height * 0.95],
      [width / 2 + far, height * 0.95 - depth],
      [width / 2 - far, height * 0.95 - depth],
    ];
  } else {
    const style = input.style ?? "warm-minimal";
    width = SHOWROOM.width;
    height = SHOWROOM.height;
    base = await sharp(Buffer.from(showroomSvg(style, width, height))).png().toBuffer();
    quad = rugOnShowroomFloor(width, height, long, short);
    light = SHOWROOM_STYLES[style].light;
  }
  const layer = warpOnto(flat, quad, { width, height });
  const lit = await sharp(Buffer.from(layer.buffer, layer.byteOffset, layer.byteLength), { raw: { width, height, channels: 4 } })
    .linear([...light, 1], [0, 0, 0, 0])
    .png()
    .toBuffer();
  const composed = await sharp(base).composite([{ input: lit }]).png().toBuffer();
  return { ok: true, image: await grade(composed, width, height), drawn: true };
}

/** The showroom camera's focal length in pixels: a 60° field of view across the picture's width. */
const showroomFocal = (width: number) => width / 2 / Math.tan(Math.PI / 6);

/**
 * Where a rug of `long` × `short` cm lies on the drawn showroom's floor: its
 * long side across the room, centred at the depth where a standing piece
 * stands, moved forward if it would pass under the wall. A floor point X cm to
 * the side at depth Z is drawn at (cx + f·X/Z, horizon + f·E/Z); the depth of
 * the standing spot follows from `showroomGeometry`'s scale, pxPerCm = f/Z.
 * Corners in `warpOnto`'s order: near left, near right, far right, far left.
 */
export function rugOnShowroomFloor(width: number, height: number, long: number, short: number): Quad {
  const { floorY, horizon, pxPerCm } = showroomGeometry(height);
  const focal = showroomFocal(width);
  const eye = SHOWROOM.eyeCm;
  const centre = focal / pxPerCm;
  const wall = (focal * eye) / (floorY - horizon);
  // Keep the far edge a hand's breadth in front of the wall.
  const shift = Math.max(0, centre + short / 2 - (wall - 15));
  const near = centre - short / 2 - shift;
  const far = centre + short / 2 - shift;
  const at = (x: number, z: number): Point2 => [width / 2 + (focal * x) / z, horizon + (focal * eye) / z];
  return [at(-long / 2, near), at(long / 2, near), at(long / 2, far), at(-long / 2, far)];
}

/** The drawn showroom's frame: 4:3, the wall meeting the floor two thirds down, the eye 1.4 m up. */
const SHOWROOM = { width: 1600, height: 1200, floor: 0.64, eyeCm: 140 } as const;

type ShowroomStyle = {
  wall: [string, string];
  floor: [string, string];
  /** The skirting board along the foot of the wall. */
  skirting: string;
  /** The floor's joints: planks run away from the eye; tiles add rows. */
  floorLines: { colour: string; columns: number; rows: number };
  /** The light falling into the room from a window on the left, and a lamp's glow (dark & moody only). */
  window: string;
  lamp: string | null;
  /** The room's light on the piece, red, green and blue. */
  light: [number, number, number];
};

/** The same colours as the style tiles on the page (globals.css .scene-swatch) and the styles' words (pictures.ts). */
const SHOWROOM_STYLES: Record<SceneStyle, ShowroomStyle> = {
  "warm-minimal": {
    wall: ["#f1eadf", "#e0d4c2"],
    floor: ["#cfb796", "#a98a68"],
    skirting: "#f6f1e9",
    floorLines: { colour: "rgba(92,62,36,0.16)", columns: 22, rows: 0 },
    window: "rgba(255,232,190,0.5)",
    lamp: null,
    light: [1.03, 1.0, 0.95],
  },
  scandinavian: {
    wall: ["#f5f6f4", "#e3e6e4"],
    floor: ["#ddd1bc", "#bfae92"],
    skirting: "#fbfbfa",
    floorLines: { colour: "rgba(110,90,60,0.13)", columns: 18, rows: 0 },
    window: "rgba(232,241,255,0.42)",
    lamp: null,
    light: [0.99, 1.0, 1.03],
  },
  "dark-moody": {
    wall: ["#2f3b36", "#1e2723"],
    floor: ["#4a382a", "#2a1f17"],
    skirting: "#26302c",
    floorLines: { colour: "rgba(0,0,0,0.28)", columns: 20, rows: 0 },
    window: "rgba(255,206,150,0.14)",
    lamp: "rgba(255,178,96,0.42)",
    light: [0.82, 0.76, 0.68],
  },
  mediterranean: {
    wall: ["#eddcc2", "#d9c19d"],
    floor: ["#bd7650", "#92553a"],
    skirting: "#f3e7d4",
    floorLines: { colour: "rgba(244,224,196,0.34)", columns: 12, rows: 9 },
    window: "rgba(255,238,200,0.55)",
    lamp: null,
    light: [1.05, 1.0, 0.92],
  },
};

/**
 * The drawn showroom, as SVG: a wall, a floor seen in perspective, and the
 * light. The floor is a plane seen from eye height, so its joints obey one-point
 * perspective: lines that run away from the eye meet at a vanishing point on the
 * horizon, and rows at equal steps of depth crowd together towards the wall —
 * a row's height on the picture falls as 1/depth (`floorRows`).
 */
export function showroomSvg(style: SceneStyle, width: number, height: number): string {
  const s = SHOWROOM_STYLES[style];
  // The horizon (eye level) sits above the foot of the wall; everything on the floor recedes towards it.
  const { floorY, horizon } = showroomGeometry(height);
  const vanishing = { x: width / 2, y: horizon };
  const lines: string[] = [];
  for (let i = -s.floorLines.columns; i <= s.floorLines.columns * 2; i += 1) {
    // A line from the bottom edge towards the vanishing point, cut where it meets the wall.
    const bottomX = (i / s.floorLines.columns) * width;
    const t = (height - floorY) / (height - vanishing.y);
    const wallX = bottomX + (vanishing.x - bottomX) * t;
    lines.push(`<line x1="${bottomX.toFixed(1)}" y1="${height}" x2="${wallX.toFixed(1)}" y2="${floorY}"/>`);
  }
  for (const y of floorRows(floorY, height, horizon, s.floorLines.rows)) lines.push(`<line x1="0" y1="${y.toFixed(1)}" x2="${width}" y2="${y.toFixed(1)}"/>`);

  const lamp =
    s.lamp === null
      ? ""
      : `<radialGradient id="lamp" cx="0.8" cy="0.36" r="0.42"><stop offset="0" stop-color="${s.lamp}"/><stop offset="1" stop-color="rgba(0,0,0,0)"/></radialGradient>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <defs>
    <linearGradient id="wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${s.wall[0]}"/><stop offset="1" stop-color="${s.wall[1]}"/></linearGradient>
    <linearGradient id="floor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${s.floor[0]}"/><stop offset="1" stop-color="${s.floor[1]}"/></linearGradient>
    <radialGradient id="corner" cx="0.5" cy="0.45" r="0.75"><stop offset="0.55" stop-color="rgba(0,0,0,0)"/><stop offset="1" stop-color="rgba(0,0,0,0.16)"/></radialGradient>
    ${lamp}
    <filter id="soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="46"/></filter>
  </defs>
  <rect width="${width}" height="${floorY}" fill="url(#wall)"/>
  <rect y="${floorY}" width="${width}" height="${height - floorY}" fill="url(#floor)"/>
  <g stroke="${s.floorLines.colour}" stroke-width="1.6">${lines.join("")}</g>
  <rect y="${floorY - 22}" width="${width}" height="22" fill="${s.skirting}"/>
  <rect y="${floorY - 1}" width="${width}" height="4" fill="rgba(0,0,0,0.12)"/>
  <polygon points="${width * 0.06},${floorY * 0.08} ${width * 0.27},${floorY * 0.02} ${width * 0.33},${floorY - 22} ${width * 0.1},${floorY - 22}" fill="${s.window}" filter="url(#soft)"/>
  <polygon points="${width * 0.1},${floorY} ${width * 0.33},${floorY} ${width * 0.62},${height} ${width * 0.2},${height}" fill="${s.window}" filter="url(#soft)" opacity="0.7"/>
  ${s.lamp === null ? "" : `<rect width="${width}" height="${height}" fill="url(#lamp)"/>`}
  <rect width="${width}" height="${height}" fill="url(#corner)"/>
</svg>`;
}

/**
 * Where `rows` rows of tiles, equally deep, cross a floor seen from above
 * `horizon`: a point at depth Z is drawn at horizon + k / Z, so equal steps of
 * depth between the nearest row (the bottom edge) and the wall are equal steps
 * of 1/(y − horizon). Returns the y of each joint, from the front back.
 */
export function floorRows(floorY: number, bottom: number, horizon: number, rows: number): number[] {
  if (rows <= 0) return [];
  // Depth, up to one constant, of the bottom edge and of the wall: Z = 1 / (y − horizon).
  const near = 1 / (bottom - horizon);
  const far = 1 / (floorY - horizon);
  const ys: number[] = [];
  for (let k = 1; k < rows; k += 1) ys.push(horizon + 1 / (near + ((far - near) * k) / rows));
  return ys;
}

/**
 * The drawn showroom's camera. The wall meets the floor at `floorY`; the eye,
 * `SHOWROOM.eyeCm` above the floor, looks level at the `horizon`. A camera at
 * height E draws a floor point at depth Z at horizon + f·E/Z, and anything
 * standing at that depth at f/Z pixels per unit — so a piece whose foot is at
 * `baseY` is drawn at (baseY − horizon) / E pixels per centimetre: its true
 * size, in the room's own perspective.
 */
export function showroomGeometry(height: number) {
  const floorY = Math.round(height * SHOWROOM.floor);
  const horizon = floorY - (height - floorY) * 0.95;
  const baseY = Math.round(floorY + (height - floorY) * 0.4);
  return { floorY, horizon, baseY, pxPerCm: (baseY - horizon) / SHOWROOM.eyeCm };
}
