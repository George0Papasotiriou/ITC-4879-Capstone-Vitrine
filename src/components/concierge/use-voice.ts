"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Talking to the Concierge: the microphone, the captions, the interruption, and the turn that goes to the tools.
 */

import { useLocale } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { requestNumbers } from "@/components/comfort/point-by-number";
import { useConcierge } from "@/components/concierge/concierge-provider";
import { numbersRequestOf } from "@/lib/comfort/requests";
import type { RealtimeProvider, RealtimeVoice } from "@/components/concierge/realtime-voice";
import type { VoiceSessionResponse } from "@/app/api/concierge/voice/session/route";
import {
  caption,
  cleanForSpeech,
  nextVoiceState,
  sessionSpent,
  shouldBargeIn,
  voiceLocale,
  type VoiceEvent,
  type VoiceState,
} from "@/lib/ai/surfaces/voice/session";
import { browserVoiceAvailable, createBrowserVoiceDriver, createScriptedVoiceDriver, type ScriptedVoice, type VoiceDriver } from "@/lib/ai/surfaces/voice/driver";

/**
 * docs/adr/026. Speaking is a way in, not a second Concierge: what is heard
 * becomes an ordinary turn at `/api/concierge`, so voice has the same tools,
 * the same approvals, the same undo and the same cost guard as typing. The
 * answer is spoken *and* written, and the dock stays open beside it — text is
 * always one tap away, as the plan asks.
 *
 * With a realtime key (docs/adr/030) the session route reserves a realtime
 * session instead, and a model hears and speaks by itself: the browser's
 * recogniser and voice step aside, the model's tool calls run through the
 * Concierge, and its words are written into the same conversation. The first
 * time, the shopper is told where their voice goes before anything is sent.
 */

/** Remembered once the shopper has read where live voice sends their voice. */
const NOTICE_KEY = "vt_voice_notice";

function noticeRead(): boolean {
  try {
    return window.localStorage.getItem(NOTICE_KEY) === "1";
  } catch {
    return false;
  }
}

type RealtimeSession = Extract<VoiceSessionResponse, { mode: "realtime" }>;

/** Gives a reservation back unused: the socket was never opened, so it costs nothing. */
function giveBack(sessionId: string) {
  void fetch("/api/concierge/voice/session/end", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId }) }).catch(() => {});
}

export type VoiceMode = "hands-free" | "hold";

export type Voice = {
  state: VoiceState;
  /** Whether this browser can hear and speak at all. */
  available: boolean;
  /** What is being heard right now, for the captions. */
  heard: string;
  /** The last thing the Concierge said out loud. */
  said: string;
  mode: VoiceMode;
  setMode: (mode: VoiceMode) => void;
  /** Why voice stopped or would not start. */
  problem: string | null;
  start: () => void;
  stop: () => void;
  /** Push-to-talk: hearing starts when the button is held and the turn is sent when it is let go. */
  hold: () => void;
  release: () => void;
  /** The realtime provider carrying this session, or null on the browser's own speech. */
  live: RealtimeProvider | null;
  /** Shown once before live voice first sends anything: which provider will hear the shopper. */
  notice: RealtimeProvider | null;
  acceptNotice: () => void;
  declineNotice: () => void;
  /** The microphone of a live session, so the presence light can follow the voice. */
  stream: MediaStream | null;
};

/** The scripted driver a test drives by hand, published on the window when asked for. */
declare global {
  interface Window {
    vitrineVoiceScripted?: boolean;
    vitrineVoice?: ScriptedVoice;
  }
}

function chooseDriver(): VoiceDriver {
  if (typeof window !== "undefined" && window.vitrineVoiceScripted === true) {
    return createScriptedVoiceDriver((scripted) => {
      window.vitrineVoice = scripted;
    });
  }
  return createBrowserVoiceDriver();
}

/** The assistant's last answer, as plain text. */
function lastAnswer(messages: { role: string; parts: { type: string; text?: string }[] }[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (message.role !== "assistant") continue;
    return message.parts
      .filter((part) => part.type === "text")
      .map((part) => part.text ?? "")
      .join(" ")
      .trim();
  }
  return "";
}

