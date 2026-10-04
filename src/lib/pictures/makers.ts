/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Who makes and who checks an AI picture: Gemini's image models, one standing in for the other, and a second look by Gemini Flash; or the tests' stand-in.
 */

import { createGoogle } from "@ai-sdk/google";
import { APICallError, generateImage, generateText, NoImageGeneratedError, Output, RetryError } from "ai";

import { MODELS, type ModelEntry, type Usage } from "@/lib/ai/models";
import type { AspectRatio } from "@/lib/pictures/pictures";
import { verdictSchema, type Verdict } from "@/lib/pictures/quality";
import type { PictureImage } from "@/lib/pictures/studio";

/**
 * docs/adr/060. Two small seams, so the pipeline in render.ts is the same
 * code whoever does the work:
 *
 * - an ImageMaker turns a prompt and images into one image: Nano Banana Pro
 *   or Nano Banana 2, asked for 2K (4K for a showroom room);
 * - a PictureJudge looks at the result beside the references and answers
 *   with a typed verdict (src/lib/pictures/quality.ts).
 *
 * Working at all times (George, 2026-10-04, after the first live pictures
 * failed): every failure is named, not swallowed —
 * - `rejected`: Google refused the request itself (400), as it did when Pro
 *   was sent a thinking level only Nano Banana 2 takes;
 * - `busy`: rate limits, overload, timeouts (429, 5xx);
 * - `not_allowed`: the key or its project cannot use the model (401, 403, a
 *   quota of zero — a project without billing);
 * - `unavailable`: no such model (404), or anything unexpected;
 * - `model_refused`: the model answered without an image (its safety rules).
 * and `googleChain` lets one model stand in for the other: Pro first, then
 * Nano Banana 2 (or the other way round), each tried once more without its
 * optional settings if those were what was rejected. Only `not_allowed` stops
 * the chain: the same key cannot use the other model either. What Google
 * said is kept as a short `detail` for the logs — its own error text, never
 * the request, which may hold the shopper's room.
 *
 * Thinking: Nano Banana 2 takes `thinkingLevel` ("high" here: it reasons
 * about the scene before drawing it). Nano Banana Pro always thinks and takes
 * no level (ai.google.dev image generation, "Thinking", checked 2026-10-04).
 *
 * The "fixture" pair is the tests' stand-in (PICTURES_PROVIDER=fixture,
 * refused in production by src/env.ts): the maker hands back the first image
 * it was given — a real photograph, the room — and the judge passes it.
 */

export type ImageSize = "2K" | "4K";

/** How long one image may take before the attempt is given up (Pro at 2K takes from twenty seconds to a minute or two). */
const MAKE_TIMEOUT_MS = 180_000;
const JUDGE_TIMEOUT_MS = 60_000;

export type MakeFailure = "rejected" | "busy" | "not_allowed" | "unavailable" | "model_refused";

/** One call to a model and what it used, so each is paid for under the model that served it. */
export type MakerCall = { entry: ModelEntry; usage: Usage };

export type Made =
  | { ok: true; image: PictureImage; entry: ModelEntry; calls: MakerCall[] }
  | { ok: false; reason: MakeFailure; detail: string | null; calls: MakerCall[] };

export type MakeInput = { prompt: string; images: readonly PictureImage[]; aspectRatio: AspectRatio; size: ImageSize };

export type ImageMaker = {
  readonly entry: ModelEntry;
  make(input: MakeInput): Promise<Made>;
};

export type Judged = { verdict: Verdict | null; usage: Usage; detail?: string | null };

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

/** Whether a model takes a thinking level: Nano Banana 2 does, Nano Banana Pro does not. */
export const takesThinkingLevel = (entry: ModelEntry) => entry.id === MODELS.image.id;

