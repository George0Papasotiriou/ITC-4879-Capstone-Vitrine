/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Realtime voice sessions: reserved when they start, opened once, and settled by the server's clock when they end.
 */

import type postgres from "postgres";
import { uuidv7 } from "uuidv7";

import { MODELS, type ModelEntry } from "@/lib/ai/models";
import { utcDay, type Actor, type GateRefusal, type UsageStore } from "@/lib/ai/usage";

/**
 * docs/adr/030. In a realtime session the audio goes from the browser straight
 * to the provider with a short-lived token, so the shop never sees the minutes
 * go by. It pays for them all the same, so:
 *
 * 1. **Begin** reserves the whole session: one credit per minute (CREDIT_COSTS
 *    `voice_minute`) and a cost row for every minute at the model's price.
 * 2. **Open** hands out the token once, within a minute of beginning. A second
 *    request for the same session is refused, so one reservation is one socket.
 * 3. **End** measures the session on the server — from the moment the token
 *    was handed out to the moment the browser says it has stopped — and gives
 *    back the minutes that were not used. The browser is never asked how long
 *    it talked.
 *
 * A session that never ends (a closed tab, a lost connection) stays charged in
 * full: the reservation errs on the high side, as the budget guard should.
 */

type Sql = postgres.Sql;

/** A spoken session lasts at most this long; the browser closes the socket at the limit. */
export const VOICE_SESSION_MINUTES = 3;

/** The token is only good for opening the socket, within this window. */
export const OPEN_WINDOW_SECONDS = 60;

/** The realtime models a session may have been reserved for, found again by id to settle it. */
const VOICE_MODELS: readonly ModelEntry[] = [MODELS.voiceOpenai, MODELS.voiceGoogle];

export type VoiceSessionRow = {
  id: string;
  actorKey: string;
  provider: string;
  model: string;
  locale: string;
  day: string;
  reservedMinutes: number;
  usageId: string;
  createdAt: Date;
  mintedAt: Date | null;
  endedAt: Date | null;
  usedSeconds: number | null;
};

/**
 * What a session used, measured by the server: from the token being handed
 * out to the end, never more than was reserved, and nothing at all if the
 * socket was never opened. Minutes are rounded up — a credit is a whole
 * minute — while the cost is charged by the second.
 */
export function settlement({ reservedMinutes, mintedAt, endedAt }: { reservedMinutes: number; mintedAt: Date | null; endedAt: Date }): {
  usedSeconds: number;
  usedMinutes: number;
  unusedMinutes: number;
} {
  const reservedSeconds = reservedMinutes * 60;
  const usedSeconds = mintedAt === null ? 0 : Math.min(reservedSeconds, Math.max(0, Math.ceil((endedAt.getTime() - mintedAt.getTime()) / 1000)));
  const usedMinutes = Math.ceil(usedSeconds / 60);
  return { usedSeconds, usedMinutes, unusedMinutes: reservedMinutes - usedMinutes };
}

/** How many minutes a session may reserve: the limit, or the credits left if fewer. */
export function minutesToReserve(creditsLeft: number, limit = VOICE_SESSION_MINUTES): number {
  return Math.max(0, Math.min(limit, Math.floor(creditsLeft)));
}

export type BeginResult = { ok: true; session: VoiceSessionRow } | { ok: false; reason: GateRefusal };
export type OpenResult = { ok: true; session: VoiceSessionRow } | { ok: false; reason: "not_found" | "already_open" | "expired" | "ended" };

const fromRow = (row: Record<string, unknown>): VoiceSessionRow => ({
  id: String(row.id),
  actorKey: String(row.actor_key),
  provider: String(row.provider),
  model: String(row.model),
  locale: String(row.locale),
  day: typeof row.day === "string" ? row.day : utcDay(row.day as Date),
  reservedMinutes: Number(row.reserved_minutes),
  usageId: String(row.usage_id),
  createdAt: new Date(row.created_at as string),
  mintedAt: row.minted_at === null ? null : new Date(row.minted_at as string),
  endedAt: row.ended_at === null ? null : new Date(row.ended_at as string),
  usedSeconds: row.used_seconds === null ? null : Number(row.used_seconds),
});

