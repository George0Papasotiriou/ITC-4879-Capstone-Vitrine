/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The short-lived token a browser opens one reserved realtime voice session with.
 */

import { z } from "zod";

import { knownActor, voiceSessionStore } from "@/lib/ai/server";
import { liveSession, realtimeProvider, type RealtimeSetup } from "@/lib/ai/surfaces/voice/live";
import { currentUser } from "@/lib/auth/session";
import { loggerForRequest } from "@/lib/log";

/**
 * docs/adr/030. The AI SDK's realtime client asks this address for its setup
 * (`api.token`) and opens the socket with what comes back. It is given for a
 * session `/api/concierge/voice/session` has already reserved, to the person
 * who reserved it, once, within a minute — so a reservation is one socket.
 *
 * The client sends its own session settings with the request; they are not
 * read. What the session is told comes from the server alone.
 */

export const runtime = "nodejs";

const querySchema = z.object({ session: z.uuid() });

export async function POST(request: Request): Promise<Response> {
  const query = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!query.success) return Response.json({ ok: false, reason: "invalid_request" }, { status: 400 });

  const user = await currentUser();
  // Reading, not minting: a browser without the cookie never reserved anything.
  const actor = await knownActor(user);
  const provider = realtimeProvider();
  if (actor === null || provider === null) return Response.json({ ok: false, reason: "not_found" }, { status: 404 });

  const store = await voiceSessionStore();
  const opened = await store.open({ id: query.data.session, actor });
  if (!opened.ok) return Response.json({ ok: false, reason: opened.reason }, { status: opened.reason === "not_found" ? 404 : 409 });

  const locale = opened.session.locale === "el" ? "el" : "en";
  try {
    const setup: RealtimeSetup = await liveSession({ provider, locale, signedIn: user !== null });
    return Response.json(setup);
  } catch (error) {
    // The provider refused (a wrong key, an outage): the session never
    // started, so it ends now and costs nothing.
    await store.end({ id: opened.session.id, actor, now: opened.session.mintedAt ?? new Date() });
    loggerForRequest(request.headers).error({ err: error, voice: { provider } }, "realtime token failed");
    return Response.json({ ok: false, reason: "provider" }, { status: 502 });
  }
}
