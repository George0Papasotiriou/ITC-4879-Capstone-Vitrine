/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * AI pictures of a piece in a room: asked for here, made by a job, followed until ready.
 */

import { z } from "zod";

import { aiActor, knownActor } from "@/lib/ai/server";
import { currentUser } from "@/lib/auth/session";
import { getProduct } from "@/lib/catalog/server";
import { clientAddress } from "@/lib/geo/ip-country";
import { sharedRateLimiter } from "@/lib/kv/rate-limit";
import { SCENE_STYLE_IDS, type PictureKind, type SceneStyle } from "@/lib/pictures/pictures";
import { pictureStore } from "@/lib/pictures/server";
import { pictureView, startPicture, type PictureView, type StartRefusal } from "@/lib/pictures/start";

/**
 * docs/adr/053. Each picture costs money with a key, so it passes the same
 * guard as every AI call — the kill switch and the shop's daily budget — and
 * the shopper's own allowance for pictures (an account 3 a day, a guest 1:
 * George, 2026-10-03). A showroom scene someone has already made is returned
 * at once and costs nothing. The work itself is a job; this answers with an id.
 *
 * A picture of the shopper's own room needs their photograph, so it comes
 * through the same rules as every photograph (docs/adr/023): consent first,
 * re-encoded on arrival (the camera's metadata dropped), a day to live, and
 * the picture made from it goes with it.
 */

export const runtime = "nodejs";

export type { PictureView };
export type PictureResponse =
  | { ok: true; picture: PictureView; made: boolean; left: number }
  | { ok: true; picture: PictureView }
  | { ok: true; scenes: PictureView[]; left: number | null }
  | { ok: false; reason: StartRefusal | "slow_down" };

const refuse = (reason: Extract<PictureResponse, { ok: false }>["reason"], status: number) => Response.json({ ok: false, reason } satisfies PictureResponse, { status });
/** How each refusal is answered over HTTP. */
const STATUS: Record<StartRefusal, number> = {
  not_found: 404,
  off: 503,
  kill_switch: 429,
  budget: 429,
  allowance: 429,
  invalid_request: 400,
  no_consent: 400,
  type: 400,
  too_large: 413,
  too_small: 400,
  too_many: 400,
  unreadable: 400,
  photo_gone: 410,
};
const perAddress = sharedRateLimiter({ name: "pictures", limit: 12, windowMs: 60_000 });

const sceneSchema = z.object({ kind: z.literal("scene"), productSlug: z.string().trim().min(1).max(200), style: z.enum(SCENE_STYLE_IDS as [SceneStyle, ...SceneStyle[]]) });

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  // A read never mints a guest id (see `knownActor`).
  const user = await currentUser();
  const actor = await knownActor(user);
  const store = await pictureStore();

  const id = params.get("id");
  if (id !== null) {
    if (!z.uuid().safeParse(id).success) return refuse("invalid_request", 400);
    const picture = await store.view(id, actor?.key ?? null);
    if (picture === null) return refuse("not_found", 404);
    return Response.json({ ok: true, picture: await pictureView(picture) } satisfies PictureResponse);
  }

  const slug = params.get("product");
  if (slug === null) return refuse("invalid_request", 400);
  const product = await getProduct(slug, "en");
  if (product === null) return refuse("not_found", 404);
  const scenes = await store.scenesOf(product.id);
  const left = actor === null ? null : await store.left(actor);
  return Response.json({ ok: true, scenes: await Promise.all(scenes.map(pictureView)), left } satisfies PictureResponse);
}

export async function POST(request: Request): Promise<Response> {
  if (!(await perAddress(clientAddress(request.headers) ?? "unknown"))) return refuse("slow_down", 429);
  const user = await currentUser();
  const actor = await aiActor(user);

  let kind: PictureKind;
  let slug: string;
  let style: SceneStyle | null = null;
  let file: File | null = null;
  let consent = false;
  if ((request.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    const form = await request.formData().catch(() => null);
    const sent = form?.get("file");
    const asked = String(form?.get("kind") ?? "");
    if (form === null || !(sent instanceof File) || (asked !== "room" && asked !== "quick")) return refuse("invalid_request", 400);
    kind = asked;
    slug = String(form.get("productSlug") ?? "").trim().slice(0, 200);
    file = sent;
    consent = form.get("consent") === "yes";
  } else {
    const body = sceneSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return refuse("invalid_request", 400);
    kind = "scene";
    slug = body.data.productSlug;
    style = body.data.style;
  }

  const product = slug === "" ? null : await getProduct(slug, "en");
  if (product === null) return refuse("not_found", 404);

  const started = await startPicture({ actor, userId: user?.id ?? null, productId: product.id, kind, style, room: file === null ? null : { file, consent } });
  if (!started.ok) return refuse(started.reason, STATUS[started.reason]);
  return Response.json({ ok: true, picture: await pictureView(started.picture), made: started.made, left: started.left } satisfies PictureResponse);
}
