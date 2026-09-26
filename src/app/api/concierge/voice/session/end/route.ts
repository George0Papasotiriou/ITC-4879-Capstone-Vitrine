/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Ending a realtime voice session: the minutes not used go back, measured by the server's clock.
 */

import { z } from "zod";

import { knownActor, voiceSessionStore } from "@/lib/ai/server";
import { currentUser } from "@/lib/auth/session";

/**
 * docs/adr/030. The browser calls this when the shopper stops, when the
 * reserved minutes run out, and — as a beacon — when the page is closed. It
 * sends only which session; how long it lasted is the server's own
 * measurement, from the token to this request, so a browser cannot report
 * itself cheaper. Ending twice is harmless.
 */

export const runtime = "nodejs";

const bodySchema = z.object({ sessionId: z.uuid() });

export type VoiceEndResponse = { ok: true; usedSeconds: number } | { ok: false; reason: "invalid_request" | "not_found" };

export async function POST(request: Request): Promise<Response> {
  // A beacon arrives as plain text, so the body is read as text either way.
  const body = bodySchema.safeParse(await request.text().then((text) => JSON.parse(text) as unknown).catch(() => null));
  if (!body.success) return Response.json({ ok: false, reason: "invalid_request" } satisfies VoiceEndResponse, { status: 400 });

  const actor = await knownActor(await currentUser());
  if (actor === null) return Response.json({ ok: false, reason: "not_found" } satisfies VoiceEndResponse, { status: 404 });

  const ended = await (await voiceSessionStore()).end({ id: body.data.sessionId, actor });
  if (ended === null) return Response.json({ ok: false, reason: "not_found" } satisfies VoiceEndResponse, { status: 404 });
  return Response.json({ ok: true, usedSeconds: ended.usedSeconds ?? 0 } satisfies VoiceEndResponse);
}
