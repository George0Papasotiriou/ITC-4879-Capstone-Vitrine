/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Deleting a photograph the shop holds, before it expires on its own.
 */

import { knownActor } from "@/lib/ai/server";
import { currentUser } from "@/lib/auth/session";
import { photoStore, removeFiles } from "@/lib/photos/server";

/**
 * "Delete now" (docs/adr/023). Only the shopper who gave the photograph can
 * delete it, and the file goes with the row; a try-on made from it goes too,
 * because it is a picture of the same person.
 */

export const runtime = "nodejs";

export async function DELETE(_request: Request, context: RouteContext<"/api/photos/[id]">): Promise<Response> {
  const user = await currentUser();
  // Deleting is about a photograph that already exists, so the browser is
  // already known; nothing is minted here (docs/adr/023).
  const actor = await knownActor(user);
  const { id } = await context.params;
  if (actor === null) return Response.json({ ok: false, reason: "not_found" }, { status: 404 });

  const store = await photoStore();
  const photo = await store.deleteOwn(id, actor.key);
  if (photo === null) return Response.json({ ok: false, reason: "not_found" }, { status: 404 });

  const results = (await store.tryOnsForActor(actor.key)).filter((tryOn) => tryOn.uploadId === id && tryOn.resultKey !== null);
  await removeFiles([photo.storageKey, ...results.map((tryOn) => tryOn.resultKey!)]);
  return Response.json({ ok: true });
}
