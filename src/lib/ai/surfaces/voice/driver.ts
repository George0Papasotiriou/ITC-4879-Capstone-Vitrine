/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * What carries the audio: hearing a shopper and speaking back, behind one interface.
 */

/**
 * One interface, three ways of filling it (docs/adr/026):
 *
 * - **browser**: the speech recognition and speech synthesis built into the
 *   browser. No key, no cost, no audio leaving the device except to the
 *   browser's own service, and it speaks Greek and English.
 * - **live**: a realtime model over a WebSocket, when a key exists. The AI SDK
 *   has the client (`Experimental_AbstractRealtimeSession`); the session route
 *   mints the token.
 * - **scripted**: a conversation written down, for the tests and for showing
 *   the feature where no microphone exists.
 *
 * Everything above the driver — the state machine, the captions, the turn that
 * goes to the Concierge — is the same whichever is in use.
 */

export type VoiceHeard = { text: string; final: boolean };

export type VoiceDriver = {
  readonly kind: "browser" | "live" | "scripted";
  /** Whether this driver can run here at all. */
  readonly available: boolean;
  /** Starts hearing. `onHeard` is called with partial text as it arrives. */
  listen(options: { locale: string; onHeard: (heard: VoiceHeard) => void; onError: (reason: string) => void }): void;
  stopListening(): void;
  /** Says a sentence; the promise settles when it is finished or stopped. */
  speak(text: string, locale: string): Promise<void>;
  stopSpeaking(): void;
};

/** The pieces of the browser's speech API this shop uses, named rather than `any`. */
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: { resultIndex: number; results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
};

type RecognitionConstructor = new () => Recognition;

function recognitionClass(): RecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const candidate = (window as unknown as { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor });
  return candidate.SpeechRecognition ?? candidate.webkitSpeechRecognition ?? null;
}

/** Whether a browser can hear and speak without any key. */
export function browserVoiceAvailable(): boolean {
  return recognitionClass() !== null && typeof window !== "undefined" && "speechSynthesis" in window;
}

/**
 * The browser's own speech. Recognition is continuous with interim results, so
 * the captions fill in as someone speaks and an interruption is noticed on the
 * first syllable rather than at the end of a sentence.
 */
export function createBrowserVoiceDriver(): VoiceDriver {
  let recognition: Recognition | null = null;

  return {
    kind: "browser",
    available: browserVoiceAvailable(),
    listen({ locale, onHeard, onError }) {
      const Recognition = recognitionClass();
      if (Recognition === null) {
        onError("unsupported");
        return;
      }
      this.stopListening();
      const engine = new Recognition();
      engine.lang = locale;
      engine.continuous = true;
      engine.interimResults = true;
      engine.onresult = (event) => {
        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const result = event.results[index]!;
          onHeard({ text: result[0].transcript, final: result.isFinal });
        }
      };
      // "no-speech" and "aborted" are ordinary in a hands-free session: someone
      // who says nothing has not made an error.
      engine.onerror = (event) => {
        if (event.error !== "no-speech" && event.error !== "aborted") onError(event.error);
      };
      recognition = engine;
      engine.start();
    },
    stopListening() {
      if (recognition === null) return;
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      recognition.abort();
      recognition = null;
    },
    speak(text, locale) {
      return new Promise<void>((resolve) => {
        if (typeof window === "undefined" || !("speechSynthesis" in window) || text.trim() === "") {
          resolve();
          return;
        }
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = locale;
        utterance.onend = () => resolve();
        utterance.onerror = () => resolve();
        window.speechSynthesis.speak(utterance);
      });
    },
    stopSpeaking() {
      if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
      // Cancelling settles the promise the utterance is waiting on, so the
      // session hears its own interruption and goes back to listening.
      window.speechSynthesis.cancel();
    },
  };
}

/**
 * A driver a test — or a demonstration on a machine with no microphone — can
 * drive by hand. `window.vitrineVoice.hear("a green rug")` plays a sentence
 * into the session; what the Concierge says back is recorded rather than
 * spoken, so a test can read it.
 */
export type ScriptedVoice = {
  hear: (text: string, options?: { final?: boolean }) => void;
  said: string[];
  speaking: boolean;
};

export function createScriptedVoiceDriver(publish: (scripted: ScriptedVoice) => void): VoiceDriver {
  const scripted: ScriptedVoice = { hear: () => {}, said: [], speaking: false };
  let finish: (() => void) | null = null;

  return {
    kind: "scripted",
    available: true,
    listen({ onHeard }) {
      scripted.hear = (text, options) => onHeard({ text, final: options?.final ?? true });
      publish(scripted);
    },
    stopListening() {
      scripted.hear = () => {};
    },
    speak(text) {
      scripted.said.push(text);
      scripted.speaking = true;
      publish(scripted);
      // A scripted answer takes a moment, so a test can interrupt it.
      return new Promise<void>((resolve) => {
        finish = () => {
          scripted.speaking = false;
          finish = null;
          resolve();
        };
        window.setTimeout(() => finish?.(), 1_200);
      });
    },
    stopSpeaking() {
      finish?.();
    },
  };
}
