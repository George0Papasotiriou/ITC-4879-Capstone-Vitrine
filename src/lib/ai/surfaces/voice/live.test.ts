/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Unit tests for realtime voice: which provider carries it, what a session is told, how it is settled, and the transcript's order.
 */

import type { UIMessage } from "ai";
import { describe, expect, it, vi } from "vitest";

import { MODELS } from "@/lib/ai/models";
import { toolsFor } from "@/lib/ai/tools/registry";
import { liveSession, realtimeProvider, realtimeSessionConfig, realtimeTools, voiceModel } from "@/lib/ai/surfaces/voice/live";
import { minutesToReserve, OPEN_WINDOW_SECONDS, settlement, VOICE_SESSION_MINUTES } from "@/lib/ai/surfaces/voice/sessions";
import { messageText, withoutEmptySpeech, withSpeech, withToolPart } from "@/lib/ai/surfaces/voice/transcript";

describe("which provider carries realtime voice", () => {
  const keys = { OPENAI_API_KEY: "sk-test", GOOGLE_GENERATIVE_AI_API_KEY: "g-test" };

  it("is the one named, when its key exists", () => {
    expect(realtimeProvider({ ...keys, VOICE_PROVIDER: "openai" })).toBe("openai");
    expect(realtimeProvider({ ...keys, VOICE_PROVIDER: "google" })).toBe("google");
  });

  it("falls back to the browser's speech when the named provider has no key, or when asked to", () => {
    expect(realtimeProvider({ GOOGLE_GENERATIVE_AI_API_KEY: "g-test", OPENAI_API_KEY: undefined, VOICE_PROVIDER: "openai" })).toBeNull();
    expect(realtimeProvider({ OPENAI_API_KEY: "sk-test", GOOGLE_GENERATIVE_AI_API_KEY: undefined, VOICE_PROVIDER: "google" })).toBeNull();
    expect(realtimeProvider({ ...keys, VOICE_PROVIDER: "browser" })).toBeNull();
  });

  it("names models that are listed in models.ts, priced by the minute", () => {
    expect(voiceModel("openai")).toBe(MODELS.voiceOpenai);
    expect(voiceModel("google")).toBe(MODELS.voiceGoogle);
    for (const provider of ["openai", "google"] as const) {
      expect(voiceModel(provider).pricing).toMatchObject({ kind: "per_unit", unit: "minute" });
    }
  });
});

describe("what a realtime session is told", () => {
  it("offers exactly the registry's voice tools, with their input schemas", async () => {
    const tools = await realtimeTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual(toolsFor("voice").map((tool) => tool.name).sort());
    for (const tool of tools) {
      expect(tool.type).toBe("function");
      expect(tool.parameters).toMatchObject({ type: "object" });
    }
  });

  it("speaks the shopper's language, writes both sides down, and carries the Concierge's rules", async () => {
    const tools = await realtimeTools();
    const greek = realtimeSessionConfig({ provider: "google", locale: "el", signedIn: false, tools });
    expect(greek.instructions).toContain("Greek");
    expect(greek.instructions).toContain("Money and truth");
    expect(greek.instructions).toContain("Talking live");
    expect(greek.inputAudioTranscription).toEqual({ language: "el" });
    expect(greek.outputAudioTranscription).toEqual({});
    expect(greek.tools).toBe(tools);

    const english = realtimeSessionConfig({ provider: "openai", locale: "en", signedIn: true, tools });
    expect(english.instructions).toContain("in English");
    expect(english.instructions).toContain("Signed in: yes");
    expect(english.voice).toBe("marin");
  });

  it("mints a token for the model in models.ts, good only for opening the socket", async () => {
    const mint = vi.fn(async () => ({ token: "ephemeral", url: "wss://realtime.example/v1", expiresAt: 1_900_000_000 }));
    const setup = await liveSession({ provider: "openai", locale: "en", signedIn: false, mint });
    expect(mint).toHaveBeenCalledOnce();
    const [options] = mint.mock.calls[0] as unknown as [{ model: string; expiresAfterSeconds: number; sessionConfig: { instructions?: string } }];
    expect(options.model).toBe(MODELS.voiceOpenai.id);
    expect(options.expiresAfterSeconds).toBe(OPEN_WINDOW_SECONDS);
    expect(options.sessionConfig.instructions).toContain("Concierge");
    expect(setup).toMatchObject({ token: "ephemeral", url: "wss://realtime.example/v1" });
    expect(setup.tools.length).toBeGreaterThan(0);
  });
});

