/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * FASHN: a typed client for try-on, video and model shots, the keyless stand-in, and the tests' fixture.
 */

import type { CapsuleKind } from "@/lib/catalog/capsule";
import { fashnCredits, SHOP_MODEL_SHOT, SHOP_TRY_ON_MAX, SHOP_VIDEO, type TryOnEngine } from "@/lib/fitting/engines";

/**
 * Try-on (docs/adr/023) and the studio around it (docs/adr/063). One
 * interface, three drivers:
 *
 * - **FASHN**, the paid API. Checked against its reference on 2026-10-05:
 *   `POST https://api.fashn.ai/v1/run` with `model_name` and `inputs`,
 *   answering `{ id }`, then `GET /v1/status/{id}` until `status` is
 *   `completed` and `output` holds the result. Four models are used:
 *   `tryon-v1.6` (clothes, 1 credit), `tryon-max` (clothes, shoes, bags, hats,
 *   jewellery; 2 credits at the shop's settings), `image-to-video` (five
 *   seconds at 480p, 1 credit) and `product-to-model` (2 credits).
 * - **Drawn**, the stand-in with no key: the photograph beside the piece. It
 *   is not a try-on and never pretends to be one; it makes no video and no
 *   model shot.
 * - **Fixture**, for the tests only (refused in production): it answers like
 *   FASHN with pictures it was given and a short committed video, so every
 *   flow can be tested end to end without a key or a bill.
 *
 * The shopper's photograph goes to FASHN as a data URI, so it never has a
 * public URL of its own, and only after the shopper approved that call
 * (docs/PLAN.md 2.9, CLAUDE.md rule 9). Pictures come back as base64
 * (`return_base64`), which FASHN keeps for 60 minutes instead of three days;
 * Image to Video has no such option, so a video stays on FASHN's servers for
 * up to three days, and the shopper is told so before asking for one.
 */

export const FASHN_BASE_URL = "https://api.fashn.ai/v1";

/** What Try-On v1.6 calls the part of the body a garment belongs to. */
export type TryOnCategory = "auto" | "tops" | "bottoms" | "one-pieces";

export type TryOnRequest = {
  /** The shopper's photograph (or the outfit so far), as a data URI. */
  person: string;
  /** The piece's own photograph, as a data URI. */
  garment: string;
  category: TryOnCategory;
  /** Which FASHN model: v1.6 for clothes, Max for everything else (src/lib/fitting/engines.ts). */
  engine?: TryOnEngine;
  /** Try-On v1.6's quality against speed. */
  mode?: "performance" | "balanced" | "quality";
  seed?: number;
};

export type AnimateRequest = { image: string; prompt?: string };
export type ModelShotRequest = { product: string; prompt: string };

/** A result: the bytes, and what FASHN charged for them in credits. */
export type TryOnOutcome = { ok: true; image: Uint8Array; contentType: string; credits: number; model: string } | { ok: false; reason: string };

export interface TryOnDriver {
  readonly provider: string;
  /** The model a plain try-on uses. */
  readonly model: string;
  /** True when a result is a composition rather than a try-on, so the interface can say so. */
  readonly drawn: boolean;
  run(request: TryOnRequest, options?: { signal?: AbortSignal }): Promise<TryOnOutcome>;
  /** Five seconds of video from a try-on (FASHN Image to Video). */
  animate(request: AnimateRequest, options?: { signal?: AbortSignal }): Promise<TryOnOutcome>;
  /** A piece worn by a model the shopper chose (FASHN Product to Model). */
  modelShot(request: ModelShotRequest, options?: { signal?: AbortSignal }): Promise<TryOnOutcome>;
}

/** Which part of the body the clothes' kinds belong to (Try-On v1.6's `category`). */
export function categoryFor(kind: string): TryOnCategory {
  const tops: CapsuleKind[] = ["TOP", "SHIRT", "KNIT", "JACKET", "COAT"];
  if ((tops as string[]).includes(kind)) return "tops";
  if (kind === "TROUSERS" || kind === "SKIRT") return "bottoms";
  if (kind === "DRESS") return "one-pieces";
  return "auto";
}

/** What the video is asked to show: the person turning a little, the camera still, nothing added. */
export const VIDEO_PROMPT = "The person turns slowly to one side and back, showing how the clothes move; natural, gentle movement, the camera still, the background unchanged.";

type FashnOptions = {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  /** How often the status is asked for, and how long a picture and a video may take. */
  pollMs?: number;
  timeoutMs?: number;
  videoTimeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
};

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * The paid driver. It asks FASHN to run, polls until the answer is there, and
 * keeps the result itself — decoded from base64, or fetched from FASHN's CDN
 * for a video — so what is stored is the shop's own copy rather than a link
 * to somebody else's server.
 */
