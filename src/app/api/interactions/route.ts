/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Records consented browsing events for the Taste Graph.
 */

import { z } from "zod";

import { currentActor, tasteGraph } from "@/lib/reco/server";

/**
 * Records one consented browsing event for the Taste Graph (A2).
 *
 * Only events the browser can honestly report are accepted here — views, time
 * on the page, search clicks and This-or-That choices. Carts and purchases are
 * recorded by the server when they happen, so they cannot be spoofed.
 *
 * Without the consent cookie the request succeeds with 204 and nothing is
 * stored, so the page never needs to know or show an error.
 */

export const runtime = "nodejs";

const eventSchema = z.object({
  productId: z.uuid(),
  kind: z.enum(["view", "dwell", "search_click", "tot_choice"]),
  sessionId: z.string().regex(/^[A-Za-z0-9-]{8,64}$/),
  dwellSeconds: z.number().int().min(0).max(3600).optional(),
});

export async function POST(request: Request): Promise<Response> {
  const actor = await currentActor();
  if (actor === null) return new Response(null, { status: 204 });

  const parsed = eventSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_event" }, { status: 400 });

  const recorded = await tasteGraph().record({ actorId: actor, ...parsed.data });
  return new Response(null, { status: recorded ? 201 : 404 });
}
