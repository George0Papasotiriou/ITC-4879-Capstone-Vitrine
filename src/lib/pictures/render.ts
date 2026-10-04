/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Making an AI picture: the brief, the piece's photographs and the room to the image model, a quality check, and a second try if it falls short.
 */

import { judgePrompt, PICTURE_PROMPT_VERSION, picturePrompt, type PictureImages, type PicturePiece } from "@/lib/ai/prompts/picture-v2";
import type { ModelEntry, Usage } from "@/lib/ai/models";
import type { ImageMaker, MakeFailure, PictureJudge } from "@/lib/pictures/makers";
import { aspectFor, PICTURE_LONG_SIDE, PREVIEW_LONG_SIDE, SCENE_ASPECT, type AspectRatio, type PictureKind, type RoomType, type SceneStyle } from "@/lib/pictures/pictures";
import { better, corrections, passes, type Verdict } from "@/lib/pictures/quality";
import { prepareImage, type PictureImage } from "@/lib/pictures/studio";

/**
 * docs/adr/060, replacing docs/adr/053's single call and its drawn stand-in.
 *
 * 1. The images, in the order the brief names them (prompts/picture-v2.ts):
 *    the room first — the shopper's photograph (quick), the planner's picture
 *    with the piece placed (room), or the style's showroom photograph (scene;
 *    none yet: the model makes the whole room) — then up to three of the
 *    piece's own photographs and a close crop of it (studio.ts). The room is
 *    sent at up to 2560 px, the piece's photographs at 1536.
 * 2. The model makes the picture at 2K, in the room's own proportions (a
 *    scene is 4:3).
 * 3. The quality check scores it (quality.ts). If it clears the bar, done.
 *    If not, the model is asked again with the check's corrections, the
 *    second is checked too, and the better of the two is kept — if it clears
 *    the bar. Otherwise the picture fails as "quality", and the shopper keeps
 *    their go (store.ts counts only pictures that did not fail).
 *
 * If the check itself cannot answer (an error, a timeout), the picture is
 * kept rather than thrown away after being paid for; it is stored without a
 * verdict, so such pictures can be found and looked at. Every call's cost
 * goes to `spend`, which the job records under room_picture whether or not
 * the picture is kept.
 */

export type RenderInput = {
  kind: PictureKind;
  piece: PicturePiece;
  style: SceneStyle | null;
  roomType: RoomType;
  /** The shopper's photograph (quick), the planner's placed picture (room), or the showroom's photograph (scene), if any. */
  room: PictureImage | null;
  /** The piece's own photographs, in the order chooseReferenceMedia gives; at least one. */
  references: readonly PictureImage[];
  /** A close crop of the piece, or null. */
  detail: PictureImage | null;
};

export type RenderFailure = "no_room" | "no_references" | "unreadable" | MakeFailure | "quality";

/**
 * What came of it. `model` is the model that made the kept picture (the
 * chain may have had Nano Banana 2 stand in for Pro); `notes` are what the
 * models said when something went wrong — Google's own error text, never the
 * request — for the job's log.
 */
export type Rendered =
  | { ok: true; image: PictureImage; verdict: Verdict | null; attempts: number; promptVersion: string; model: ModelEntry; notes: string[] }
  | { ok: false; reason: RenderFailure; attempts: number; verdict: Verdict | null; notes: string[] };

export type Spend = (entry: ModelEntry, usage: Usage) => Promise<void>;

export type RenderDeps = { maker: ImageMaker; judge: PictureJudge | null; spend: Spend };

/** The longest side of the room as the model is shown it: enough for a 2K picture to keep its detail. */
const ROOM_LONG_SIDE = 2560;
/** How large the check sees the picture and the room. */
const JUDGE_LONG_SIDE = 1536;
const JUDGE_ROOM_SIDE = 1024;
/** The check sees two of the piece's photographs: the clearest, and a second angle. */
const JUDGE_REFERENCES = 2;

type Attempt = { image: PictureImage; verdict: Verdict | null };

/** What the room is, for the brief. */
function roomRole(kind: PictureKind, hasRoom: boolean): PictureImages["room"] {
  if (kind === "quick") return "own";
  if (kind === "room") return "placed";
  return hasRoom ? "showroom" : null;
}

async function dimensions(image: PictureImage): Promise<{ width: number; height: number } | null> {
  const { default: sharp } = await import("sharp");
  const meta = await sharp(Buffer.from(image.bytes))
    .metadata()
    .catch(() => null);
  if (meta?.width === undefined || meta.height === undefined) return null;
  // A phone photograph's orientation turns its width and height.
  return meta.orientation !== undefined && meta.orientation >= 5 ? { width: meta.height, height: meta.width } : { width: meta.width, height: meta.height };
}

