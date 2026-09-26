/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Starting a spoken session: whether voice may run, how it runs, and for how long.
 */

import { z } from "zod";

import { aiActor, usageStore, voiceSessionStore } from "@/lib/ai/server";
import { realtimeProvider, voiceModel, type RealtimeProvider } from "@/lib/ai/surfaces/voice/live";
import { MAX_SESSION_MS, MAX_TURNS, voiceLocale } from "@/lib/ai/surfaces/voice/session";
import { currentUser } from "@/lib/auth/session";

/**
 * The gate for voice (docs/adr/026, docs/adr/030). A spoken session asks the
 * same questions as any other AI surface before it starts — is AI on, is the
 * day's budget spent, has this shopper any turns left — so a shopper is told
 * *before* they start speaking, not after.
 *
 * It also decides how voice runs. With a realtime key (VOICE_PROVIDER), the
 * session is reserved here — its minutes from the shopper's credits and its
 * cost against the day's budget — and the browser then asks
 * `/api/concierge/voice/realtime` for the token, once. Without a key, or when
 * the credits or the budget cannot cover a realtime session, voice runs on the
 * browser's own speech, which costs nothing: a shopper who has spent their
 * credits can still talk.
 */

export const runtime = "nodejs";

const bodySchema = z.object({ locale: z.enum(["en", "el"]).catch("en") });

export type VoiceSessionResponse =
  | {
      ok: true;
      mode: "browser";
      /** The language tag the recogniser and the voice use. */
      locale: string;
      maxSessionMs: number;
      maxTurns: number;
      /** Turns left in the shopper's allowance today; the spoken session cannot exceed it. */
      turnsLeft: number;
    }
  | {
      ok: true;
      mode: "realtime";
      provider: RealtimeProvider;
      /** The reserved session; the token route opens it once. */
      sessionId: string;
      locale: string;
      /** The reserved minutes: the browser closes the socket when they run out. */
      maxSessionMs: number;
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

  // Realtime, when a key exists and the shopper's credits and the day's budget cover it.
  const provider = realtimeProvider();
  if (provider !== null) {
    const begun = await (await voiceSessionStore()).begin({ actor, model: voiceModel(provider), locale });
    if (begun.ok) {
      return Response.json({
        ok: true,
        mode: "realtime",
        provider,
        sessionId: begun.session.id,
        locale: voiceLocale(locale),
        maxSessionMs: begun.session.reservedMinutes * 60_000,
      } satisfies VoiceSessionResponse);
    }
    // Out of credits or budget for realtime: the browser's speech still works.
  }

  const { turns } = await usage.remaining(actor);
  if (turns <= 0) return refuse("turns");

  // Recorded like every other AI surface, so /admin/ai shows voice being used
  // even while it costs nothing.
  await usage.record({
    feature: "voice",
    model: { provider: "browser", id: "web-speech", pricing: { kind: "tokens", inputUsdPerMillion: 0, outputUsdPerMillion: 0 } },
    surface: "voice",
    actorKey: actor.key,
    usage: { units: 1 },
  });

  return Response.json({
    ok: true,
    mode: "browser",
    locale: voiceLocale(locale),
    maxSessionMs: MAX_SESSION_MS,
    maxTurns: MAX_TURNS,
    turnsLeft: turns,
  } satisfies VoiceSessionResponse);
}
