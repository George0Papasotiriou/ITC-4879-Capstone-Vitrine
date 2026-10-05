/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Asking for a try-on or a whole outfit, and asking how they are getting on.
 */

import { z } from "zod";

import { aiActor, knownActor } from "@/lib/ai/server";
import { currentUser } from "@/lib/auth/session";
import { getProduct } from "@/lib/catalog/server";
import { canAnimate } from "@/lib/fitting/driver";
import { MAX_OUTFIT } from "@/lib/fitting/engines";
import { currentStudioMode, startTryOns } from "@/lib/fitting/server";
import { photoStore, photoUrl } from "@/lib/photos/server";
import type { TryOnRow } from "@/lib/photos/store";

/**
 * A try-on costs credits and, with a key, money — so it goes through the same
 * guard as every other AI call (docs/adr/023). One piece, or an outfit of two
 * to four put on in dressing order (docs/adr/063). The work runs as a job;
 * this answers at once with ids the page can ask about.
 */

export const runtime = "nodejs";

const askSchema = z
  .object({
    photoId: z.uuid(),
    productSlug: z.string().trim().min(1).max(200).optional(),
    productSlugs: z.array(z.string().trim().min(1).max(200)).min(1).max(MAX_OUTFIT).optional(),
    variantId: z.uuid().optional(),
  })
  .refine((body) => (body.productSlug === undefined) !== (body.productSlugs === undefined), { message: "one piece or an outfit" });

export type TryOnVideoView = { status: "queued" | "running" | "done" | "failed"; url: string | null; reason: string | null };
export type TryOnView = {
  id: string;
  status: "queued" | "running" | "done" | "failed";
  url: string | null;
  reason: string | null;
  /** The keyless stand-in's picture: the photograph beside the piece, not a fitting. */
  drawn: boolean;
  /** An outfit's steps share an id; the page shows the last finished one as the outfit. */
  outfitId: string | null;
  outfitPosition: number | null;
  /** "See it move": null until asked for. */
  video: TryOnVideoView | null;
  /** Whether a video can be asked for here: a finished try-on, the service (not the stand-in), never twice. */
  canAnimate: boolean;
};
export type TryOnResponse =
  | { ok: true; tryOn: TryOnView }
  | { ok: true; tryOns: TryOnView[] }
  | { ok: true; outfit: { id: string; steps: TryOnView[] } }
  | {
      ok: false;
      reason: "invalid_request" | "not_found" | "not_wearable" | "too_few" | "too_many" | "same_slot" | "dress_and_separates" | "off" | "kill_switch" | "budget" | "credits" | "turns";
    };

const refuse = (reason: Extract<TryOnResponse, { ok: false }>["reason"], status: number) => Response.json({ ok: false, reason } satisfies TryOnResponse, { status });

export async function viewOf(tryOn: TryOnRow, mode = currentStudioMode()): Promise<TryOnView> {
  const video =
    tryOn.videoStatus === null
      ? null
      : { status: tryOn.videoStatus, url: tryOn.videoStatus === "done" && tryOn.videoKey !== null ? await photoUrl(tryOn.videoKey) : null, reason: tryOn.videoFailure };
  return {
    id: tryOn.id,
    status: tryOn.status,
    url: tryOn.resultKey === null ? null : await photoUrl(tryOn.resultKey),
    reason: tryOn.failureReason,
    drawn: tryOn.provider === "drawn",
    outfitId: tryOn.outfitId,
    outfitPosition: tryOn.outfitPosition,
    video,
    canAnimate: canAnimate(mode) && tryOn.provider !== "drawn" && tryOn.status === "done" && (video === null || video.status === "failed"),
  };
}

export async function GET(): Promise<Response> {
  // A read never mints a guest id (see `knownActor`).
  const actor = await knownActor(await currentUser());
  if (actor === null) return Response.json({ ok: true, tryOns: [] } satisfies TryOnResponse);
  const tryOns = await (await photoStore()).tryOnsForActor(actor.key);
  const mode = currentStudioMode();
  return Response.json({ ok: true, tryOns: await Promise.all(tryOns.map((tryOn) => viewOf(tryOn, mode))) } satisfies TryOnResponse);
}

export async function POST(request: Request): Promise<Response> {
  const body = askSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return refuse("invalid_request", 400);

  const actor = await aiActor(await currentUser());
  const slugs = body.data.productSlugs ?? [body.data.productSlug!];
  const products = await Promise.all(slugs.map((slug) => getProduct(slug, "en")));
  if (products.some((product) => product === null)) return refuse("not_found", 404);

  const started = await startTryOns({ actor, photoId: body.data.photoId, productIds: products.map((product) => product!.id), variantId: body.data.variantId ?? null });
  if (!started.ok) return refuse(started.reason, started.reason === "not_found" ? 404 : started.reason === "not_wearable" || started.reason === "too_few" || started.reason === "too_many" || started.reason === "same_slot" || started.reason === "dress_and_separates" ? 422 : 409);

  const store = await photoStore();
  const rows = (await Promise.all(started.ids.map((id) => store.tryOnById(id, actor.key)))).filter((row): row is TryOnRow => row !== null);
  const views = await Promise.all(rows.map((row) => viewOf(row)));
  if (started.outfitId !== null) return Response.json({ ok: true, outfit: { id: started.outfitId, steps: views } } satisfies TryOnResponse);
  return Response.json({ ok: true, tryOn: views[0]! } satisfies TryOnResponse);
}