export function createFashnDriver({ apiKey, baseUrl = FASHN_BASE_URL, fetch: send = fetch, pollMs = 1_500, timeoutMs = 60_000, videoTimeoutMs = 240_000, sleep = wait }: FashnOptions): TryOnDriver {
  const headers = { authorization: `Bearer ${apiKey}`, "content-type": "application/json" };

  async function call(model: string, inputs: Record<string, unknown>, credits: number, limitMs: number, signal?: AbortSignal): Promise<TryOnOutcome> {
    const started = Date.now();
    const startedResponse = await send(`${baseUrl}/run`, { method: "POST", headers, body: JSON.stringify({ model_name: model, inputs }), signal });
    if (!startedResponse.ok) return { ok: false, reason: `run_${startedResponse.status}` };
    const queued = (await startedResponse.json().catch(() => null)) as { id?: string; error?: string | null } | null;
    if (queued?.id === undefined) return { ok: false, reason: typeof queued?.error === "string" ? queued.error : "no_prediction" };

    while (Date.now() - started < limitMs) {
      await sleep(pollMs);
      const statusResponse = await send(`${baseUrl}/status/${queued.id}`, { headers, signal });
      if (!statusResponse.ok) return { ok: false, reason: `status_${statusResponse.status}` };
      const status = (await statusResponse.json().catch(() => null)) as { status?: string; output?: string[]; error?: unknown } | null;
      if (status === null) return { ok: false, reason: "bad_status" };
      if (status.status === "failed" || status.status === "canceled") {
        const error = status.error as { name?: string; message?: string } | string | null | undefined;
        return { ok: false, reason: typeof error === "string" ? error : (error?.name ?? "provider_failed") };
      }
      if (status.status === "completed") {
        const output = status.output?.[0];
        if (output === undefined) return { ok: false, reason: "no_output" };
        // A picture asked for as base64 arrives inside the answer; a video is a link to fetch.
        const inline = dataUri(output);
        if (inline !== null) return { ok: true, image: inline.bytes, contentType: inline.contentType, credits, model };
        const file = await send(output, { signal });
        if (!file.ok) return { ok: false, reason: `image_${file.status}` };
        return { ok: true, image: new Uint8Array(await file.arrayBuffer()), contentType: file.headers.get("content-type") ?? "image/png", credits, model };
      }
    }
    return { ok: false, reason: "timeout" };
  }

  return {
    provider: "fashn",
    model: "tryon-v1.6",
    drawn: false,
    run(request, options) {
      if (request.engine === "max") {
        return call(
          "tryon-max",
          {
            product_image: request.garment,
            model_image: request.person,
            generation_mode: SHOP_TRY_ON_MAX.mode,
            resolution: SHOP_TRY_ON_MAX.resolution,
            num_images: 1,
            output_format: "jpeg",
            return_base64: true,
            ...(request.seed === undefined ? {} : { seed: request.seed }),
          },
          fashnCredits({ model: "tryon-max", ...SHOP_TRY_ON_MAX }),
          timeoutMs,
          options?.signal,
        );
      }
      return call(
        "tryon-v1.6",
        {
          model_image: request.person,
          garment_image: request.garment,
          category: request.category,
          mode: request.mode ?? "balanced",
          garment_photo_type: "auto",
          num_samples: 1,
          output_format: "jpeg",
          return_base64: true,
          ...(request.seed === undefined ? {} : { seed: request.seed }),
        },
        fashnCredits({ model: "tryon-v1.6" }),
        timeoutMs,
        options?.signal,
      );
    },
    animate(request, options) {
      return call(
        "image-to-video",
        { image: request.image, prompt: request.prompt ?? VIDEO_PROMPT, duration: SHOP_VIDEO.seconds, resolution: SHOP_VIDEO.resolution },
        fashnCredits({ model: "image-to-video", ...SHOP_VIDEO }),
        videoTimeoutMs,
        options?.signal,
      );
    },
    modelShot(request, options) {
      return call(
        "product-to-model",
        {
          product_image: request.product,
          prompt: request.prompt,
          aspect_ratio: "3:4",
          generation_mode: SHOP_MODEL_SHOT.mode,
          resolution: SHOP_MODEL_SHOT.resolution,
          num_images: 1,
          output_format: "jpeg",
          return_base64: true,
        },
        fashnCredits({ model: "product-to-model", ...SHOP_MODEL_SHOT }),
        timeoutMs,
        options?.signal,
      );
    },
  };
}

