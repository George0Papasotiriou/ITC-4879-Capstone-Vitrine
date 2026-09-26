/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Realtime voice: which provider carries it, what the session is told, and the short-lived token the browser opens it with.
 */

import { experimental_getRealtimeToolDefinitions as getRealtimeToolDefinitions, tool, type Experimental_RealtimeSessionConfig as RealtimeSessionConfig, type Experimental_RealtimeToolDefinition as RealtimeToolDefinition } from "ai";

import { serverEnv, type ServerEnv } from "@/env";
import { MODELS, type ModelEntry } from "@/lib/ai/models";
import { voiceInstructions } from "@/lib/ai/prompts/voice-v1";
import { toolsFor } from "@/lib/ai/tools/registry";
import { OPEN_WINDOW_SECONDS } from "@/lib/ai/surfaces/voice/sessions";

/**
 * docs/adr/026 built voice on the browser's own speech; docs/adr/030 adds a
 * realtime model beside it. The browser opens the socket to the provider
 * itself, with a token this file mints on the server — the key never leaves
 * the server, and the token only opens a socket for a minute.
 *
 * The token carries the session: the Concierge's instructions for talking
 * live, the language, captions for both sides, and the tools of the registry
 * offered to voice. The model's tool calls come back to the shop through
 * `/api/concierge/tools`, so they run with the same checks, approvals and undo
 * as a typed turn (CLAUDE.md rule 4).
 *
 * Which provider: VOICE_PROVIDER, when its key exists; otherwise nobody, and
 * voice stays on the browser's speech. Nothing here depends on the Concierge's
 * text mode: a voice key beside a demo Concierge still speaks for real, and is
 * charged for real (the usage guard's `paid`).
 */

export type RealtimeProvider = "openai" | "google";

export type RealtimeSetup = { token: string; url: string; expiresAt?: number; tools: RealtimeToolDefinition[] };

/** Mints a token for one session; the provider's own factory in production, a fake in tests. */
export type RealtimeMinter = (options: { model: string; expiresAfterSeconds: number; sessionConfig: RealtimeSessionConfig }) => Promise<{ token: string; url: string; expiresAt?: number }>;

/** The provider that carries realtime voice here, or null for the browser's own speech. */
export function realtimeProvider(env: Pick<ServerEnv, "VOICE_PROVIDER" | "OPENAI_API_KEY" | "GOOGLE_GENERATIVE_AI_API_KEY"> = serverEnv()): RealtimeProvider | null {
  switch (env.VOICE_PROVIDER) {
    case "openai":
      return env.OPENAI_API_KEY === undefined ? null : "openai";
    case "google":
      return env.GOOGLE_GENERATIVE_AI_API_KEY === undefined ? null : "google";
    default:
      return null;
  }
}

/** Whether a realtime session can be minted at all. */
export function realtimeVoiceConfigured(): boolean {
  return realtimeProvider() !== null;
}

export function voiceModel(provider: RealtimeProvider): ModelEntry {
  return provider === "openai" ? MODELS.voiceOpenai : MODELS.voiceGoogle;
}

/** The registry's voice tools, described the way a realtime session takes them. */
export async function realtimeTools(): Promise<RealtimeToolDefinition[]> {
  const tools = Object.fromEntries(toolsFor("voice").map((entry) => [entry.name, tool({ description: entry.description, inputSchema: entry.input })]));
  return getRealtimeToolDefinitions({ tools });
}

/**
 * The session the token is minted for. OpenAI's voice is named; Google's
 * default voice speaks both languages, so it is left to choose. Captions are
 * asked for on both sides: what the shopper said and what was answered are
 * always written as well as heard (docs/adr/026).
 */
export function realtimeSessionConfig({ provider, locale, signedIn, tools }: { provider: RealtimeProvider; locale: "en" | "el"; signedIn: boolean; tools: RealtimeToolDefinition[] }): RealtimeSessionConfig {
  return {
    instructions: voiceInstructions({ locale, signedIn }),
    outputModalities: ["audio"],
    inputAudioTranscription: { language: locale },
    ...(provider === "google" ? { outputAudioTranscription: {} } : { voice: "marin" }),
    tools,
  };
}

/** The provider's own token factory, loaded only when a session is minted. */
export async function providerMinter(provider: RealtimeProvider, env: ServerEnv = serverEnv()): Promise<RealtimeMinter> {
  if (provider === "openai") {
    const { createOpenAI } = await import("@ai-sdk/openai");
    const realtime = createOpenAI({ apiKey: env.OPENAI_API_KEY }).experimental_realtime;
    return (options) => realtime.getToken({ ...options, api: "realtime" });
  }
  const { createGoogleGenerativeAI } = await import("@ai-sdk/google");
  const realtime = createGoogleGenerativeAI({ apiKey: env.GOOGLE_GENERATIVE_AI_API_KEY }).experimental_realtime;
  return (options) => realtime.getToken(options);
}

/** Mints the token a browser opens one realtime session with. */
export async function liveSession({ provider, locale, signedIn, mint }: { provider: RealtimeProvider; locale: "en" | "el"; signedIn: boolean; mint?: RealtimeMinter }): Promise<RealtimeSetup> {
  const tools = await realtimeTools();
  const minter = mint ?? (await providerMinter(provider));
  const token = await minter({
    model: voiceModel(provider).id,
    expiresAfterSeconds: OPEN_WINDOW_SECONDS,
    sessionConfig: realtimeSessionConfig({ provider, locale, signedIn, tools }),
  });
  return { ...token, tools };
}
