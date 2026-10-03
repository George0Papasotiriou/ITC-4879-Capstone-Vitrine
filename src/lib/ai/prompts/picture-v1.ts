/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * What the image model is asked for an AI picture, version 1: the piece kept true, its true size given, nothing invented.
 */

import { SCENE_STYLES, type PictureKind, type SceneStyle } from "@/lib/pictures/pictures";

/**
 * docs/adr/053. Prompts are versioned modules (CLAUDE.md): a picture records
 * the version that made it. The shopper writes nothing into these prompts —
 * the kind, the style and the piece's own facts from the database are all
 * that go in — so no one can steer the model through them.
 *
 * Every prompt holds the same three promises, because a picture that redesigns
 * the piece, or makes it a different size, sells something the shop does not
 * have: the piece exactly as in its studio photograph; its true size from the
 * catalogue; and no people, text, logos or watermarks.
 */

export const PICTURE_PROMPT_VERSION = "picture-v1";

export type PicturePiece = {
  title: string;
  /** Centimetres, from the catalogue; null when the listing has none. */
  dimsCm: { w: number; d: number; h: number } | null;
};

const TRUE_PIECE = (piece: PicturePiece) =>
  [
    `The product is "${piece.title.replace(/["\n\r]/g, " ").slice(0, 120)}". It must appear exactly as in its studio photograph: the same shape, proportions, materials, colours, number of legs and details. Do not redesign, restyle, recolour or simplify it.`,
    piece.dimsCm === null ? "" : `It is ${piece.dimsCm.w} cm wide, ${piece.dimsCm.d} cm deep and ${piece.dimsCm.h} cm high: show it at that true size against the room.`,
  ]
    .filter(Boolean)
    .join(" ");

const RULES =
  "Photorealistic, as if taken with a good camera at eye height. No people, no animals, no text, no logos, no watermarks. Realistic contact shadows where the product meets the floor.";

/** The prompt for one picture. Images are given in the order the comment of each kind names. */
export function picturePrompt(kind: PictureKind, piece: PicturePiece, style?: SceneStyle): string {
  switch (kind) {
    case "room":
      return [
        "Image 1 is a photograph of a room in which a measuring tool has already placed the product at its correct position, size and angle; it may look flat or pasted on. Image 2 is the product's studio photograph.",
        "Make image 1 look like a real photograph of that room with the product truly in it: match the room's light, colour temperature and shadows on the product and on the floor, and keep the product's position, size and angle exactly as placed. Change nothing else in the room and keep the framing.",
        TRUE_PIECE(piece),
        RULES,
      ].join("\n");
    case "quick":
      return [
        "Image 1 is a photograph of a room. Image 2 is the product's studio photograph.",
        "Place the product into the room where it would naturally stand, on the floor and against the room's perspective, matching its light, colour temperature and shadows. Do not remove, move or change anything else in the room, and keep the original framing.",
        TRUE_PIECE(piece),
        RULES,
      ].join("\n");
    case "scene": {
      const chosen = SCENE_STYLES[style ?? "warm-minimal"];
      return [
        "The image is the product's studio photograph.",
        `Create a beautiful interior photograph of this product in ${chosen.room}. Light: ${chosen.light}.`,
        "The product is the subject: fully visible, in focus, placed naturally where it belongs in such a room, not floating. Style the room sparingly with a few quiet accessories that do not compete with it, and add no other piece of the same kind.",
        TRUE_PIECE(piece),
        RULES,
      ].join("\n");
    }
  }
}
