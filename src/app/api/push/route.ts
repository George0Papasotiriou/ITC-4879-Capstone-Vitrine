/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Turning notifications on or off for this browser, for a signed-in shopper.
 */

import { z } from "zod";

import { serverEnv } from "@/env";
import { describeDevice } from "@/lib/auth/paths";
import { currentUser } from "@/lib/auth/session";
import { subscribeSchema } from "@/lib/push/notices";
import { pushStore } from "@/lib/push/server";

/**
 * docs/adr/044. Only accounts: a notification says something about the
 * person's own orders or watches, and a guest has none to say it about. The
 * endpoint must be a browser push service (notices.ts), never anything else
 * the worker could be made to post to.
 */

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  if (serverEnv().vapid === null) return Response.json({ ok: false, reason: "not_configured" }, { status: 404 });
  const user = await currentUser();
  if (user === null) return Response.json({ ok: false, reason: "sign_in" }, { status: 401 });
  const raw = (await request.json().catch(() => null)) as { locale?: unknown } | null;
  const body = subscribeSchema.safeParse(raw);
  if (!body.success) return Response.json({ ok: false, reason: "invalid_request" }, { status: 400 });
  const { browser, system } = describeDevice(request.headers.get("user-agent"));
  await (await pushStore()).subscribe({
    userId: user.id,
    endpoint: body.data.subscription.endpoint,
    p256dh: body.data.subscription.keys.p256dh,
    auth: body.data.subscription.keys.auth,
    topics: body.data.topics,
    locale: raw?.locale === "el" ? "el" : "en",
    device: [browser, system].filter((part) => part !== null).join(" · ") || null,
  });
  return Response.json({ ok: true, topics: body.data.topics });
}

const endpointSchema = z.object({ endpoint: z.string().min(1).max(1000) });

export async function DELETE(request: Request): Promise<Response> {
  const user = await currentUser();
  if (user === null) return Response.json({ ok: false, reason: "sign_in" }, { status: 401 });
  const body = endpointSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ ok: false, reason: "invalid_request" }, { status: 400 });
  await (await pushStore()).unsubscribe(user.id, body.data.endpoint);
  return Response.json({ ok: true });
}