export function useVoice(): Voice {
  const locale = useLocale();
  const { ask, chat, runSpokenTool, writeSpoken, cancelSpokenApprovals } = useConcierge();
  const [state, setState] = useState<VoiceState>("idle");
  const [mode, setMode] = useState<VoiceMode>("hands-free");
  const [partial, setPartial] = useState("");
  const [final, setFinal] = useState("");
  const [said, setSaid] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [available, setAvailable] = useState(false);
  const [live, setLive] = useState<RealtimeProvider | null>(null);
  const [notice, setNotice] = useState<RealtimeProvider | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const realtime = useRef<RealtimeVoice | null>(null);
  const pending = useRef<RealtimeSession | null>(null);

  const driver = useRef<VoiceDriver | null>(null);
  const session = useRef({ startedAt: 0, turns: 0 });
  const held = useRef("");
  const spoken = useRef<string | null>(null);
  // The state machine is read inside callbacks the browser calls back into, so
  // the current value has to be reachable without re-subscribing every render.
  const current = useRef<VoiceState>("idle");

  const dispatch = useCallback((event: VoiceEvent) => {
    const next = nextVoiceState(current.current, event);
    current.current = next;
    setState(next);
    return next;
  }, []);

  useEffect(() => {
    driver.current = chooseDriver();
    // A realtime session needs only a microphone, so it also speaks in browsers without their own recogniser.
    setAvailable(driver.current.available || browserVoiceAvailable() || typeof navigator.mediaDevices?.getUserMedia === "function");
    return () => {
      driver.current?.stopListening();
      driver.current?.stopSpeaking();
      realtime.current?.stop();
    };
  }, []);

  const stop = useCallback(() => {
    if (realtime.current !== null) {
      realtime.current.stop();
      return;
    }
    driver.current?.stopListening();
    driver.current?.stopSpeaking();
    setPartial("");
    setFinal("");
    dispatch({ type: "stop" });
  }, [dispatch]);

  const send = useCallback(
    (text: string) => {
      const said = text.trim();
      if (said === "") return;
      if (sessionSpent({ startedAt: session.current.startedAt, turns: session.current.turns })) {
        setProblem("spent");
        stop();
        return;
      }
      // Point by number by voice (docs/adr/032): handled on the page, not a turn for the Concierge.
      const numbers = numbersRequestOf(said, document.querySelector('[data-agent-id="numbers:layer"]') !== null);
      if (numbers !== null) {
        setPartial("");
        setFinal(said);
        requestNumbers(numbers);
        return;
      }
      session.current.turns += 1;
      setPartial("");
      setFinal(said);
      dispatch({ type: "answering" });
      ask(said, { spoken: true });
    },
    [ask, dispatch, stop],
  );

  const hear = useCallback(
    ({ text, final: isFinal }: { text: string; final: boolean }) => {
      if (shouldBargeIn(current.current, text)) {
        driver.current?.stopSpeaking();
        dispatch({ type: "interrupt" });
      }
      if (!isFinal) {
        // A new sentence has begun, so the last one stops standing in the captions.
        setPartial(text);
        setFinal("");
        return;
      }
      setPartial("");
      if (mode === "hold") {
        // Push-to-talk: what is heard is gathered and sent when the button is let go.
        held.current = `${held.current} ${text}`.trim();
        setFinal(held.current);
        return;
      }
      send(text);
    },
    [dispatch, mode, send],
  );

  const listen = useCallback(() => {
    driver.current?.listen({
      locale: voiceLocale(locale),
      onHeard: hear,
      onError: (reason) => {
        setProblem(reason);
        dispatch({ type: "error" });
      },
    });
    dispatch({ type: "listen" });
  }, [dispatch, hear, locale]);

  const connect = useCallback(
    async (reserved: RealtimeSession) => {
      const stream = await navigator.mediaDevices?.getUserMedia({ audio: true }).catch(() => null);
      if (stream === null || stream === undefined) {
        setProblem("not-allowed");
        giveBack(reserved.sessionId);
        return;
      }
      const { startRealtimeVoice } = await import("@/components/concierge/realtime-voice");
      setLive(reserved.provider);
      setStream(stream);
      setPartial("");
      setFinal("");
      setSaid("");
      const set = (next: VoiceState) => {
        current.current = next;
        setState(next);
      };
      realtime.current = await startRealtimeVoice({
        provider: reserved.provider,
        sessionId: reserved.sessionId,
        locale: locale === "el" ? "el" : "en",
        maxSessionMs: reserved.maxSessionMs,
        stream,
        handlers: {
          onState: set,
          onHeard: (text) => {
            setPartial("");
            setFinal(text);
          },
          onSaid: setSaid,
          onProblem: setProblem,
          onMessages: writeSpoken,
          runTool: runSpokenTool,
          onEnded: () => {
            realtime.current = null;
            setLive(null);
            setStream(null);
            cancelSpokenApprovals();
            set("idle");
          },
        },
      }).catch(() => {
        setProblem("generic");
        setLive(null);
        setStream(null);
        set("idle");
        stream.getTracks().forEach((track) => track.stop());
        giveBack(reserved.sessionId);
        return null;
      });
    },
    [cancelSpokenApprovals, locale, runSpokenTool, writeSpoken],
  );

  const acceptNotice = useCallback(() => {
    try {
      window.localStorage.setItem(NOTICE_KEY, "1");
    } catch {
      // Without storage the notice is shown again next time, which is the safe side.
    }
    setNotice(null);
    const reserved = pending.current;
    pending.current = null;
    if (reserved !== null) void connect(reserved);
  }, [connect]);

  const declineNotice = useCallback(() => {
    setNotice(null);
    const reserved = pending.current;
    pending.current = null;
    if (reserved !== null) giveBack(reserved.sessionId);
  }, []);

  const start = useCallback(() => {
    setProblem(null);
    void (async () => {
      const response = await fetch("/api/concierge/voice/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ locale }),
      }).catch(() => null);
      const result = (await response?.json().catch(() => null)) as VoiceSessionResponse | null;
      if (result === null || !result.ok) {
        setProblem(result === null ? "generic" : result.reason);
        return;
      }
      session.current = { startedAt: Date.now(), turns: 0 };
      if (result.mode === "realtime") {
        if (noticeRead()) {
          await connect(result);
          return;
        }
        pending.current = result;
        setNotice(result.provider);
        return;
      }
      if (driver.current?.available !== true) {
        setProblem("unsupported");
        return;
      }
      listen();
    })();
  }, [connect, listen, locale]);

  // An answer that has finished streaming is spoken once, and the session goes
  // back to listening the moment it is said (or interrupted).
  useEffect(() => {
    // A realtime model speaks for itself; the browser's voice stays quiet.
    if (chat.status !== "ready" || current.current === "idle" || live !== null) return;
    const answer = lastAnswer(chat.messages as { role: string; parts: { type: string; text?: string }[] }[]);
    if (answer === "" || spoken.current === answer) return;
    spoken.current = answer;

    const text = cleanForSpeech(answer);
    setSaid(text);
    dispatch({ type: "answer", text });
    void driver.current?.speak(text, voiceLocale(locale)).then(() => {
      if (current.current !== "speaking") return;
      dispatch({ type: "spoken" });
      if (mode === "hold") driver.current?.stopListening();
    });
  }, [chat.status, chat.messages, dispatch, locale, mode, live]);

  const hold = useCallback(() => {
    if (realtime.current !== null) {
      realtime.current.capture(true);
      return;
    }
    held.current = "";
    setFinal("");
    if (current.current === "idle") start();
    else listen();
  }, [listen, start]);

  const release = useCallback(() => {
    if (realtime.current !== null) {
      realtime.current.capture(false);
      return;
    }
    driver.current?.stopListening();
    send(held.current);
    held.current = "";
  }, [send]);

  return useMemo(
    () => ({
      state,
      available,
      heard: caption({ partial, final }),
      said,
      mode,
      setMode: (next: VoiceMode) => {
        setMode(next);
        // Live: hands-free hears everything; hold-to-talk hears only while held.
        realtime.current?.capture(next === "hands-free");
      },
      problem,
      start,
      stop,
      hold,
      release,
      live,
      notice,
      acceptNotice,
      declineNotice,
      stream,
    }),
    [state, available, partial, final, said, mode, problem, start, stop, hold, release, live, notice, acceptNotice, declineNotice, stream],
  );
}
