/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Virtual try-on: a typed FASHN client, and the drawn stand-in that runs while the shop has no key.
 */

import type { CapsuleKind } from "@/lib/catalog/capsule";

/**
 * Try-on (docs/adr/023). One interface, two drivers:
 *
 * - **FASHN**, the paid API the plan names. Checked against its reference on
 *   2026-09-21: `POST https://api.fashn.ai/v1/run` with `model_name` and
 *   `inputs`, answering `{ id }`, then `GET /v1/status/{id}` until `status` is
 *   `completed` and `output` holds the image URLs.
 * - **Drawn**, the stand-in with no key: it composes the garment's own flat lay
 *   over the shopper's photograph. It is not a try-on and never pretends to be
 *   one; the interface labels every drawn result.
 *
 * The shopper's photograph goes to FASHN as a data URI, so it is never given a
 * public URL of its own, and it goes only after the shopper approved that one
 * try-on (docs/PLAN.md 2.9, CLAUDE.md rule 9).
 */

export const FASHN_BASE_URL = "https://api.fashn.ai/v1";

/** What FASHN calls the part of the body a garment belongs to. */
export type TryOnCategory = "auto" | "tops" | "bottoms" | "one-pieces";

export type TryOnRequest = {
  /** The shopper's photograph, as a data URI. */
  person: string;
  /** The piece's own photograph, as a data URI. */
  garment: string;
  category: TryOnCategory;
  /** Quality against speed, as FASHN grades it. */
  mode?: "performance" | "balanced" | "quality";
  seed?: number;
};

export type TryOnOutcome = { ok: true; image: Uint8Array; contentType: string } | { ok: false; reason: string };

export interface TryOnDriver {
  readonly provider: string;
  readonly model: string;
  /** True when a result is a composition rather than a try-on, so the interface can say so. */
  readonly drawn: boolean;
  run(request: TryOnRequest, options?: { signal?: AbortSignal }): Promise<TryOnOutcome>;
}

/** Which part of the body the capsule's kinds belong to. */
export function categoryFor(kind: string): TryOnCategory {
  const tops: CapsuleKind[] = ["TOP", "SHIRT", "KNIT", "JACKET", "COAT"];
  if ((tops as string[]).includes(kind)) return "tops";
  if (kind === "TROUSERS" || kind === "SKIRT") return "bottoms";
  if (kind === "DRESS") return "one-pieces";
  return "auto";
}

type FashnOptions = {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  /** How often the status is asked for, and how long the whole thing may take. */
  pollMs?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
};

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * The paid driver. It asks FASHN to run, polls until the answer is there, and
 * fetches the image itself, so what is stored is the shop's own copy rather
 * than a link to somebody else's server.
 */
export function createFashnDriver({ apiKey, baseUrl = FASHN_BASE_URL, fetch: send = fetch, pollMs = 1_500, timeoutMs = 60_000, sleep = wait }: FashnOptions): TryOnDriver {
  const headers = { authorization: `Bearer ${apiKey}`, "content-type": "application/json" };

  return {
    provider: "fashn",
    model: "tryon-v1.6",
    drawn: false,
    async run(request, options) {
      const started = Date.now();
      const body = JSON.stringify({
        model_name: "tryon-v1.6",
        inputs: {
          model_image: request.person,
          garment_image: request.garment,
          category: request.category,
          mode: request.mode ?? "balanced",
          num_samples: 1,
          output_format: "png",
          ...(request.seed === undefined ? {} : { seed: request.seed }),
        },
      });

      const started_response = await send(`${baseUrl}/run`, { method: "POST", headers, body, signal: options?.signal });
      if (!started_response.ok) return { ok: false, reason: `run_${started_response.status}` };
      const queued = (await started_response.json().catch(() => null)) as { id?: string; error?: string | null } | null;
      if (queued?.id === undefined) return { ok: false, reason: typeof queued?.error === "string" ? queued.error : "no_prediction" };

      while (Date.now() - started < timeoutMs) {
        await sleep(pollMs);
        const statusResponse = await send(`${baseUrl}/status/${queued.id}`, { headers, signal: options?.signal });
        if (!statusResponse.ok) return { ok: false, reason: `status_${statusResponse.status}` };
        const status = (await statusResponse.json().catch(() => null)) as { status?: string; output?: string[]; error?: unknown } | null;
        if (status === null) return { ok: false, reason: "bad_status" };
        if (status.status === "failed" || status.status === "canceled") {
          return { ok: false, reason: typeof status.error === "string" ? status.error : "provider_failed" };
        }
        if (status.status === "completed") {
          const url = status.output?.[0];
          if (url === undefined) return { ok: false, reason: "no_output" };
          const image = await send(url, { signal: options?.signal });
          if (!image.ok) return { ok: false, reason: `image_${image.status}` };
          return { ok: true, image: new Uint8Array(await image.arrayBuffer()), contentType: image.headers.get("content-type") ?? "image/png" };
        }
      }
      return { ok: false, reason: "timeout" };
    },
  };
}

