/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Revoking an agent key: it stops working at once, for the one agent that held it.
 */

import { z } from "zod";

import { agentKeys } from "@/lib/ai/surfaces/mcp/server";
import { currentUser } from "@/lib/auth/session";

export const runtime = "nodejs";

export async function DELETE(_request: Request, { params }: RouteContext<"/api/agents/[id]">): Promise<Response> {
  const user = await currentUser();
  if (user === null) return Response.json({ ok: false, reason: "sign_in" }, { status: 401 });
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) return Response.json({ ok: false, reason: "not_found" }, { status: 404 });
  // Only the person's own keys: another person's id finds nothing and says so the same way.
  const revoked = await (await agentKeys()).revoke({ userId: user.id, email: user.email }, id.data);
  return revoked ? Response.json({ ok: true }) : Response.json({ ok: false, reason: "not_found" }, { status: 404 });
}