/** Google's own words for an error, from its JSON body when there is one; one line, short. */
function providerMessage(error: APICallError): string {
  let text = error.message;
  try {
    const body = JSON.parse(error.responseBody ?? "") as { error?: { message?: unknown; status?: unknown } };
    if (typeof body.error?.message === "string") text = `${typeof body.error.status === "string" ? `${body.error.status}: ` : ""}${body.error.message}`;
  } catch {
    // Not JSON: the SDK's own message stands.
  }
  return text.replace(/\s+/g, " ").trim().slice(0, 300);
}

/** What went wrong, read from the error the SDK threw. */
export function classifyFailure(error: unknown): { reason: MakeFailure; detail: string } {
  if (RetryError.isInstance(error)) return classifyFailure(error.lastError);
  if (NoImageGeneratedError.isInstance(error)) return { reason: "model_refused", detail: "no image returned" };
  if (APICallError.isInstance(error)) {
    const status = error.statusCode ?? 0;
    const message = providerMessage(error);
    const detail = `${status} ${message}`;
    // A project without billing is told it has a quota of zero: a key problem, not a busy moment.
    if (status === 401 || status === 403 || (status === 429 && /free.?tier|limit: ?0\b|billing/i.test(message))) return { reason: "not_allowed", detail };
    if (status === 429 || status >= 500) return { reason: "busy", detail };
    if (status === 404) return { reason: "unavailable", detail };
    if (status === 400 && /safety|blocked|prohibited/i.test(message)) return { reason: "model_refused", detail };
    if (status >= 400) return { reason: "rejected", detail };
  }
  const name = error instanceof Error ? error.name : "";
  if (name === "TimeoutError" || name === "AbortError") return { reason: "busy", detail: "timed out" };
  const message = error instanceof Error ? error.message : String(error);
  return { reason: "unavailable", detail: message.replace(/\s+/g, " ").slice(0, 300) };
}

/**
 * One Gemini image model. `thinking: false` leaves out the thinking level
 * even where the model takes one: the fallback when the request is refused.
 */
export function googleMaker(entry: ModelEntry, apiKey: string, { fetch, thinking = true }: { fetch?: typeof globalThis.fetch; thinking?: boolean } = {}): ImageMaker {
  const model = createGoogle({ apiKey, fetch }).image(entry.id);
  return {
    entry,
    async make({ prompt, images, aspectRatio, size }) {
      try {
        const result = await generateImage({
          model,
          prompt: images.length === 0 ? prompt : { text: prompt, images: images.map((image) => image.bytes) },
          aspectRatio,
          // One retry for a dropped connection; anything else goes to the next model in the chain.
          maxRetries: 1,
          abortSignal: AbortSignal.timeout(MAKE_TIMEOUT_MS),
          providerOptions: {
            google: {
              imageConfig: { imageSize: size },
              ...(thinking && takesThinkingLevel(entry) ? { thinkingConfig: { thinkingLevel: "high" } } : {}),
            },
          },
        });
        // The call's own metadata: the merged result keeps only each image's entry, not Gemini's usage (ai 7.0.106).
        const usage: Usage = { units: 1, inputTokens: result.usage.inputTokens ?? 0, outputTokens: thinkingTokens(result.calls[0]?.providerMetadata) };
        const image = result.images[0];
        if (image === undefined) return { ok: false, reason: "model_refused", detail: "no image returned", calls: [{ entry, usage: { ...usage, units: 0 } }] };
        return { ok: true, image: { bytes: image.uint8Array, contentType: image.mediaType }, entry, calls: [{ entry, usage }] };
      } catch (error) {
        // A failed call is charged nothing here; whatever Google bills for a refusal is small and not reported back.
        return { ok: false, ...classifyFailure(error), calls: [{ entry, usage: { units: 0 } }] };
      }
    },
  };
}

/** Failures after which the next maker in a chain is tried: all but a key that cannot be used at all. */
const STAND_IN_AFTER: readonly MakeFailure[] = ["rejected", "busy", "unavailable", "model_refused"];

