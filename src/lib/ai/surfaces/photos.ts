/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * A photograph attached to a question: carried as a reference in the conversation, turned into an image for the model on the server.
 */

import type { ModelMessage, UIMessage } from "ai";

/**
 * docs/adr/051. A shopper can attach a photograph to a question — of their
 * room, or of a piece they like. The photograph goes through the shop's photo
 * route first (consent, re-encoding that drops the camera's metadata, a day to
 * live: docs/adr/023), and the message carries only its id, in the message's
 * metadata. Here, on the server, each id is checked against the shopper who
 * owns it and read from storage, and the model receives the picture itself.
 *
 * So the bytes never travel back with every turn, an expired or deleted
 * photograph simply stops being seen, and no one can show the model a
 * photograph that is not theirs by sending its id.
 */

/** The metadata a user message carries when a photograph is attached. */
export type PhotoMetadata = { photo?: { id: string } };

/** Pictures sent to the model per turn, newest first: enough for "this room, and that sofa", and a bound on the cost. */
export const MAX_PHOTOS_PER_TURN = 2;

/** The photograph's id on a message, when it carries one. */
export function photoIdOf(message: Pick<UIMessage, "metadata">): string | null {
  const photo = (message.metadata as PhotoMetadata | undefined)?.photo;
  return photo !== undefined && typeof photo.id === "string" && /^[0-9a-f-]{36}$/i.test(photo.id) ? photo.id : null;
}

export type LoadedPhoto = { bytes: Uint8Array; mediaType: string };

/**
 * The model's messages with each attached photograph added to the user message
 * it came with. User messages map one to one, in order, from the UI messages
 * to the model's (assistant messages may become several), so the n-th user
 * message here is the n-th one there. Only the newest `MAX_PHOTOS_PER_TURN`
 * photographs are sent; an older or missing one is named in words instead,
 * so the model knows a photograph was there.
 */
export async function attachPhotos(
  model: readonly ModelMessage[],
  ui: readonly Pick<UIMessage, "role" | "metadata">[],
  load: (photoId: string) => Promise<LoadedPhoto | null>,
): Promise<ModelMessage[]> {
  const idsByUserTurn = ui.filter((message) => message.role === "user").map(photoIdOf);
  const sendable = new Set(
    idsByUserTurn
      .filter((id): id is string => id !== null)
      .reverse()
      .slice(0, MAX_PHOTOS_PER_TURN),
  );
  const out: ModelMessage[] = [];
  let turn = 0;
  for (const message of model) {
    if (message.role !== "user") {
      out.push(message);
      continue;
    }
    const id = idsByUserTurn[turn];
    turn += 1;
    if (id === null || id === undefined) {
      out.push(message);
      continue;
    }
    const photo = sendable.has(id) ? await load(id) : null;
    const content = typeof message.content === "string" ? [{ type: "text" as const, text: message.content }] : [...message.content];
    if (photo === null) {
      content.push({ type: "text", text: sendable.has(id) ? "(The shopper attached a photograph that is no longer available: it was deleted or has expired.)" : "(The shopper attached a photograph earlier in the conversation.)" });
    } else {
      content.push({ type: "text", text: "(The shopper attached this photograph.)" });
      content.push({ type: "file", data: photo.bytes, mediaType: photo.mediaType });
    }
    out.push({ ...message, content });
  }
  return out;
}
