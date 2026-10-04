/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Tests for who makes AI pictures: the image models only when turned on with a key, one standing in for the other, every failure named; the tests' fixture otherwise.
 */

import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { MODELS } from "@/lib/ai/models";
import { classifyFailure, FIXTURE_MODEL, fixtureJudge, fixtureMaker, googleChain, googleJudge, googleMaker, pictureModel, picturesProvider, pictureWorkers } from "@/lib/pictures/makers";

const env = (patch: Partial<Parameters<typeof picturesProvider>[0]> = {}): Parameters<typeof picturesProvider>[0] => ({
  PICTURES_PROVIDER: "google",
  PICTURES_MODEL: "pro",
  aiMode: "google",
  GOOGLE_GENERATIVE_AI_API_KEY: "test-key",
  ...patch,
});

describe("picturesProvider (docs/adr/060)", () => {
  it("makes pictures with the image model only when turned on, on Gemini, with a key", () => {
    expect(picturesProvider(env())).toBe("google");
    expect(picturesProvider(env({ PICTURES_PROVIDER: "off" }))).toBe("off");
    expect(picturesProvider(env({ GOOGLE_GENERATIVE_AI_API_KEY: undefined }))).toBe("off");
    expect(picturesProvider(env({ aiMode: "demo" }))).toBe("off");
    expect(picturesProvider(env({ aiMode: "off" }))).toBe("off");
    expect(pictureWorkers(env({ PICTURES_PROVIDER: "off" }))).toBeNull();
  });

  it("asks Nano Banana Pro first by default, and Nano Banana 2 when chosen", () => {
    expect(pictureModel(env())).toBe(MODELS.imagePro);
    expect(pictureModel(env({ PICTURES_MODEL: "flash" }))).toBe(MODELS.image);
    expect(pictureWorkers(env())?.maker.entry).toBe(MODELS.imagePro);
    expect(pictureWorkers(env())?.judge.entry).toBe(MODELS.pictureJudge);
  });

  it("uses the fixture wherever it is set (src/env.ts refuses it in production), and it costs nothing", () => {
    expect(picturesProvider(env({ PICTURES_PROVIDER: "fixture", aiMode: "demo", GOOGLE_GENERATIVE_AI_API_KEY: undefined }))).toBe("fixture");
    expect(pictureModel(env({ PICTURES_PROVIDER: "fixture" }))).toBe(FIXTURE_MODEL);
    expect(FIXTURE_MODEL.pricing).toMatchObject({ kind: "per_unit", usdPerUnit: 0 });
  });
});

/**
 * Gemini's side of a call, played by the test: the request as the installed
 * @ai-sdk/google sends it, answered as the Gemini API answers (an inline image,
 * JSON text, or an error with its status and Google's error body). Nothing
 * leaves the machine.
 */
type GoogleError = { status: number; error: { code: number; message: string; status: string } };
function fakeGemini(answer: (body: Record<string, unknown>, url: string) => unknown) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    calls.push({ url, body });
    const reply = answer(body, url) as Partial<GoogleError>;
    const status = typeof reply.status === "number" ? reply.status : 200;
    return new Response(JSON.stringify(status === 200 ? reply : { error: reply.error }), { status, headers: { "content-type": "application/json" } });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

const PNG = sharp({ create: { width: 64, height: 48, channels: 3, background: "#808080" } })
  .png()
  .toBuffer();
const anImage = async () => ({
  candidates: [{ content: { role: "model", parts: [{ inlineData: { mimeType: "image/png", data: (await PNG).toString("base64") } }] }, finishReason: "STOP" }],
  usageMetadata: { promptTokenCount: 5_400, candidatesTokenCount: 1_120, thoughtsTokenCount: 760, totalTokenCount: 7_280 },
});
const googleError = (status: number, message: string, code = "INVALID_ARGUMENT"): GoogleError => ({ status, error: { code: status, message, status: code } });
const input = { prompt: "the brief", images: [] as { bytes: Uint8Array; contentType: string }[], aspectRatio: "3:4" as const, size: "2K" as const };
const modelOf = (url: string) => /models\/([^:]+):/.exec(url)?.[1];
const configOf = (body: Record<string, unknown>) => body.generationConfig as Record<string, unknown>;

