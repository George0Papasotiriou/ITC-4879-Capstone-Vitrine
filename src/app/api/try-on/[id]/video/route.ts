/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * "See it move": asking for five seconds of video made from a finished try-on.
 */

import { z } from "zod";

import { aiActor } from "@/lib/ai/server";
import { currentUser } from "@/lib/auth/session";
import { startTryOnVideo } from "@/lib/fitting/server";

/**
 * docs/adr/063. Accounts only, once per try-on, and never with the keyless
 * stand-in. The video is made as a job; the Fitting Room's own polling picks
 * it up (`GET /api/try-on`).
 */

export const runtime = "nodejs";

export type VideoResponse = { ok: true } | { ok: false; reason: "invalid_request" | "sign_in" | "needs_service" | "not_ready" | "off" | "kill_switch" | "budget" | "credits" | "turns" };

export async function POST(_request: Request, { params }: RouteContext<"/api/try-on/[id]/video">): Promise<Response> {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return Response.json({ ok: false, reason: "invalid_request" } satisfies VideoResponse, { status: 400 });
  const actor = await aiActor(await currentUser());
  const started = await startTryOnVideo({ actor, tryOnId: id });
  if (!started.ok) return Response.json(started satisfies VideoResponse, { status: started.reason === "sign_in" ? 401 : 409 });
  return Response.json({ ok: true } satisfies VideoResponse);
}