describe("settling a session by the server's clock", () => {
  const minted = new Date("2026-09-26T10:00:00Z");
  const at = (seconds: number) => new Date(minted.getTime() + seconds * 1000);

  it("charges the seconds between the token and the end, and gives back whole unused minutes", () => {
    expect(settlement({ reservedMinutes: 3, mintedAt: minted, endedAt: at(75) })).toEqual({ usedSeconds: 75, usedMinutes: 2, unusedMinutes: 1 });
    expect(settlement({ reservedMinutes: 3, mintedAt: minted, endedAt: at(10.2) })).toEqual({ usedSeconds: 11, usedMinutes: 1, unusedMinutes: 2 });
  });

  it("never charges more than was reserved, and nothing for a socket never opened", () => {
    expect(settlement({ reservedMinutes: 3, mintedAt: minted, endedAt: at(3600) })).toEqual({ usedSeconds: 180, usedMinutes: 3, unusedMinutes: 0 });
    expect(settlement({ reservedMinutes: 2, mintedAt: null, endedAt: at(90) })).toEqual({ usedSeconds: 0, usedMinutes: 0, unusedMinutes: 2 });
    // A clock that went backwards is not a refund past zero.
    expect(settlement({ reservedMinutes: 2, mintedAt: minted, endedAt: at(-5) })).toEqual({ usedSeconds: 0, usedMinutes: 0, unusedMinutes: 2 });
  });

  it("reserves the limit, or fewer minutes when fewer credits are left", () => {
    expect(minutesToReserve(20)).toBe(VOICE_SESSION_MINUTES);
    expect(minutesToReserve(2)).toBe(2);
    expect(minutesToReserve(0)).toBe(0);
    expect(minutesToReserve(1.9)).toBe(1);
  });
});

describe("the spoken conversation, written into the Concierge's", () => {
  const tool = (toolCallId: string, state: "input-available" | "output-available") =>
    (state === "output-available"
      ? { type: "tool-search_products", toolCallId, state, input: { query: "rug" }, output: { found: 3 } }
      : { type: "tool-search_products", toolCallId, state, input: { query: "rug" } }) as Parameters<typeof withToolPart>[1]["part"];

  it("places the shopper's message when they stop speaking and fills in their words when they arrive", () => {
    let messages: UIMessage[] = [];
    messages = withSpeech(messages, { id: "u1", role: "user", text: "" });
    messages = withSpeech(messages, { id: "a1", role: "assistant", text: "Here are ", append: true });
    messages = withSpeech(messages, { id: "a1", role: "assistant", text: "three rugs.", append: true });
    // The transcription lands after the answer began: the order on screen stays shopper, then Concierge.
    messages = withSpeech(messages, { id: "u1", role: "user", text: "Show me green rugs" });
    expect(messages.map((message) => [message.role, messageText(message)])).toEqual([
      ["user", "Show me green rugs"],
      ["assistant", "Here are three rugs."],
    ]);
  });

  it("keeps an answer's words after the tools it used, and turns a working tool into its result in place", () => {
    let messages: UIMessage[] = [];
    messages = withSpeech(messages, { id: "a1", role: "assistant", text: "One moment.", append: true });
    messages = withToolPart(messages, { messageId: "a1", part: tool("call-1", "input-available") });
    messages = withToolPart(messages, { messageId: "a1", part: tool("call-1", "output-available") });
    const parts = messages[0]!.parts;
    expect(parts.map((part) => part.type)).toEqual(["tool-search_products", "text"]);
    expect(parts[0]).toMatchObject({ state: "output-available", output: { found: 3 } });
  });

  it("starts an answer for a tool called before any words, and drops turns that stayed empty", () => {
    let messages: UIMessage[] = [];
    messages = withToolPart(messages, { messageId: "a1", part: tool("call-1", "output-available") });
    expect(messages[0]).toMatchObject({ id: "a1", role: "assistant", metadata: { spoken: true } });
    messages = withSpeech(messages, { id: "u2", role: "user", text: "" });
    messages = [...messages, { id: "typed", role: "user", parts: [{ type: "text", text: "" }] }];
    // Only the spoken placeholder goes; a typed message is never touched.
    expect(withoutEmptySpeech(messages).map((message) => message.id)).toEqual(["a1", "typed"]);
  });
});
