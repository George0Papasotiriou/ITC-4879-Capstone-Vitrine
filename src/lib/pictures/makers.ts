/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Who makes and who checks an AI picture: Gemini's image model and a second look by Gemini Flash, or the tests' stand-in.
 */

import { createGoogle } from "@ai-sdk/google";
import { generateImage, generateText, Output } from "ai";

import { MODELS, type ModelEntry, type Usage } from "@/lib/ai/models";
import type { AspectRatio } from "@/lib/pictures/pictures";
import { verdictSchema, type Verdict } from "@/lib/pictures/quality";
import type { PictureImage } from "@/lib/pictures/studio";

/**
 * docs/adr/060. Two small seams, so the pipeline in render.ts is the same
 * code whoever does the work:
 *
 * - an ImageMaker turns a prompt and images into one image: Nano Banana Pro
 *   (or Nano Banana 2) asked for 2K, or 4K for a showroom room, thinking
 *   "high" — the model reasons about the scene before drawing it — and
 *   reading every image at high resolution;
 * - a PictureJudge looks at the result beside the references and answers
 *   with a typed verdict (src/lib/pictures/quality.ts).
 *
 * The "fixture" pair is the tests' stand-in (PICTURES_PROVIDER=fixture,
 * refused in production by src/env.ts): the maker hands back the first image
 * it was given — a real photograph, the room — and the judge passes it, so
 * every flow runs end to end for nothing without pretending to be a model.
 *
 * Errors are caught and never logged with their input: the room may be the
 * shopper's own.
 */

export type ImageSize = "2K" | "4K";

/** How long one image may take before the attempt is given up (Pro thinking at 2K takes from twenty seconds to a minute or two). */
const MAKE_TIMEOUT_MS = 180_000;
const JUDGE_TIMEOUT_MS = 60_000;

export type Made = { ok: true; image: PictureImage; usage: Usage } | { ok: false; reason: "model_refused" | "no_image"; usage: Usage };

export type ImageMaker = {
  readonly entry: ModelEntry;
  make(input: { prompt: string; images: readonly PictureImage[]; aspectRatio: AspectRatio; size: ImageSize }): Promise<Made>;
};

export type Judged = { verdict: Verdict | null; usage: Usage };

export type PictureJudge = {
  readonly entry: ModelEntry;
  judge(input: { prompt: string; images: readonly PictureImage[] }): Promise<Judged>;
};

/** How the tests' stand-in is recorded: no price, its own provider, so /admin/ai never mistakes it for spend. */
export const FIXTURE_MODEL: ModelEntry = { provider: "fixture", id: "vitrine-picture-fixture", pricing: { kind: "per_unit", unit: "image", usdPerUnit: 0 } };
export const FIXTURE_JUDGE: ModelEntry = { provider: "fixture", id: "vitrine-picture-fixture-judge", pricing: { kind: "tokens", inputUsdPerMillion: 0, outputUsdPerMillion: 0 } };

/** The thinking tokens Gemini reports beside the image, which it bills at its text rate. */
function thinkingTokens(metadata: unknown): number {
  const usage = (metadata as { google?: { usageMetadata?: { thoughtsTokenCount?: unknown } } } | undefined)?.google?.usageMetadata;
  return typeof usage?.thoughtsTokenCount === "number" ? usage.thoughtsTokenCount : 0;
}

/** Gemini's image model, for pictures (2K) and showroom rooms (4K). */
export function googleMaker(entry: ModelEntry, apiKey: string, { fetch }: { fetch?: typeof globalThis.fetch } = {}): ImageMaker {
  const model = createGoogle({ apiKey, fetch }).image(entry.id);
  return {
    entry,
    async make({ prompt, images, aspectRatio, size }) {
      try {
        const result = await generateImage({
          model,
          prompt: images.length === 0 ? prompt : { text: prompt, images: images.map((image) => image.bytes) },
          aspectRatio,
          // One retry for a dropped connection; a refusal is not retried (the check decides about a second attempt).
          maxRetries: 1,
          abortSignal: AbortSignal.timeout(MAKE_TIMEOUT_MS),
          providerOptions: {
            google: {
              imageConfig: { imageSize: size },
              thinkingConfig: { thinkingLevel: "high" },
              mediaResolution: "MEDIA_RESOLUTION_HIGH",
            },
          },
        });
        // The call's own metadata: the merged result keeps only each image's entry, not Gemini's usage (ai 7.0.106).
        const usage: Usage = { units: 1, inputTokens: result.usage.inputTokens ?? 0, outputTokens: thinkingTokens(result.calls[0]?.providerMetadata) };
        const image = result.images[0];
        if (image === undefined) return { ok: false, reason: "no_image", usage: { ...usage, units: 0 } };
        return { ok: true, image: { bytes: image.uint8Array, contentType: image.mediaType }, usage };
      } catch {
        // A refusal or an error is charged nothing here; whatever Google bills for a refusal is small and not reported back.
        return { ok: false, reason: "model_refused", usage: { units: 0 } };
      }
    },
  };
}

