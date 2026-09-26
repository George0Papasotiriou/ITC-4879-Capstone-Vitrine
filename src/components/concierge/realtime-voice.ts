/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * A realtime voice session in the browser: the socket, the microphone, the captions, the tool calls and the end.
 */

import {
  Experimental_AbstractRealtimeSession as AbstractRealtimeSession,
  type Experimental_RealtimeModel as RealtimeModel,
  type Experimental_RealtimeServerEvent as RealtimeServerEvent,
  type Experimental_RealtimeSessionOptions as RealtimeSessionOptions,
  type Experimental_RealtimeState as RealtimeState,
  type UIMessage,
} from "ai";

import { MODELS } from "@/lib/ai/models";
import type { VoiceState } from "@/lib/ai/surfaces/voice/session";
import { withSpeech, withoutEmptySpeech } from "@/lib/ai/surfaces/voice/transcript";

/**
 * docs/adr/030. Loaded only when the session route says a realtime session is
 * reserved, so the provider packages never weigh on a page where nobody
 * speaks. The AI SDK's session does the hard parts — the socket, the audio in
 * and out, stopping playback the moment the shopper starts talking over it,
 * sending each tool's result back and asking for the next answer. This file
 * connects it to the shop: the four presence states, captions from both
 * transcripts, tool calls run by the Concierge (so approvals and undo work as
 * typed), the reserved minutes, and telling the server when it ended.
 */

export type RealtimeProvider = "openai" | "google";

export type RealtimeHandlers = {
  onState: (state: VoiceState) => void;
  /** What the shopper said, for the captions. */
  onHeard: (text: string) => void;
  /** What the Concierge is saying, for the captions. */
  onSaid: (text: string) => void;
  onProblem: (reason: string) => void;
  /** Writes spoken turns into the Concierge's conversation. */
  onMessages: (update: (messages: UIMessage[]) => UIMessage[]) => void;
  runTool: (call: { toolCallId: string; name: string; input: unknown; messageId: string }) => Promise<unknown>;
  /** The session is over, however it ended. */
  onEnded: () => void;
};

export type RealtimeVoice = {
  stop: () => void;
  /** Push-to-talk: the microphone is heard only while held. */
  capture: (on: boolean) => void;
};

/** The shop's session: the SDK's, reporting each change of state to one listener. */
class ShopRealtimeSession extends AbstractRealtimeSession {
  private listener?: <K extends keyof RealtimeState>(key: K, value: RealtimeState[K]) => void;

  constructor(options: RealtimeSessionOptions, listener: <K extends keyof RealtimeState>(key: K, value: RealtimeState[K]) => void) {
    super(options);
    this.listener = listener;
  }

  protected setState<K extends keyof RealtimeState>(key: K, value: RealtimeState[K]): void {
    this.listener?.(key, value);
  }
}

/**
 * The model object only reads and writes the provider's events here: the key
 * stays on the server, and the browser holds a token that opens one socket.
 */
async function realtimeModel(provider: RealtimeProvider): Promise<RealtimeModel> {
  if (provider === "openai") {
    const { createOpenAI } = await import("@ai-sdk/openai");
    return createOpenAI({ apiKey: "kept-on-the-server" }).experimental_realtime(MODELS.voiceOpenai.id, { api: "realtime" });
  }
  const { createGoogleGenerativeAI } = await import("@ai-sdk/google");
  return createGoogleGenerativeAI({ apiKey: "kept-on-the-server" }).experimental_realtime(MODELS.voiceGoogle.id);
}

/** Tells the server the session is over, so the unused minutes go back. A beacon survives the page closing. */
function endOnServer(sessionId: string, beacon = false) {
  const body = JSON.stringify({ sessionId });
  if (beacon && typeof navigator.sendBeacon === "function") {
    navigator.sendBeacon("/api/concierge/voice/session/end", body);
    return;
  }
  void fetch("/api/concierge/voice/session/end", { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true }).catch(() => {});
}