/** Side by side at one height on white: the stand-in's picture of two photographs. */
async function sideBySide(left: Uint8Array, right: Uint8Array): Promise<Uint8Array> {
  // sharp is Node-only and heavy; it is loaded where a try-on actually runs.
  const { default: sharp } = await import("sharp");
  const height = 1200;
  const a = await sharp(left).rotate().resize({ height, fit: "inside" }).flatten({ background: "#ffffff" }).png().toBuffer();
  const b = await sharp(right).resize({ height, fit: "inside" }).flatten({ background: "#ffffff" }).png().toBuffer();
  const aWidth = (await sharp(a).metadata()).width ?? 900;
  const bWidth = (await sharp(b).metadata()).width ?? 900;
  const gutter = 48;
  const composed = await sharp({ create: { width: aWidth + gutter + bWidth, height, channels: 3, background: "#ffffff" } })
    .composite([
      { input: a, top: 0, left: 0 },
      { input: b, top: 0, left: aWidth + gutter },
    ])
    .webp({ quality: 88 })
    .toBuffer();
  return new Uint8Array(composed);
}

/**
 * The stand-in with no key: the shopper's photograph and the garment's own
 * photograph side by side at one height. The capsule's drawings could be laid
 * over the person (docs/adr/023); a real product photograph, often on a model,
 * cannot (docs/adr/062). It is not a fitting, and the interface says so in as
 * many words. It makes no video and no model shot: those need the service.
 */
export function createDrawnTryOnDriver(): TryOnDriver {
  return {
    provider: "drawn",
    model: "vitrine-drawn-composite",
    drawn: true,
    async run(request) {
      const person = dataUriBytes(request.person);
      const garment = dataUriBytes(request.garment);
      if (person === null || garment === null) return { ok: false, reason: "bad_input" };
      try {
        return { ok: true, image: await sideBySide(person, garment), contentType: "image/webp", credits: 0, model: "vitrine-drawn-composite" };
      } catch {
        return { ok: false, reason: "compose_failed" };
      }
    },
    async animate() {
      return { ok: false, reason: "needs_key" };
    },
    async modelShot() {
      return { ok: false, reason: "needs_key" };
    },
  };
}

/**
 * The tests' FASHN (FASHN_PROVIDER=fixture, refused in production). It answers
 * as the service would — a try-on, a video, a model shot, each with FASHN's
 * credits — from what it was given: the try-on is the piece beside the
 * person, the model shot is the product photograph, and the video is a
 * second and a half recorded for the purpose (src/lib/fitting/fixtures/move.webm).
 */
export function createFixtureStudioDriver(video: () => Promise<Uint8Array>): TryOnDriver {
  const drawn = createDrawnTryOnDriver();
  return {
    provider: "fixture",
    model: "tryon-v1.6",
    drawn: false,
    async run(request, options) {
      const outcome = await drawn.run(request, options);
      return outcome.ok ? { ...outcome, model: request.engine === "max" ? "tryon-max" : "tryon-v1.6", credits: fashnCredits(request.engine === "max" ? { model: "tryon-max", ...SHOP_TRY_ON_MAX } : { model: "tryon-v1.6" }) } : outcome;
    },
    async animate(request) {
      if (dataUriBytes(request.image) === null) return { ok: false, reason: "bad_input" };
      return { ok: true, image: await video(), contentType: "video/webm", credits: fashnCredits({ model: "image-to-video", ...SHOP_VIDEO }), model: "image-to-video" };
    },
    async modelShot(request) {
      const product = dataUri(request.product);
      if (product === null) return { ok: false, reason: "bad_input" };
      return { ok: true, image: product.bytes, contentType: product.contentType, credits: fashnCredits({ model: "product-to-model", ...SHOP_MODEL_SHOT }), model: "product-to-model" };
    },
  };
}

/** A data URI's bytes and type, or null when it is not one. */
function dataUri(value: string): { bytes: Uint8Array; contentType: string } | null {
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(value);
  if (match === null) return null;
  try {
    return { bytes: new Uint8Array(Buffer.from(match[2]!, "base64")), contentType: match[1]! };
  } catch {
    return null;
  }
}

/** The bytes of a data URI, or null when it is not one. */
export function dataUriBytes(value: string): Uint8Array | null {
  return dataUri(value)?.bytes ?? null;
}

export const toDataUri = (bytes: Uint8Array, contentType: string): string => `data:${contentType};base64,${Buffer.from(bytes).toString("base64")}`;