/** Gemini Flash, looking at the picture and the references and answering the four questions. */
export function googleJudge(apiKey: string, entry: ModelEntry = MODELS.pictureJudge, { fetch }: { fetch?: typeof globalThis.fetch } = {}): PictureJudge {
  const model = createGoogle({ apiKey, fetch })(entry.id);
  return {
    entry,
    async judge({ prompt, images }) {
      try {
        const result = await generateText({
          model,
          output: Output.object({ schema: verdictSchema }),
          abortSignal: AbortSignal.timeout(JUDGE_TIMEOUT_MS),
          messages: [{ role: "user", content: [{ type: "text", text: prompt }, ...images.map((image) => ({ type: "file" as const, data: image.bytes, mediaType: image.contentType }))] }],
        });
        const usage: Usage = { inputTokens: result.usage.inputTokens ?? 0, outputTokens: result.usage.outputTokens ?? 0 };
        const verdict = verdictSchema.safeParse(result.output);
        return { verdict: verdict.success ? verdict.data : null, usage };
      } catch {
        // No verdict: the pipeline keeps the picture it has rather than throw away a paid one (render.ts).
        return { verdict: null, usage: {} };
      }
    },
  };
}

/** The tests' maker: the first image it is given (the room, or the piece's photograph), as a JPEG. */
export function fixtureMaker(): ImageMaker {
  return {
    entry: FIXTURE_MODEL,
    async make({ images }) {
      const first = images[0];
      if (first === undefined) return { ok: false, reason: "no_image", usage: { units: 0 } };
      const { default: sharp } = await import("sharp");
      const bytes = await sharp(Buffer.from(first.bytes)).jpeg({ quality: 90 }).toBuffer();
      return { ok: true, image: { bytes: new Uint8Array(bytes), contentType: "image/jpeg" }, usage: { units: 1 } };
    },
  };
}

/** The tests' judge: every picture passes, with the scores a good one would have. */
export function fixtureJudge(): PictureJudge {
  return {
    entry: FIXTURE_JUDGE,
    async judge() {
      return { verdict: { fidelity: 9, realism: 9, scale: 8, roomKept: 9, issues: [] }, usage: {} };
    },
  };
}

export type PicturesProvider = "google" | "fixture" | "off";

type PicturesEnv = { PICTURES_PROVIDER: "off" | "google" | "fixture"; PICTURES_MODEL: "pro" | "flash"; aiMode: "google" | "demo" | "off"; GOOGLE_GENERATIVE_AI_API_KEY?: string };

/**
 * Who makes pictures right now. "google" only when George has turned it on,
 * the shop's AI runs on Gemini and there is a key: a deploy never starts
 * spending by itself. Anything less is "off" — no picture is made, and no
 * stand-in pretends to be one.
 */
export function picturesProvider(env: PicturesEnv): PicturesProvider {
  if (env.PICTURES_PROVIDER === "fixture") return "fixture";
  if (env.PICTURES_PROVIDER === "google" && env.aiMode === "google" && env.GOOGLE_GENERATIVE_AI_API_KEY !== undefined) return "google";
  return "off";
}

/** The image model a picture is made with, as recorded on its row and its cost. */
export function pictureModel(env: PicturesEnv): ModelEntry {
  if (picturesProvider(env) === "fixture") return FIXTURE_MODEL;
  return env.PICTURES_MODEL === "flash" ? MODELS.image : MODELS.imagePro;
}

/** The maker and the judge for a picture, or null when pictures are off. */
export function pictureWorkers(env: PicturesEnv): { maker: ImageMaker; judge: PictureJudge } | null {
  const provider = picturesProvider(env);
  if (provider === "fixture") return { maker: fixtureMaker(), judge: fixtureJudge() };
  if (provider === "off" || env.GOOGLE_GENERATIVE_AI_API_KEY === undefined) return null;
  return { maker: googleMaker(pictureModel(env), env.GOOGLE_GENERATIVE_AI_API_KEY), judge: googleJudge(env.GOOGLE_GENERATIVE_AI_API_KEY) };
}
