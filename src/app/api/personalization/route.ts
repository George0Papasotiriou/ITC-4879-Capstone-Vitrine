/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Turns personal recommendations on or off and forgets a shopper's history.
 */

import { cookies } from "next/headers";
import { uuidv7 } from "uuidv7";
import { z } from "zod";

import { serverEnv } from "@/env";
import { ACTOR_COOKIE, CONSENT_COOKIE, currentActor, tasteGraph } from "@/lib/reco/server";

/**
 * Turning personal recommendations on and off, and forgetting a shopper.
 *
 *   enable   creates the anonymous id; from now on views are recorded
 *   disable  stops recording and personal shelves; history is kept, unused
 *   forget   deletes every recorded event for this shopper, then disables
 */

export const runtime = "nodejs";

const bodySchema = z.object({ action: z.enum(["enable", "disable", "forget"]) });
const YEAR_SECONDS = 365 * 24 * 3600;

export async function POST(request: Request): Promise<Response> {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_request", message: "Send { action: enable | disable | forget }." }, { status: 400 });

  const jar = await cookies();
  const secure = serverEnv().NODE_ENV === "production" && serverEnv().VITRINE_LOCAL !== true;
  const actor = await currentActor();

  if (parsed.data.action === "enable") {
    const id = actor ?? uuidv7();
    jar.set(ACTOR_COOKIE, id, { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: YEAR_SECONDS });
    jar.set(CONSENT_COOKIE, "1", { httpOnly: false, sameSite: "lax", secure, path: "/", maxAge: YEAR_SECONDS });
    return Response.json({ enabled: true });
  }

  let forgotten = 0;
  if (parsed.data.action === "forget" && actor !== null) forgotten = await tasteGraph().forget(actor);
  jar.delete(ACTOR_COOKIE);
  jar.delete(CONSENT_COOKIE);
  return Response.json({ enabled: false, forgotten });
}
