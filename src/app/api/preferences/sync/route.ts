/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Bringing a device and an account into step: preferences moved to the account, comfort settings shared both ways.
 */

import { z } from "zod";

import { syncDevice } from "@/lib/prefs/server";

/**
 * docs/adr/032, docs/adr/033. Called after signing in, and when the comfort
 * settings change on a signed-in device. For a guest it does nothing.
 */

export const runtime = "nodejs";

const bodySchema = z.object({ comfort: z.string().max(400).default(""), changed: z.boolean().default(false) });

export type SyncResponse = { ok: true; signedIn: boolean; comfort: string | null };

export async function POST(request: Request): Promise<Response> {
  const body = bodySchema.safeParse(await request.json().catch(() => ({})));
  const { comfort, changed } = body.success ? body.data : { comfort: "", changed: false };
  const result = await syncDevice(comfort, { changed });
  return Response.json({ ok: true, ...result } satisfies SyncResponse);
}