export async function startRealtimeVoice({
  provider,
  sessionId,
  locale,
  maxSessionMs,
  stream,
  handlers,
}: {
  provider: RealtimeProvider;
  sessionId: string;
  locale: "en" | "el";
  maxSessionMs: number;
  stream: MediaStream;
  handlers: RealtimeHandlers;
}): Promise<RealtimeVoice> {
  const model = await realtimeModel(provider);

  // The conversation, turn by turn: the shopper's message and the answer to it.
  let turn = 0;
  let userId = "";
  let answerId = `voice-a-${sessionId}-0`;
  let heard = "";
  let said = "";
  // Whether the shopper's current message can still grow: until the answer begins.
  let userOpen = false;
  let lastResponse: string | undefined;
  const itemTurns = new Map<string, { userId: string }>();
  let stopped = false;
  let capturing = true;

  const newTurn = () => {
    turn += 1;
    userId = `voice-u-${sessionId}-${turn}`;
    answerId = `voice-a-${sessionId}-${turn}`;
    heard = "";
    said = "";
    userOpen = true;
    lastResponse = undefined;
    handlers.onMessages((messages) => withSpeech(messages, { id: userId, role: "user", text: "" }));
  };

  const hear = (itemId: string | undefined, transcript: string) => {
    if (provider === "openai") {
      // OpenAI names each utterance, and its words can arrive after the answer has begun.
      const bound = itemId === undefined ? undefined : itemTurns.get(itemId);
      if (bound === undefined) {
        newTurn();
        if (itemId !== undefined) itemTurns.set(itemId, { userId });
      }
      const target = bound?.userId ?? userId;
      handlers.onMessages((messages) => withSpeech(messages, { id: target, role: "user", text: transcript.trim() }));
      if (target === userId) {
        heard = transcript.trim();
        handlers.onHeard(heard);
      }
      return;
    }
    // Google sends the words in pieces, under an id it reuses across turns.
    if (!userOpen) newTurn();
    heard += transcript;
    handlers.onMessages((messages) => withSpeech(messages, { id: userId, role: "user", text: heard.trim() }));
    handlers.onHeard(heard.trim());
  };

  const answer = (responseId: string | undefined, delta: string) => {
    userOpen = false;
    // A new response in the same turn (after a tool) starts a new sentence.
    const gap = lastResponse !== undefined && responseId !== lastResponse && said !== "" && !said.endsWith(" ") ? " " : "";
    lastResponse = responseId;
    said += gap + delta;
    const id = answerId;
    handlers.onMessages((messages) => withSpeech(messages, { id, role: "assistant", text: gap + delta, append: true }));
    handlers.onSaid(said);
  };


  const onPageHide = () => endOnServer(sessionId, true);

  const stop = () => {
    if (stopped) return;
    stopped = true;
    window.clearTimeout(timer);
    window.removeEventListener("pagehide", onPageHide);
    try {
      session.disconnect();
    } catch {
      // Already closed.
    }
    stream.getTracks().forEach((track) => track.stop());
    endOnServer(sessionId);
    handlers.onMessages(withoutEmptySpeech);
    handlers.onState("idle");
    handlers.onEnded();
  };

  const onEvent = (event: RealtimeServerEvent) => {
    switch (event.type) {
      case "speech-started":
        // The SDK has already stopped the answer's audio; the shopper has the floor.
        handlers.onState("listening");
        break;
      case "speech-stopped":
      case "audio-committed":
        if (provider === "openai" && event.itemId !== undefined && !itemTurns.has(event.itemId)) {
          newTurn();
          itemTurns.set(event.itemId, { userId });
        }
        handlers.onState("thinking");
        break;
      case "input-transcription-completed":
        hear(event.itemId, event.transcript);
        break;
      case "audio-transcript-delta":
        answer(event.responseId, event.delta);
        break;
      case "error":
        handlers.onProblem("generic");
        break;
      default:
        break;
    }
  };

  const session: ShopRealtimeSession = new ShopRealtimeSession(
    {
      model,
      api: { token: `/api/concierge/voice/realtime?session=${encodeURIComponent(sessionId)}` },
      // What the server minted is what the session is; the browser only asks for captions of the shopper.
      sessionConfig: { inputAudioTranscription: { language: locale }, ...(provider === "google" ? { outputAudioTranscription: {} } : {}) },
      onEvent,
      onError: (error) => {
        // The reason, for whoever opens the console; never the audio or the words.
        console.warn("[voice] realtime session:", error.message);
        handlers.onProblem("generic");
      },
      onToolCall: async ({ toolCall }) => {
        userOpen = false;
        const input = typeof toolCall.args === "string" ? (JSON.parse(toolCall.args || "{}") as unknown) : toolCall.args;
        return handlers.runTool({ toolCallId: toolCall.toolCallId, name: toolCall.toolName, input, messageId: answerId });
      },
    },
    (key, value) => {
      if (stopped) return;
      if (key === "status") {
        const status = value as RealtimeState["status"];
        if (status === "connecting") handlers.onState("thinking");
        if (status === "connected") {
          handlers.onState("listening");
          if (capturing) session.startAudioCapture(stream);
        }
        if (status === "error") {
          handlers.onProblem("generic");
          stop();
        }
        if (status === "disconnected") stop();
      }
      if (key === "isPlaying") handlers.onState(value === true ? "speaking" : "listening");
    },
  );

  window.addEventListener("pagehide", onPageHide);
  // The reserved minutes are the session's length; past them the socket closes.
  const timer = window.setTimeout(() => {
    handlers.onProblem("spent");
    stop();
  }, maxSessionMs);

  handlers.onState("thinking");
  await session.connect();

  return {
    stop,
    capture(on) {
      capturing = on;
      if (stopped) return;
      if (on) session.startAudioCapture(stream);
      else session.stopAudioCapture();
    },
  };
}
