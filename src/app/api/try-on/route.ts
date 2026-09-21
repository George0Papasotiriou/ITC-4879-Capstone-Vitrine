/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Asking for a try-on, and asking how it is getting on.
 */

import { z } from "zod";

import { aiActor, aiMode, usageStore } from "@/lib/ai/server";
import { currentUser } from "@/lib/auth/session";
import { getProduct } from "@/lib/catalog/server";
import { enqueue } from "@/lib/jobs/queue";
import { photoStore, photoUrl } from "@/lib/photos/server";
import { photoExpiry } from "@/lib/photos/photos";
import { serverEnv } from "@/env";

/**
 * A try-on costs credits and, with a key, money — so it goes through the same
 * guard as every other AI call, and the shopper asks for it one piece at a
 * time (docs/adr/023). The work itself runs as a job; this answers at once
 * with an id the page can ask about.
 */

export const runtime = "nodejs";

const askSchema = z.object({ photoId: z.uuid(), productSlug: z.string().trim().min(1).max(200), variantId: z.uuid().optional() });

export type TryOnView = { id: string; status: "queued" | "running" | "done" | "failed"; url: string | null; reason: string | null; drawn: boolean };
export type TryOnResponse =
  | { ok: true; tryOn: TryOnView }
  | { ok: true; tryOns: TryOnView[] }
  | { ok: false; reason: "invalid_request" | "not_found" | "off" | "kill_switch" | "budget" | "credits" | "turns" };

const refuse = (reason: Extract<TryOnResponse, { ok: false }>["reason"], status: number) => Response.json({ ok: false, reason } satisfies TryOnResponse, { status });

const drawn = () => serverEnv().FASHN_API_KEY === undefined;

async function view(tryOn: { id: string; status: string; resultKey: string | null; failureReason: string | null }): Promise<TryOnView> {
  return {
    id: tryOn.id,
    status: tryOn.status as TryOnView["status"],
    url: tryOn.resultKey === null ? null : await photoUrl(tryOn.resultKey),
    reason: tryOn.failureReason,
    drawn: drawn(),
  };
}

export async function GET(): Promise<Response> {
  const actor = await aiActor(await currentUser());
  const tryOns = await (await photoStore()).tryOnsForActor(actor.key);
  return Response.json({ ok: true, tryOns: await Promise.all(tryOns.map((tryOn) => view(tryOn))) } satisfies TryOnResponse);
}

export async function POST(request: Request): Promise<Response> {
  const body = askSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return refuse("invalid_request", 400);

  const user = await currentUser();
  const actor = await aiActor(user);
  const store = await photoStore();

  const photo = await store.byId(body.data.photoId, actor.key);
  if (photo === null || photo.kind !== "try_on") return refuse("not_found", 404);
  const product = await getProduct(body.data.productSlug, "en");
  if (product === null) return refuse("not_found", 404);

  if (aiMode() === "off" && !drawn()) return refuse("off", 409);
  const usage = await usageStore();
  const reserved = await usage.reserveCredits(actor, "try_on");
  if (!reserved.ok) return refuse(reserved.reason === "off" ? "off" : reserved.reason, 409);

  const id = await store.startTryOn({
    uploadId: photo.id,
    productId: product.id,
    variantId: body.data.variantId ?? null,
    actorKey: actor.key,
    provider: drawn() ? "drawn" : "fashn",
    model: drawn() ? "vitrine-drawn-composite" : "tryon-v1.6",
    // The result goes when the photograph does, and never later.
    expiresAt: photo.expiresAt ?? photoExpiry(new Date()),
  });
  await enqueue("try-on", { tryOnId: id, requestedAt: new Date().toISOString() });

  return Response.json({ ok: true, tryOn: { id, status: "queued", url: null, reason: null, drawn: drawn() } } satisfies TryOnResponse);
}
