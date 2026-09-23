/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Starting a spoken session: whether voice may run, how it runs, and for how long.
 */

import { z } from "zod";

import { aiActor, usageStore } from "@/lib/ai/server";
import { liveSession, realtimeVoiceConfigured } from "@/lib/ai/surfaces/voice/live";
import { MAX_SESSION_MS, MAX_TURNS, voiceLocale } from "@/lib/ai/surfaces/voice/session";
import { currentUser } from "@/lib/auth/session";

/**
 * The gate for voice (docs/adr/026). A spoken session asks the same questions
 * as any other AI surface before it starts — is AI on, is the day's budget
 * spent, has this shopper any turns left — so a shopper is told *before* they
 * start speaking, not after.
 *
 * It also decides how voice runs. Today that is always the browser's own
 * speech: no key, no cost, nothing sent anywhere. When a realtime key exists,
 * `liveSession` mints an ephemeral token and the answer changes to
 * `mode: "live"`; nothing else in the interface changes.
 */

export const runtime = "nodejs";

const bodySchema = z.object({ locale: z.enum(["en", "el"]).catch("en") });

export type VoiceSessionResponse =
  | {
      ok: true;
      mode: "browser" | "live";
      /** The language tag the recogniser and the voice use. */
      locale: string;
      maxSessionMs: number;
      maxTurns: number;
      /** Turns left in the shopper's allowance today; the spoken session cannot exceed it. */
      turnsLeft: number;
      /** A realtime token, only in live mode. */
      token?: { value: string; url: string; expiresAt: number };
    }
  | { ok: false; reason: "off" | "kill_switch" | "budget" | "credits" | "turns" };

const refuse = (reason: Extract<VoiceSessionResponse, { ok: false }>["reason"]) =>
  Response.json({ ok: false, reason } satisfies VoiceSessionResponse, { status: 409 });

export async function POST(request: Request): Promise<Response> {
  const body = bodySchema.safeParse(await request.json().catch(() => ({})));
  const locale = body.success ? body.data.locale : "en";

  const user = await currentUser();
  const actor = await aiActor(user);
  const usage = await usageStore();

  const gate = await usage.open();
  if (!gate.ok) return refuse(gate.reason);
  const { turns } = await usage.remaining(actor);
  if (turns <= 0) return refuse("turns");

  // The one place that decides how voice runs (docs/adr/026). Today it is
  // always the browser's own speech; when a realtime key exists the token is
  // minted here and nothing in the interface changes.
  const live = realtimeVoiceConfigured();
  const token = live ? liveSession() : undefined;

  // Recorded like every other AI surface, so /admin/ai shows voice being used
  // even while it costs nothing.
  await usage.record({
    feature: "voice",
    model: live
      ? { provider: "google", id: "gemini-live", pricing: { kind: "unverified" } }
      : { provider: "browser", id: "web-speech", pricing: { kind: "tokens", inputUsdPerMillion: 0, outputUsdPerMillion: 0 } },
    surface: "voice",
    actorKey: actor.key,
    usage: { units: 1 },
  });

  return Response.json({
    ok: true,
    mode: live ? "live" : "browser",
    locale: voiceLocale(locale),
    maxSessionMs: MAX_SESSION_MS,
    maxTurns: MAX_TURNS,
    turnsLeft: turns,
    ...(token === undefined ? {} : { token }),
  } satisfies VoiceSessionResponse);
}
