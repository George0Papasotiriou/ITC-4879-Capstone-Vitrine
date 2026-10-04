/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Tests for who makes AI pictures: never a stand-in in the shop, the image model only when turned on with a key, the tests' fixture otherwise.
 */

import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { MODELS } from "@/lib/ai/models";
import { FIXTURE_MODEL, fixtureJudge, fixtureMaker, googleJudge, googleMaker, pictureModel, picturesProvider, pictureWorkers } from "@/lib/pictures/makers";

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

  it("uses Nano Banana Pro by default and Nano Banana 2 when asked", () => {
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
 * or JSON text, with its usage). Nothing leaves the machine.
 */
function fakeGemini(answer: (body: Record<string, unknown>, url: string) => unknown) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    calls.push({ url, body });
    return new Response(JSON.stringify(answer(body, url)), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

describe("the Gemini adapters, against a scripted Gemini", () => {
  it("asks Nano Banana Pro for one 2K image in the room's framing, thinking hard, reading the photographs at high resolution", async () => {
    const png = await sharp({ create: { width: 64, height: 48, channels: 3, background: "#808080" } }).png().toBuffer();
    const gemini = fakeGemini(() => ({
      candidates: [{ content: { role: "model", parts: [{ inlineData: { mimeType: "image/png", data: png.toString("base64") } }] }, finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 5_400, candidatesTokenCount: 1_120, thoughtsTokenCount: 760, totalTokenCount: 7_280 },
    }));
    const room = { bytes: new Uint8Array(png), contentType: "image/png" };
    const made = await googleMaker(MODELS.imagePro, "test-key", { fetch: gemini.fetch }).make({ prompt: "the brief", images: [room, room], aspectRatio: "3:4", size: "2K" });

    expect(made.ok).toBe(true);
    // The image is charged per image; the photographs read and the thinking by their tokens (src/lib/ai/models.ts).
    expect(made.usage).toEqual({ units: 1, inputTokens: 5_400, outputTokens: 760 });
    expect(gemini.calls).toHaveLength(1);
    const { url, body } = gemini.calls[0]!;
    expect(url).toContain("/models/gemini-3-pro-image:generateContent");
    const config = body.generationConfig as Record<string, unknown>;
    expect(config.responseModalities).toEqual(["IMAGE"]);
    expect(config.imageConfig).toEqual({ imageSize: "2K", aspectRatio: "3:4" });
    expect(config.thinkingConfig).toMatchObject({ thinkingLevel: "high" });
    expect(config.mediaResolution).toBe("MEDIA_RESOLUTION_HIGH");
    // The brief first, then the images in the order the brief names them.
    const parts = (body.contents as { parts: Record<string, unknown>[] }[])[0]!.parts;
    expect(parts[0]).toEqual({ text: "the brief" });
    expect(parts.slice(1).map((part) => Object.keys(part)[0])).toEqual(["inlineData", "inlineData"]);
  });

  it("reads a refusal (no image) as no picture, and charges nothing for the image", async () => {
    const gemini = fakeGemini(() => ({ candidates: [{ content: { role: "model", parts: [{ text: "I can't help with that." }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 8, totalTokenCount: 908 } }));
    const made = await googleMaker(MODELS.image, "test-key", { fetch: gemini.fetch }).make({ prompt: "p", images: [], aspectRatio: "4:3", size: "4K" });
    expect(made.ok).toBe(false);
    expect(made.usage.units ?? 0).toBe(0);
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
    expect(url).toContain("/models/gemini-3.8-flash:generateContent");
    expect((body.generationConfig as Record<string, unknown>).responseMimeType).toBe("application/json");
  });

  it("gives no verdict when the answer is not one, rather than guess", async () => {
    const gemini = fakeGemini(() => ({ candidates: [{ content: { role: "model", parts: [{ text: '{"fidelity": "great"}' }] }, finishReason: "STOP" }] }));
    expect((await googleJudge("test-key", MODELS.pictureJudge, { fetch: gemini.fetch }).judge({ prompt: "p", images: [] })).verdict).toBeNull();
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
