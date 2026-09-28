/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Receives the shelves seen, opened and bought from, anonymously, for the recommendations dashboard.
 */

import { z } from "zod";

import { SHELVES } from "@/lib/admin/events";
import { logRecoEvents } from "@/lib/admin/server";
import { createRateLimiter } from "@/lib/ai/guardrails/rate-limit";
import { clientAddress } from "@/lib/geo/ip-country";

/**
 * docs/adr/034. No cookie is read and nothing is sent back: the batch holds
 * shelf names from a fixed list, what happened, and at most a product id.
 * Limited per address, so a script cannot fill the table.
 */

export const runtime = "nodejs";

const perAddress = createRateLimiter({ limit: 30, windowMs: 60_000 });

const bodySchema = z.object({
  events: z
    .array(z.object({ shelf: z.enum(SHELVES), kind: z.enum(["impression", "click", "add_to_cart"]), productId: z.uuid().nullable() }))
    .min(1)
    .max(25),
});

export async function POST(request: Request): Promise<Response> {
  if (!perAddress(clientAddress(request.headers) ?? "unknown")) return new Response(null, { status: 429 });
  // Beacons arrive with whatever content type the browser chose, so the body is read as text.
  const body = bodySchema.safeParse(await request.text().then((text) => JSON.parse(text) as unknown).catch(() => null));
  if (!body.success) return new Response(null, { status: 400 });
  logRecoEvents(body.data.events);
  return new Response(null, { status: 204 });
}
