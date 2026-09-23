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

import { useConcierge } from "@/components/concierge/concierge-provider";
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
 */

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
  const { ask, chat } = useConcierge();
  const [state, setState] = useState<VoiceState>("idle");
  const [mode, setMode] = useState<VoiceMode>("hands-free");
  const [partial, setPartial] = useState("");
  const [final, setFinal] = useState("");
  const [said, setSaid] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [available, setAvailable] = useState(false);

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
    setAvailable(driver.current.available || browserVoiceAvailable());
    return () => {
      driver.current?.stopListening();
      driver.current?.stopSpeaking();
    };
  }, []);

  const stop = useCallback(() => {
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
      if (driver.current?.available !== true) {
        setProblem("unsupported");
        return;
      }
      listen();
    })();
  }, [listen, locale]);

  // An answer that has finished streaming is spoken once, and the session goes
  // back to listening the moment it is said (or interrupted).
  useEffect(() => {
    if (chat.status !== "ready" || current.current === "idle") return;
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
  }, [chat.status, chat.messages, dispatch, locale, mode]);

  const hold = useCallback(() => {
    held.current = "";
    setFinal("");
    if (current.current === "idle") start();
    else listen();
  }, [listen, start]);

  const release = useCallback(() => {
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
      setMode,
      problem,
      start,
      stop,
      hold,
      release,
    }),
    [state, available, partial, final, said, mode, problem, start, stop, hold, release],
  );
}
