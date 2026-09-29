/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * What this browser is subscribed to, for the preferences page to show.
 */

import { z } from "zod";

import { currentUser } from "@/lib/auth/session";
import { pushStore } from "@/lib/push/server";

/** docs/adr/044. A POST, so the browser's endpoint never sits in a URL or a log line. */

export const runtime = "nodejs";

const bodySchema = z.object({ endpoint: z.string().min(1).max(1000) });

export async function POST(request: Request): Promise<Response> {
  const user = await currentUser();
  if (user === null) return Response.json({ subscribed: false, topics: [] });
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ subscribed: false, topics: [] });
  const found = await (await pushStore()).byEndpoint(user.id, body.data.endpoint);
  return Response.json(found === null ? { subscribed: false, topics: [] } : { subscribed: true, topics: found.topics });
}
