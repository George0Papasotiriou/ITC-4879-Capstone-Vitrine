/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Tests for the rules of a spoken conversation.
 */

import { describe, expect, it } from "vitest";

import {
  MAX_SESSION_MS,
  MAX_TURNS,
  caption,
  cleanForSpeech,
  nextVoiceState,
  sessionSpent,
  shouldBargeIn,
  voiceLocale,
  type VoiceEvent,
  type VoiceState,
} from "@/lib/ai/surfaces/voice/session";

/** Plays a sequence of events from idle, as a conversation would. */
const run = (events: VoiceEvent[], from: VoiceState = "idle"): VoiceState => events.reduce(nextVoiceState, from);

describe("what the Concierge is doing", () => {
  it("goes round the loop of a turn", () => {
    expect(run([{ type: "listen" }])).toBe("listening");
    expect(run([{ type: "listen" }, { type: "heard", final: false, text: "a lamp" }])).toBe("listening");
    expect(run([{ type: "listen" }, { type: "answering" }])).toBe("thinking");
    expect(run([{ type: "listen" }, { type: "answering" }, { type: "answer", text: "Here are three." }])).toBe("speaking");
    // When it has finished speaking it listens again, without being asked.
    expect(run([{ type: "listen" }, { type: "answering" }, { type: "answer", text: "…" }, { type: "spoken" }])).toBe("listening");
  });

  it("stops whatever it is doing when told to", () => {
    for (const state of ["idle", "listening", "thinking", "speaking"] as const) {
      expect(nextVoiceState(state, { type: "stop" })).toBe("idle");
      expect(nextVoiceState(state, { type: "error" })).toBe("idle");
    }
  });

  it("listens again the moment it is interrupted", () => {
    expect(nextVoiceState("speaking", { type: "interrupt" })).toBe("listening");
    expect(shouldBargeIn("speaking", "no, the other one")).toBe(true);
    // A breath is not an interruption, and nothing interrupts what is not being said.
    expect(shouldBargeIn("speaking", " ")).toBe(false);
    expect(shouldBargeIn("thinking", "no, the other one")).toBe(false);
  });

  it("ignores what makes no sense where it is", () => {
    expect(nextVoiceState("idle", { type: "spoken" })).toBe("idle");
    expect(nextVoiceState("listening", { type: "spoken" })).toBe("listening");
  });
});

describe("how long a session lasts", () => {
  const startedAt = 1_000_000;

  it("ends after its length or its turns, whichever comes first", () => {
    expect(sessionSpent({ startedAt, turns: 2, now: startedAt + 60_000 })).toBe(false);
    expect(sessionSpent({ startedAt, turns: 2, now: startedAt + MAX_SESSION_MS })).toBe(true);
    expect(sessionSpent({ startedAt, turns: MAX_TURNS, now: startedAt + 1_000 })).toBe(true);
  });
});

describe("what is said out loud", () => {
  it("says the words of a link, not its address", () => {
    // The dash stays: it is punctuation, and a speech engine reads it as a pause.
    expect(cleanForSpeech("See the [Emerly Modern Sofa](/en/p/emerly-modern-sofa) — it fits.")).toBe("See the Emerly Modern Sofa — it fits.");
    expect(cleanForSpeech("Here: https://vitrine.test/en/cart")).toBe("Here:");
  });

  it("drops the marks that are for the eye", () => {
    expect(cleanForSpeech("**Three** pieces:\n- a lamp\n- a rug")).toBe("Three pieces:. a lamp. a rug");
    expect(cleanForSpeech("Added ✅ to your cart")).toBe("Added to your cart");
  });

  it("stops a long answer at a sentence, not mid-word", () => {
    const long = `${"A sofa that fits the wall. ".repeat(30)}`;
    const spoken = cleanForSpeech(long);
    expect(spoken.length).toBeLessThanOrEqual(420);
    expect(spoken.endsWith(".")).toBe(true);
  });

  it("leaves Greek alone", () => {
    expect(cleanForSpeech("Βρήκα τρία κομμάτια στα μέτρα σου.")).toBe("Βρήκα τρία κομμάτια στα μέτρα σου.");
  });
});

describe("captions and languages", () => {
  it("shows what has been heard so far until the sentence is finished", () => {
    expect(caption({ partial: "a green", final: "" })).toBe("a green");
    expect(caption({ partial: "a green", final: "a green rug" })).toBe("a green rug");
  });

  it("speaks the language the page is in", () => {
    expect(voiceLocale("el")).toBe("el-GR");
    expect(voiceLocale("en")).toBe("en-GB");
    expect(voiceLocale("fr")).toBe("en-GB");
  });
});
