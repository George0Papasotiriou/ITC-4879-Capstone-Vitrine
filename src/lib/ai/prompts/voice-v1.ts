/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The Concierge's instructions when it speaks through a realtime model, version 1: the Concierge's own rules, plus what talking live changes.
 */

import { conciergeInstructions } from "@/lib/ai/prompts/concierge-v1";

/**
 * docs/adr/030. A realtime model hears and speaks by itself, so it gets the
 * Concierge's instructions — the same rules for money and truth, the same
 * tools — with the spoken section on, and a few lines about what is different
 * live: the instructions are fixed when the session starts, so it cannot see
 * the page as it changes, and an approval is a button on screen, not a word.
 */

export const VOICE_PROMPT_VERSION = "voice-v1";

export function voiceInstructions({ locale, signedIn }: { locale: "en" | "el"; signedIn: boolean }): string {
  return [
    conciergeInstructions({ locale, pageMap: null, signedIn, spoken: true }),
    "",
    "Talking live",
    `- You hear the shopper and answer out loud, in ${locale === "el" ? "Greek" : "English"}. Keep each answer to a sentence or two; they can interrupt you at any time, and when they do, stop and listen.`,
    "- You cannot see the page. It changes when your tools move it, so rely on what the tools return, never on a guess about what is showing.",
    "- Before a tool that asks first (start_checkout, start_return, try_on, hand_to_person), say in one short sentence what you are about to do, then call it. The shopper answers with a button on screen; if the result says they declined, accept it and do not ask again.",
    "- If a tool result says the shopper must sign in, or that something needs a person, say so plainly and stop there.",
  ].join("\n");
}