export function createVoiceSessionStore(sql: Sql, usage: UsageStore) {
  /** Settles one session that has not ended yet; returns it as settled, or null if it had already ended. */
  async function settleOne(session: VoiceSessionRow, actor: Actor, now: Date): Promise<VoiceSessionRow | null> {
    const { usedSeconds, unusedMinutes } = settlement({ reservedMinutes: session.reservedMinutes, mintedAt: session.mintedAt, endedAt: now });
    // Ending is one statement that only succeeds once, so two end requests
    // arriving together cannot give the unused minutes back twice.
    const [ended] = await sql`
      UPDATE voice_sessions SET ended_at = ${now.toISOString()}::timestamptz, used_seconds = ${usedSeconds}
      WHERE id = ${session.id} AND ended_at IS NULL
      RETURNING *
    `;
    if (ended === undefined) return null;
    // A model no longer listed keeps its reserved cost: the guard errs high rather than guessing a price.
    const model = VOICE_MODELS.find((entry) => entry.id === session.model);
    if (model !== undefined) await usage.settle({ id: session.usageId, actorKey: session.actorKey, model, usage: { units: usedSeconds / 60 } });
    await usage.releaseCredits(actor, "voice_minute", session.day, unusedMinutes);
    return fromRow(ended);
  }

  /**
   * Reserves a session for `actor`: credits for each minute and the cost of
   * all of them. Any session of theirs still open is ended first, so one
   * person holds one reservation at a time.
   */
  async function begin({ actor, model, locale, now = new Date() }: { actor: Actor; model: ModelEntry; locale: string; now?: Date }): Promise<BeginResult> {
    const open = await sql`SELECT * FROM voice_sessions WHERE actor_key = ${actor.key} AND ended_at IS NULL`;
    for (const row of open) await settleOne(fromRow(row), actor, now);

    const minutes = minutesToReserve((await usage.remaining(actor, now)).credits);
    if (minutes === 0) return { ok: false, reason: "credits" };
    const reserved = await usage.reserveCredits(actor, "voice_minute", now, minutes);
    if (!reserved.ok) return reserved;

    const usageId = uuidv7();
    await usage.record({ id: usageId, feature: "voice", model, surface: "voice", actorKey: actor.key, usage: { units: minutes }, paid: true, now });
    const [row] = await sql`
      INSERT INTO voice_sessions (id, actor_key, provider, model, locale, day, reserved_minutes, usage_id, created_at)
      VALUES (${uuidv7()}, ${actor.key}, ${model.provider}, ${model.id}, ${locale}, ${utcDay(now)}, ${minutes}, ${usageId}, ${now.toISOString()}::timestamptz)
      RETURNING *
    `;
    return { ok: true, session: fromRow(row!) };
  }

  /** Marks the session opened — once, by its owner, within the open window. */
  async function open({ id, actor, now = new Date() }: { id: string; actor: Actor; now?: Date }): Promise<OpenResult> {
    const [row] = await sql`SELECT * FROM voice_sessions WHERE id = ${id} AND actor_key = ${actor.key}`;
    if (row === undefined) return { ok: false, reason: "not_found" };
    const session = fromRow(row);
    if (session.endedAt !== null) return { ok: false, reason: "ended" };
    if (session.mintedAt !== null) return { ok: false, reason: "already_open" };
    if (now.getTime() - session.createdAt.getTime() > OPEN_WINDOW_SECONDS * 1000) return { ok: false, reason: "expired" };
    const [minted] = await sql`
      UPDATE voice_sessions SET minted_at = ${now.toISOString()}::timestamptz
      WHERE id = ${id} AND minted_at IS NULL AND ended_at IS NULL
      RETURNING *
    `;
    return minted === undefined ? { ok: false, reason: "already_open" } : { ok: true, session: fromRow(minted) };
  }

  /** Ends the session and settles it by the server's clock. Ending twice changes nothing. */
  async function end({ id, actor, now = new Date() }: { id: string; actor: Actor; now?: Date }): Promise<VoiceSessionRow | null> {
    const [row] = await sql`SELECT * FROM voice_sessions WHERE id = ${id} AND actor_key = ${actor.key}`;
    if (row === undefined) return null;
    const session = fromRow(row);
    if (session.endedAt !== null) return session;
    return (await settleOne(session, actor, now)) ?? session;
  }

  async function byId(id: string): Promise<VoiceSessionRow | null> {
    const [row] = await sql`SELECT * FROM voice_sessions WHERE id = ${id}`;
    return row === undefined ? null : fromRow(row);
  }

  return { begin, open, end, byId };
}

export type VoiceSessionStore = ReturnType<typeof createVoiceSessionStore>;
