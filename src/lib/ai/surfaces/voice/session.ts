/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The rules of a spoken conversation: what the Concierge is doing, when it stops, and what it says out loud.
 */

/**
 * Voice, as a state machine (docs/PLAN.md Phase 7, docs/adr/026).
 *
 * Everything here is pure, so the awkward parts of talking — being interrupted
 * mid-sentence, a session that has run long enough, text that must be spoken
 * rather than read — are decided in code that can be tested without a
 * microphone, a browser or a key. The drivers around it only carry audio.
 */

/** What the Concierge is doing, and what the presence light shows. */
export type VoiceState = "idle" | "listening" | "thinking" | "speaking";

export type VoiceEvent =
  | { type: "listen" }
  | { type: "heard"; final: boolean; text: string }
  | { type: "answering" }
  | { type: "answer"; text: string }
  | { type: "spoken" }
  | { type: "interrupt" }
  | { type: "stop" }
  | { type: "error" };

/** How long one spoken session may last before the shop asks to carry on. */
export const MAX_SESSION_MS = 10 * 60_000;

/** Turns in one session: a spoken conversation that runs longer belongs to a person. */
export const MAX_TURNS = 20;

/** Nothing shorter is treated as speech; a cough should not interrupt an answer. */
export const BARGE_IN_CHARACTERS = 2;

/** The voice each language is spoken in, as the browser and the realtime models name it. */
export const VOICE_LOCALES: Readonly<Record<string, string>> = { en: "en-GB", el: "el-GR" };

export const voiceLocale = (locale: string): string => VOICE_LOCALES[locale] ?? VOICE_LOCALES.en!;

/**
 * The next thing the Concierge is doing.
 *
 * Two rules matter and both are here rather than in a component: a shopper who
 * starts speaking while the Concierge is speaking always wins, and "stop"
 * always lands, from any state.
 */
export function nextVoiceState(state: VoiceState, event: VoiceEvent): VoiceState {
  if (event.type === "stop" || event.type === "error") return "idle";
  switch (state) {
    case "idle":
      return event.type === "listen" ? "listening" : state;
    case "listening":
      if (event.type === "answering") return "thinking";
      return state;
    case "thinking":
      if (event.type === "answer") return "speaking";
      // A shopper who adds something while it is thinking is heard, not ignored.
      if (event.type === "heard" && event.final) return "thinking";
      if (event.type === "listen") return "listening";
      return state;
    case "speaking":
      if (event.type === "spoken") return "listening";
      if (event.type === "interrupt") return "listening";
      return state;
  }
}

/** Whether what was just heard should stop the Concierge mid-sentence. */
export function shouldBargeIn(state: VoiceState, heard: string): boolean {
  return state === "speaking" && heard.trim().length >= BARGE_IN_CHARACTERS;
}

/** Whether this session has run its length, or its turns. */
export function sessionSpent({ startedAt, turns, now = Date.now() }: { startedAt: number; turns: number; now?: number }): boolean {
  return now - startedAt >= MAX_SESSION_MS || turns >= MAX_TURNS;
}

/** Longer than this and a spoken answer stops being an answer; the rest stays on screen. */
const SPOKEN_CHARACTERS = 420;

/**
 * What the Concierge says out loud.
 *
 * The written answer is for the eye: it has links, prices in bold, lists and
 * the occasional euro sign right against a number. Read aloud, the markup
 * becomes noise, so it is taken out, and a long answer is cut at a sentence —
 * the whole of it stays in the captions and in the dock.
 */
export function cleanForSpeech(text: string, limit = SPOKEN_CHARACTERS): string {
  const spoken = text
    // Links: say the words, not the address.
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    // Emphasis, headings, list bullets and code ticks.
    .replace(/[*_`#>]+/g, " ")
    .replace(/^\s*[-–—]\s+/gm, " ")
    // Anything outside the languages this shop speaks — emoji and symbols.
    .replace(/[^\p{Letter}\p{Number}\p{Punctuation}\p{Zs}\n]/gu, " ")
    .replace(/\s*\n+\s*/g, ". ")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();

  if (spoken.length <= limit) return spoken;
  const cut = spoken.slice(0, limit);
  const sentence = Math.max(cut.lastIndexOf("."), cut.lastIndexOf(";"), cut.lastIndexOf("!"), cut.lastIndexOf("?"));
  return (sentence > limit / 2 ? cut.slice(0, sentence + 1) : `${cut.trimEnd()}…`).trim();
}

/** The caption shown while someone is speaking: the final text, or what has been heard so far. */
export function caption({ partial, final }: { partial: string; final: string }): string {
  return (final.trim() === "" ? partial : final).trim();
}