describe("the Gemini adapters, against a scripted Gemini", () => {
  it("asks Nano Banana Pro for one 2K image in the room's framing, with no thinking level (Pro takes none), brief first", async () => {
    const image = await anImage();
    const gemini = fakeGemini(() => image);
    const room = { bytes: new Uint8Array(await PNG), contentType: "image/png" };
    const made = await googleMaker(MODELS.imagePro, "test-key", { fetch: gemini.fetch }).make({ ...input, images: [room, room] });

    expect(made.ok).toBe(true);
    if (!made.ok) return;
    expect(made.entry).toBe(MODELS.imagePro);
    // The image is charged per image; the photographs read and the thinking by their tokens (src/lib/ai/models.ts).
    expect(made.calls).toEqual([{ entry: MODELS.imagePro, usage: { units: 1, inputTokens: 5_400, outputTokens: 760 } }]);
    expect(gemini.calls).toHaveLength(1);
    const { url, body } = gemini.calls[0]!;
    expect(modelOf(url)).toBe("gemini-3-pro-image");
    expect(configOf(body).responseModalities).toEqual(["IMAGE"]);
    expect(configOf(body).imageConfig).toEqual({ imageSize: "2K", aspectRatio: "3:4" });
    // What made the first live pictures fail (2026-10-04): Pro was sent a thinking level, which only Nano Banana 2 takes.
    expect(configOf(body).thinkingConfig).toBeUndefined();
    expect(configOf(body).mediaResolution).toBeUndefined();
    const parts = (body.contents as { parts: Record<string, unknown>[] }[])[0]!.parts;
    expect(parts[0]).toEqual({ text: "the brief" });
    expect(parts.slice(1).map((part) => Object.keys(part)[0])).toEqual(["inlineData", "inlineData"]);
  });

  it("asks Nano Banana 2 to think hard before drawing", async () => {
    const image = await anImage();
    const gemini = fakeGemini(() => image);
    expect((await googleMaker(MODELS.image, "test-key", { fetch: gemini.fetch }).make(input)).ok).toBe(true);
    expect(modelOf(gemini.calls[0]!.url)).toBe("gemini-3.1-flash-image");
    expect(configOf(gemini.calls[0]!.body).thinkingConfig).toMatchObject({ thinkingLevel: "high" });
  });

  it("names what went wrong, in Google's own words, and charges nothing for an image it did not get", async () => {
    const refused = fakeGemini(() => googleError(400, "Thinking level is not supported for this model."));
    const made = await googleMaker(MODELS.imagePro, "test-key", { fetch: refused.fetch }).make(input);
    expect(made).toMatchObject({ ok: false, reason: "rejected", detail: "400 INVALID_ARGUMENT: Thinking level is not supported for this model." });
    expect(made.calls).toEqual([{ entry: MODELS.imagePro, usage: { units: 0 } }]);

    const words = fakeGemini(() => ({ candidates: [{ content: { role: "model", parts: [{ text: "I can't help with that." }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 900, totalTokenCount: 908 } }));
    expect(await googleMaker(MODELS.image, "test-key", { fetch: words.fetch }).make(input)).toMatchObject({ ok: false, reason: "model_refused" });
  });

  it("has Nano Banana 2 stand in when Pro cannot make the picture, and pays for both calls", async () => {
    const image = await anImage();
    const gemini = fakeGemini((_body, url) => (modelOf(url) === "gemini-3-pro-image" ? googleError(400, "Request contains an invalid argument.") : image));
    const made = await googleChain(MODELS.imagePro, "test-key", { fetch: gemini.fetch }).make(input);
    expect(made).toMatchObject({ ok: true, entry: MODELS.image });
    expect(made.calls.map((call) => [call.entry.id, call.usage.units])).toEqual([
      ["gemini-3-pro-image", 0],
      ["gemini-3.1-flash-image", 1],
    ]);
  });

  it("asks Nano Banana 2 once more without its thinking level if that is what was refused", async () => {
    const image = await anImage();
    const gemini = fakeGemini((body) => (configOf(body).thinkingConfig === undefined ? image : googleError(400, "Thinking is not supported.")));
    const made = await googleChain(MODELS.image, "test-key", { fetch: gemini.fetch }).make(input);
    expect(made).toMatchObject({ ok: true, entry: MODELS.image });
    expect(gemini.calls.map((call) => configOf(call.body).thinkingConfig === undefined)).toEqual([false, true]);
  });

  it("stops at once when the key cannot use image models at all (a project without billing), and says so", async () => {
    const gemini = fakeGemini(() => googleError(429, "Quota exceeded for metric: generate_content_free_tier_requests, limit: 0", "RESOURCE_EXHAUSTED"));
    const made = await googleChain(MODELS.imagePro, "test-key", { fetch: gemini.fetch }).make(input);
    expect(made).toMatchObject({ ok: false, reason: "not_allowed" });
    if (made.ok) return;
    expect(made.detail).toContain("limit: 0");
    // Pro only: the same key cannot use Nano Banana 2 either.
    expect(new Set(gemini.calls.map((call) => modelOf(call.url)))).toEqual(new Set(["gemini-3-pro-image"]));
  });

  it("reports the last failure, with every call, when neither model can make it", async () => {
    const gemini = fakeGemini((_body, url) => (modelOf(url) === "gemini-3-pro-image" ? googleError(404, "models/gemini-3-pro-image is not found", "NOT_FOUND") : googleError(400, "Unable to process input image.")));
    const made = await googleChain(MODELS.imagePro, "test-key", { fetch: gemini.fetch }).make(input);
    expect(made).toMatchObject({ ok: false, reason: "rejected" });
    // Pro, Nano Banana 2, and Nano Banana 2 without its thinking level.
    expect(made.calls.map((call) => call.entry.id)).toEqual(["gemini-3-pro-image", "gemini-3.1-flash-image", "gemini-3.1-flash-image"]);
  });

  it("asks Gemini Flash for the verdict as structured output, and reads it back typed", async () => {
    const verdict = { fidelity: 8, realism: 9, scale: 7, roomKept: null, issues: ["the left armrest is slightly too short"] };
    const gemini = fakeGemini(() => ({
      candidates: [{ content: { role: "model", parts: [{ text: JSON.stringify(verdict) }] }, finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 4_800, candidatesTokenCount: 60, totalTokenCount: 4_860 },
    }));
    const judged = await googleJudge("test-key", MODELS.pictureJudge, { fetch: gemini.fetch }).judge({ prompt: "check it", images: [{ bytes: new Uint8Array([1, 2, 3]), contentType: "image/jpeg" }] });
    expect(judged.verdict).toEqual(verdict);
    expect(judged.usage.inputTokens).toBe(4_800);
    const { url, body } = gemini.calls[0]!;
    expect(modelOf(url)).toBe("gemini-3.8-flash");
    expect(configOf(body).responseMimeType).toBe("application/json");
  });

  it("gives no verdict when the answer is not one, or the check fails, and says why", async () => {
    const odd = fakeGemini(() => ({ candidates: [{ content: { role: "model", parts: [{ text: '{"fidelity": "great"}' }] }, finishReason: "STOP" }] }));
    expect((await googleJudge("test-key", MODELS.pictureJudge, { fetch: odd.fetch }).judge({ prompt: "p", images: [] })).verdict).toBeNull();
    const down = fakeGemini(() => googleError(403, "Permission denied", "PERMISSION_DENIED"));
    expect(await googleJudge("test-key", MODELS.pictureJudge, { fetch: down.fetch }).judge({ prompt: "p", images: [] })).toMatchObject({ verdict: null, detail: "403 PERMISSION_DENIED: Permission denied" });
  });
});

describe("classifyFailure", () => {
  it("reads a timeout as busy and anything unknown as unavailable", () => {
    expect(classifyFailure(Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }))).toEqual({ reason: "busy", detail: "timed out" });
    expect(classifyFailure(new Error("socket hang up"))).toEqual({ reason: "unavailable", detail: "socket hang up" });
  });
});

describe("the fixture", () => {
  it("hands back the first photograph it is given, as a JPEG, and its judge passes it", async () => {
    const room = await sharp({ create: { width: 640, height: 480, channels: 3, background: "#a07850" } }).png().toBuffer();
    const made = await fixtureMaker().make({ prompt: "p", images: [{ bytes: new Uint8Array(room), contentType: "image/png" }], aspectRatio: "4:3", size: "2K" });
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    const meta = await sharp(Buffer.from(made.image.bytes)).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["jpeg", 640, 480]);
    expect((await fixtureMaker().make({ prompt: "p", images: [], aspectRatio: "4:3", size: "2K" })).ok).toBe(false);
    expect((await fixtureJudge().judge({ prompt: "p", images: [] })).verdict).toMatchObject({ fidelity: 9, realism: 9, issues: [] });
  });
});
