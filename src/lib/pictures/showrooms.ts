/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The showroom rooms: four styles of four rooms, photographed once by the image model at 4K and kept, into which pieces are placed.
 */

import { showroomPrompt } from "@/lib/ai/prompts/picture-v2";
import type { ModelEntry, Usage } from "@/lib/ai/models";
import type { ImageMaker } from "@/lib/pictures/makers";
import { ROOM_TYPES, SCENE_STYLE_IDS, SCENE_ASPECT, showroomFiles, type RoomType, type SceneStyle } from "@/lib/pictures/pictures";
import type { StorageDriver } from "@/lib/storage/types";

/**
 * docs/adr/060. A showroom picture used to be a whole room invented around
 * each piece. Now each style has one photograph of each room — living room,
 * bedroom, dining room, study — made once at 4K (sixteen in all, about €4
 * once) and kept as catalogue media, and every piece is placed into the room
 * it belongs to (pictures.ts roomTypeFor). Editing a real photograph is what
 * the model does most convincingly, and the shop's showroom pictures share
 * one look, as a catalogue's do. The photographs also stand beside the style
 * names on the product page instead of painted swatches.
 *
 * Until a room is made, a scene in it is made the old way, room and all
 * (render.ts): nothing waits on the sixteen.
 */

export type Showroom = { style: SceneStyle; room: RoomType };

/** Every room of every style, in the order they are made and shown. */
export const SHOWROOMS: readonly Showroom[] = SCENE_STYLE_IDS.flatMap((style) => ROOM_TYPES.map((room) => ({ style, room })));

/** Which showroom rooms are already made. */
export async function madeShowrooms(files: StorageDriver): Promise<Showroom[]> {
  const made = await Promise.all(SHOWROOMS.map(async (entry) => ((await files.exists(showroomFiles(entry.style, entry.room).original)) ? entry : null)));
  return made.filter((entry): entry is Showroom => entry !== null);
}

/**
 * Photographs one showroom room at 4K and stores it with its 640 px tile.
 * The cost is passed to `spend` whether or not a photograph comes back.
 */
export async function makeShowroom(
  deps: { maker: ImageMaker; files: StorageDriver; spend: (entry: ModelEntry, usage: Usage) => Promise<void> },
  { style, room }: Showroom,
): Promise<{ ok: true; bytes: number } | { ok: false; reason: string }> {
  const made = await deps.maker.make({ prompt: showroomPrompt(style, room), images: [], aspectRatio: SCENE_ASPECT, size: "4K" });
  await deps.spend(deps.maker.entry, made.usage);
  if (!made.ok) return made;
  const { default: sharp } = await import("sharp");
  const source = Buffer.from(made.image.bytes);
  const original = await sharp(source).jpeg({ quality: 93, chromaSubsampling: "4:4:4", mozjpeg: true }).toBuffer();
  const tile = await sharp(source).resize(640, 480, { fit: "cover" }).webp({ quality: 82 }).toBuffer();
  const keys = showroomFiles(style, room);
  await deps.files.putObject({ key: keys.original, body: new Uint8Array(original), contentType: "image/jpeg" });
  await deps.files.putObject({ key: keys.tile, body: new Uint8Array(tile), contentType: "image/webp" });
  return { ok: true, bytes: original.byteLength };
}

/** How long the product page trusts what it learnt about which tiles exist. */
const TILES_TTL_MS = 10 * 60 * 1000;
let tilesSeen: { at: number; made: Set<string> } | null = null;

/**
 * The tile beside each style for a room, where its photograph is made: one
 * look at storage every ten minutes per process, not one per page view.
 */
export async function showroomTiles(files: StorageDriver, room: RoomType, now = Date.now()): Promise<Partial<Record<SceneStyle, string>>> {
  if (tilesSeen === null || now - tilesSeen.at > TILES_TTL_MS) {
    const made = await madeShowrooms(files).catch(() => []);
    tilesSeen = { at: now, made: new Set(made.map((entry) => `${entry.style}/${entry.room}`)) };
  }
  const seen = tilesSeen.made;
  return Object.fromEntries(SCENE_STYLE_IDS.filter((style) => seen.has(`${style}/${room}`)).map((style) => [style, `/media/${showroomFiles(style, room).tile}`]));
}

/** Forgets what was learnt, after a room is made (and in tests). */
export function forgetShowroomTiles() {
  tilesSeen = null;
}
