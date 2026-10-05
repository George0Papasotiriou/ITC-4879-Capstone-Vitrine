/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * "On a model like you": the model shots a piece has, and asking for one.
 */

import { z } from "zod";

import { aiActor } from "@/lib/ai/server";
import { currentUser } from "@/lib/auth/session";
import { getProduct } from "@/lib/catalog/server";
import { canAnimate } from "@/lib/fitting/driver";
import { MODEL_PRESETS } from "@/lib/fitting/presets";
import { currentStudioMode, modelShotsFor, requestModelShot, type ModelShotView } from "@/lib/fitting/server";

/**
 * docs/adr/063. Reading costs nothing and needs no identity. Asking pays only
 * when the shot does not exist yet; once made, it is everyone's to see.
 */

export const runtime = "nodejs";

export type ModelShotsResponse =
  | { ok: true; available: boolean; shots: ModelShotView[] }
  | { ok: true; shot: ModelShotView; charged: boolean }
  | { ok: false; reason: "invalid_request" | "not_found" | "not_wearable" | "needs_service" | "off" | "kill_switch" | "budget" | "credits" | "turns" };

const slugSchema = z.string().trim().min(1).max(200);
const askSchema = z.object({ productSlug: slugSchema, preset: z.enum(MODEL_PRESETS) });

export async function GET(request: Request): Promise<Response> {
  const slug = slugSchema.safeParse(new URL(request.url).searchParams.get("product"));
  if (!slug.success) return Response.json({ ok: false, reason: "invalid_request" } satisfies ModelShotsResponse, { status: 400 });
  const product = await getProduct(slug.data, "en");
  if (product === null) return Response.json({ ok: false, reason: "not_found" } satisfies ModelShotsResponse, { status: 404 });
  return Response.json({ ok: true, available: canAnimate(currentStudioMode()), shots: await modelShotsFor(product.id) } satisfies ModelShotsResponse);
}

export async function POST(request: Request): Promise<Response> {
  const body = askSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ ok: false, reason: "invalid_request" } satisfies ModelShotsResponse, { status: 400 });
  const product = await getProduct(body.data.productSlug, "en");
  if (product === null) return Response.json({ ok: false, reason: "not_found" } satisfies ModelShotsResponse, { status: 404 });
  const actor = await aiActor(await currentUser());
  const result = await requestModelShot({ actor, productId: product.id, preset: body.data.preset });
  if (!result.ok) return Response.json(result satisfies ModelShotsResponse, { status: result.reason === "not_found" ? 404 : 409 });
  return Response.json({ ok: true, shot: result.shot, charged: result.charged } satisfies ModelShotsResponse);
}