/**
 * Makers tried in turn until one makes the picture. A step runs if it is the
 * first, or if the last failure is one it is meant for (by default anything
 * but `not_allowed`); every call is kept, so every call is paid for.
 */
export function chainMaker(steps: readonly { maker: ImageMaker; after?: readonly MakeFailure[] }[]): ImageMaker {
  if (steps.length === 0) throw new Error("A chain needs at least one maker");
  return {
    entry: steps[0]!.maker.entry,
    async make(input) {
      const calls: MakerCall[] = [];
      let last: Extract<Made, { ok: false }> | null = null;
      for (const [index, step] of steps.entries()) {
        if (index > 0 && (last === null || !(step.after ?? STAND_IN_AFTER).includes(last.reason))) continue;
        const made = await step.maker.make(input);
        calls.push(...made.calls);
        if (made.ok) return { ...made, calls };
        last = made;
      }
      return { ...last!, calls };
    },
  };
}

/** The other image model of the same size: Pro and Nano Banana 2 stand in for each other. */
function standInFor(entry: ModelEntry): ModelEntry {
  if (entry === MODELS.imagePro4k) return MODELS.image4k;
  if (entry === MODELS.image4k) return MODELS.imagePro4k;
  return entry.id === MODELS.imagePro.id ? MODELS.image : MODELS.imagePro;
}

/**
 * The shop's image models as one maker: `primary` first, then the other;
 * a model that takes a thinking level is tried once more without it if the
 * request was rejected.
 */
export function googleChain(primary: ModelEntry, apiKey: string, options: { fetch?: typeof globalThis.fetch } = {}): ImageMaker {
  const steps: { maker: ImageMaker; after?: readonly MakeFailure[] }[] = [];
  for (const entry of [primary, standInFor(primary)]) {
    steps.push({ maker: googleMaker(entry, apiKey, options) });
    if (takesThinkingLevel(entry)) steps.push({ maker: googleMaker(entry, apiKey, { ...options, thinking: false }), after: ["rejected"] });
  }
  return chainMaker(steps);
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
        return { verdict: verdict.success ? verdict.data : null, usage, detail: verdict.success ? null : "the answer was not a verdict" };
      } catch (error) {
        // No verdict: the pipeline keeps the picture it has rather than throw away a paid one (render.ts).
        return { verdict: null, usage: {}, detail: classifyFailure(error).detail };
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
      if (first === undefined) return { ok: false, reason: "model_refused", detail: "nothing to hand back", calls: [{ entry: FIXTURE_MODEL, usage: { units: 0 } }] };
      const { default: sharp } = await import("sharp");
      const bytes = await sharp(Buffer.from(first.bytes)).jpeg({ quality: 90 }).toBuffer();
      return { ok: true, image: { bytes: new Uint8Array(bytes), contentType: "image/jpeg" }, entry: FIXTURE_MODEL, calls: [{ entry: FIXTURE_MODEL, usage: { units: 1 } }] };
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

/** The image model a picture is asked of first, as recorded on its row. */
export function pictureModel(env: PicturesEnv): ModelEntry {
  if (picturesProvider(env) === "fixture") return FIXTURE_MODEL;
  return env.PICTURES_MODEL === "flash" ? MODELS.image : MODELS.imagePro;
}

/** The maker (both models, one standing in for the other) and the judge, or null when pictures are off. */
export function pictureWorkers(env: PicturesEnv, primary: ModelEntry = pictureModel(env)): { maker: ImageMaker; judge: PictureJudge } | null {
  const provider = picturesProvider(env);
  if (provider === "fixture") return { maker: fixtureMaker(), judge: fixtureJudge() };
  if (provider === "off" || env.GOOGLE_GENERATIVE_AI_API_KEY === undefined) return null;
  return { maker: googleChain(primary, env.GOOGLE_GENERATIVE_AI_API_KEY), judge: googleJudge(env.GOOGLE_GENERATIVE_AI_API_KEY) };
}
