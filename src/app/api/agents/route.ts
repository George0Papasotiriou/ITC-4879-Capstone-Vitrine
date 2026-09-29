/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Making an agent key: the signed-in shopper names it, says what it may do and for how long, and sees it once.
 */

import { createKeySchema } from "@/lib/agents/tokens";
import { agentKeys } from "@/lib/ai/surfaces/mcp/server";
import { currentUser } from "@/lib/auth/session";

/**
 * docs/adr/043. Only a signed-in person with a confirmed address makes keys,
 * for themselves; the answer carries the key this one time and never again.
 * Five active keys at most.
 */

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const user = await currentUser();
  if (user === null) return Response.json({ ok: false, reason: "sign_in" }, { status: 401 });
  if (!user.emailVerified) return Response.json({ ok: false, reason: "verify_email" }, { status: 403 });
  const input = createKeySchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return Response.json({ ok: false, reason: "invalid" }, { status: 400 });
  const made = await (await agentKeys()).create({ userId: user.id, email: user.email }, input.data);
  if (!made.ok) return Response.json({ ok: false, reason: made.reason }, { status: 409 });
  return Response.json({ ok: true, key: made.key, id: made.view.id }, { headers: { "cache-control": "no-store" } });
}