export async function renderPicture(deps: RenderDeps, input: RenderInput): Promise<Rendered> {
  const notes: string[] = [];
  const fail = (reason: RenderFailure, attempts = 0, verdict: Verdict | null = null): Rendered => ({ ok: false, reason, attempts, verdict, notes });
  if (input.kind !== "scene" && input.room === null) return fail("no_room");
  if (input.references.length === 0) return fail("no_references");

  let aspectRatio: AspectRatio = SCENE_ASPECT;
  let room: PictureImage | null = null;
  if (input.room !== null) {
    const size = await dimensions(input.room);
    room = await prepareImage(input.room, ROOM_LONG_SIDE);
    if (size === null || room === null) return fail("unreadable");
    // A scene keeps its 4:3 frame; a shopper's room keeps the photograph's own framing.
    if (input.kind !== "scene") aspectRatio = aspectFor(size.width, size.height);
  }
  const images: PictureImages = { room: roomRole(input.kind, room !== null), references: input.references.length, detail: input.detail !== null };
  const sent = [...(room === null ? [] : [room]), ...input.references, ...(input.detail === null ? [] : [input.detail])];

  const judgeImages = async (picture: PictureImage) => {
    const shown = await prepareImage(picture, JUDGE_LONG_SIDE);
    const roomShown = input.kind === "scene" || room === null ? null : await prepareImage(room, JUDGE_ROOM_SIDE);
    return [...(shown === null ? [] : [shown]), ...input.references.slice(0, JUDGE_REFERENCES), ...(roomShown === null ? [] : [roomShown])];
  };
  const check = async (picture: PictureImage): Promise<Verdict | null> => {
    if (deps.judge === null) return null;
    const prompt = judgePrompt(input.kind, input.piece, { references: Math.min(JUDGE_REFERENCES, input.references.length), room: input.kind !== "scene" });
    const judged = await deps.judge.judge({ prompt, images: await judgeImages(picture) });
    await deps.spend(deps.judge.entry, judged.usage);
    if (judged.detail != null) notes.push(`check: ${judged.detail}`);
    return judged.verdict;
  };
  const attempt = async (fixes: readonly string[]) => {
    const prompt = picturePrompt({ kind: input.kind, piece: input.piece, style: input.style, roomType: input.roomType, images, corrections: fixes });
    const made = await deps.maker.make({ prompt, images: sent, aspectRatio, size: "2K" });
    // Every call is paid for under the model that served it, kept or not.
    for (const call of made.calls) await deps.spend(call.entry, call.usage);
    if (!made.ok && made.detail !== null) notes.push(`${made.reason}: ${made.detail}`);
    // A model that stood in after another failed is worth knowing about, even when the picture is made.
    if (made.ok && made.calls.length > 1) notes.push(`made by ${made.entry.id} after ${made.calls.length - 1} failed call(s)`);
    return made;
  };

  const first = await attempt([]);
  if (!first.ok) return fail(first.reason, 1);
  const one: Attempt = { image: first.image, verdict: await check(first.image) };
  if (one.verdict === null || passes(one.verdict, input.kind)) return { ok: true, image: one.image, verdict: one.verdict, attempts: 1, promptVersion: PICTURE_PROMPT_VERSION, model: first.entry, notes };

  // Once more, told what was wrong.
  const second = await attempt(corrections(one.verdict));
  if (!second.ok) return fail("quality", 2, one.verdict);
  const two: Attempt = { image: second.image, verdict: await check(second.image) };
  const kept = better(one, two, input.kind);
  if (kept.verdict !== null && !passes(kept.verdict, input.kind)) return fail("quality", 2, kept.verdict);
  return { ok: true, image: kept.image, verdict: kept.verdict, attempts: 2, promptVersion: PICTURE_PROMPT_VERSION, model: kept === one ? first.entry : second.entry, notes };
}

/**
 * The files of a finished picture: as shown (WebP q90, up to 2560 px), its
 * 1024 px copy (WebP q82), and the JPEG that Save gives (q92, full size).
 * Nothing is sharpened, graded or framed: the picture is the model's
 * photograph as it came.
 */
export async function encodePicture(image: PictureImage): Promise<{ result: Uint8Array; preview: Uint8Array; download: Uint8Array; width: number; height: number }> {
  const { default: sharp } = await import("sharp");
  const source = Buffer.from(image.bytes);
  const fit = (side: number) => sharp(source).rotate().resize(side, side, { fit: "inside", withoutEnlargement: true });
  const [result, preview, download] = await Promise.all([
    fit(PICTURE_LONG_SIDE).webp({ quality: 90, smartSubsample: true }).toBuffer({ resolveWithObject: true }),
    fit(PREVIEW_LONG_SIDE).webp({ quality: 82 }).toBuffer(),
    fit(PICTURE_LONG_SIDE).jpeg({ quality: 92, chromaSubsampling: "4:4:4", mozjpeg: true }).toBuffer(),
  ]);
  return { result: new Uint8Array(result.data), preview: new Uint8Array(preview), download: new Uint8Array(download), width: result.info.width, height: result.info.height };
}