/**
 * The stand-in with no key: the garment's flat lay, composed over the
 * shopper's photograph at the size it would hang. It shows the piece against
 * the person's own colours and light, which is worth something; it is not a
 * fitting, and the interface says so in as many words.
 */
export function createDrawnTryOnDriver(): TryOnDriver {
  return {
    provider: "drawn",
    model: "vitrine-drawn-composite",
    drawn: true,
    async run(request) {
      // sharp is Node-only and heavy; it is loaded where a try-on actually runs.
      const { default: sharp } = await import("sharp");
      const person = dataUriBytes(request.person);
      const garment = dataUriBytes(request.garment);
      if (person === null || garment === null) return { ok: false, reason: "bad_input" };

      try {
        const base = sharp(person).rotate();
        const meta = await base.metadata();
        const width = meta.width ?? 900;
        const height = meta.height ?? 1200;

        // The piece is drawn on the shop's white studio ground; without lifting
        // it off that ground, compositing would paste a white box on the person.
        const raw = await sharp(garment).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        const pixels = raw.data;
        for (let index = 0; index < pixels.length; index += 4) {
          if (pixels[index]! > 236 && pixels[index + 1]! > 236 && pixels[index + 2]! > 236) pixels[index + 3] = 0;
        }
        const cutout = sharp(pixels, { raw: { width: raw.info.width, height: raw.info.height, channels: 4 } }).trim({ threshold: 1 });

        // Where a piece sits on a standing person, roughly: centred, over the
        // torso for tops and from the hip down for what is worn on the legs.
        const garmentWidth = Math.round(width * (request.category === "bottoms" ? 0.34 : 0.44));
        const piece = await cutout.resize(garmentWidth, null, { fit: "inside" }).png().toBuffer();
        const pieceHeight = (await sharp(piece).metadata()).height ?? garmentWidth;
        const top = Math.round(height * (request.category === "bottoms" ? 0.52 : 0.24));
        const left = Math.round((width - garmentWidth) / 2);

        const composed = await base
          .composite([{ input: piece, top: Math.min(top, Math.max(0, height - pieceHeight)), left, blend: "over" }])
          .webp({ quality: 88 })
          .toBuffer();
        return { ok: true, image: new Uint8Array(composed), contentType: "image/webp" };
      } catch {
        return { ok: false, reason: "compose_failed" };
      }
    },
  };
}

/** The bytes of a data URI, or null when it is not one. */
export function dataUriBytes(value: string): Uint8Array | null {
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(value);
  if (match === null) return null;
  try {
    return new Uint8Array(Buffer.from(match[2]!, "base64"));
  } catch {
    return null;
  }
}

export const toDataUri = (bytes: Uint8Array, contentType: string): string => `data:${contentType};base64,${Buffer.from(bytes).toString("base64")}`;
