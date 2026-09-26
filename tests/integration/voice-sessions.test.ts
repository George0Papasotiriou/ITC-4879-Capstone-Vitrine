/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Integration tests for realtime voice sessions: reserved in full, opened once, settled down by the server's clock, never up.
 */

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { uuidv7 } from "uuidv7";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createDashboardStore } from "@/lib/admin/dashboard-store";
import { periodFor } from "@/lib/admin/metrics";
import { costMicros, MODELS } from "@/lib/ai/models";
import { createVoiceSessionStore, OPEN_WINDOW_SECONDS, VOICE_SESSION_MINUTES } from "@/lib/ai/surfaces/voice/sessions";
import { BUDGET_SETTING, createUsageStore, DAILY_CAPS, KILL_SWITCH_SETTING } from "@/lib/ai/usage";
import * as schema from "@/lib/db/schema";

const url = process.env.DATABASE_URL;

describe.skipIf(url === undefined || url === "")("realtime voice sessions", () => {
  let connection: ReturnType<typeof postgres>;
  const guest = () => ({ key: `guest:${uuidv7()}`, kind: "guest" as const });
  const customer = () => ({ key: `user:${uuidv7()}`, kind: "customer" as const });
  const model = MODELS.voiceOpenai;
  const minuteCost = costMicros(model.pricing, { units: 1 })!;
  // Voice is paid for even beside a demo Concierge, so the tests run the guard in demo mode.
  const stores = (mode: "google" | "demo" = "demo") => {
    const usage = createUsageStore(connection, { mode, killSwitch: false, dailyBudgetEur: 3 });
    return { usage, voice: createVoiceSessionStore(connection, usage) };
  };
  const usageRow = async (id: string) => (await connection<{ units: number; cost_micros: string | null; provider: string }[]>`SELECT units, cost_micros, provider FROM ai_usage WHERE id = ${id}`)[0]!;
  const t0 = new Date("2026-09-26T10:00:00Z");
  const later = (seconds: number) => new Date(t0.getTime() + seconds * 1000);

  beforeAll(async () => {
    connection = postgres(url as string, { max: 6, onnotice: () => {} });
    await migrate(drizzle(connection, { schema }), { migrationsFolder: "./drizzle" });
  });

  beforeEach(async () => {
    await connection`TRUNCATE ai_usage, ai_allowances, voice_sessions`;
    await connection`DELETE FROM app_settings WHERE key IN (${KILL_SWITCH_SETTING}, ${BUDGET_SETTING})`;
  });

  afterAll(async () => {
    await connection?.end();
  });

  it("reserves the whole session up front — its minutes from the credits, its cost at the model's price — even in demo mode", async () => {
    const { usage, voice } = stores("demo");
    const actor = customer();
    const begun = await voice.begin({ actor, model, locale: "en", now: t0 });
    expect(begun.ok).toBe(true);
    if (!begun.ok) return;
    expect(begun.session.reservedMinutes).toBe(VOICE_SESSION_MINUTES);
    expect((await usage.remaining(actor, t0)).credits).toBe(DAILY_CAPS.customer.credits - VOICE_SESSION_MINUTES);
    const row = await usageRow(begun.session.usageId);
    expect(row.provider).toBe("openai");
    expect(Number(row.cost_micros)).toBe(minuteCost * VOICE_SESSION_MINUTES);
  });

  it("reserves only the minutes a guest's credits cover, and none when they are spent", async () => {
    const { usage, voice } = stores();
    const actor = guest();
    await usage.reserveCredits(actor, "try_on", t0); // 3 of a guest's 5
    const begun = await voice.begin({ actor, model, locale: "el", now: t0 });
    expect(begun.ok && begun.session.reservedMinutes).toBe(DAILY_CAPS.guest.credits - 3);
    // Beginning again ends the first session (never opened: everything back), then reserves anew.
    const again = await voice.begin({ actor, model, locale: "el", now: later(5) });
    expect(again.ok && again.session.reservedMinutes).toBe(2);
    expect((await usage.remaining(actor, later(6))).credits).toBe(0);
    // Used to the end, those minutes are gone, and there are none left for another session.
    if (!again.ok) throw new Error("not begun");
    await voice.open({ id: again.session.id, actor, now: later(6) });
    await voice.end({ id: again.session.id, actor, now: later(6 + 120) });
    expect(await voice.begin({ actor, model, locale: "el", now: later(130) })).toEqual({ ok: false, reason: "credits" });
  });

  it("hands out the token once, to its owner, within the open window", async () => {
    const { voice } = stores();
    const actor = customer();
    const begun = await voice.begin({ actor, model, locale: "en", now: t0 });
    if (!begun.ok) throw new Error("not begun");
    const id = begun.session.id;
    expect(await voice.open({ id, actor: customer(), now: later(1) })).toEqual({ ok: false, reason: "not_found" });
    const opened = await Promise.all([voice.open({ id, actor, now: later(2) }), voice.open({ id, actor, now: later(2) })]);
    expect(opened.filter((result) => result.ok)).toHaveLength(1);
    expect(opened.find((result) => !result.ok)).toEqual({ ok: false, reason: "already_open" });

    const late = await voice.begin({ actor, model, locale: "en", now: later(10) });
    if (!late.ok) throw new Error("not begun");
    expect(await voice.open({ id: late.session.id, actor, now: later(10 + OPEN_WINDOW_SECONDS + 1) })).toEqual({ ok: false, reason: "expired" });
  });

  it("settles down to the seconds between the token and the end, gives back unused minutes, and ends only once", async () => {
    const { usage, voice } = stores();
    const actor = customer();
    const begun = await voice.begin({ actor, model, locale: "en", now: t0 });
    if (!begun.ok) throw new Error("not begun");
    await voice.open({ id: begun.session.id, actor, now: later(1) });

    const ended = await voice.end({ id: begun.session.id, actor, now: later(1 + 75) });
    expect(ended?.usedSeconds).toBe(75);
    const row = await usageRow(begun.session.usageId);
    expect(row.units).toBeCloseTo(75 / 60, 6);
    expect(Number(row.cost_micros)).toBe(costMicros(model.pricing, { units: 75 / 60 }));
    // Two minutes used (rounded up), one given back.
    expect((await usage.remaining(actor, t0)).credits).toBe(DAILY_CAPS.customer.credits - 2);

    // Ending again, even much later, changes nothing.
    await voice.end({ id: begun.session.id, actor, now: later(3600) });
    expect((await usageRow(begun.session.usageId)).units).toBeCloseTo(75 / 60, 6);
    expect((await usage.remaining(actor, t0)).credits).toBe(DAILY_CAPS.customer.credits - 2);
  });

  it("charges nothing for a session whose socket never opened, and never raises a charge", async () => {
    const { usage, voice } = stores();
    const actor = customer();
    const begun = await voice.begin({ actor, model, locale: "en", now: t0 });
    if (!begun.ok) throw new Error("not begun");
    await voice.end({ id: begun.session.id, actor, now: later(30) });
    expect(Number((await usageRow(begun.session.usageId)).cost_micros)).toBe(0);
    expect((await usage.remaining(actor, t0)).credits).toBe(DAILY_CAPS.customer.credits);

    // A settlement can only lower a row, and only the actor's own.
    const id = uuidv7();
    await usage.record({ id, feature: "voice", model, surface: "voice", actorKey: actor.key, usage: { units: 1 }, paid: true, now: t0 });
    expect(await usage.settle({ id, actorKey: actor.key, model, usage: { units: 2 } })).toBe(false);
    expect(await usage.settle({ id, actorKey: "user:someone-else", model, usage: { units: 0 } })).toBe(false);
    expect(Number((await usageRow(id)).cost_micros)).toBe(minuteCost);
  });

  it("shows /admin/ai the minutes and cost of each provider's sessions, exactly as the rows hold them", async () => {
    const { voice } = stores();
    const actor = customer();
    const used = await voice.begin({ actor, model, locale: "en", now: t0 });
    if (!used.ok) throw new Error("not begun");
    await voice.open({ id: used.session.id, actor, now: t0 });
    await voice.end({ id: used.session.id, actor, now: later(90) });
    // Still open: counted at its reserved length.
    const open = await voice.begin({ actor: customer(), model: MODELS.voiceGoogle, locale: "el", now: later(100) });
    expect(open.ok).toBe(true);

    const period = periodFor(7, new Date("2026-09-26T12:00:00Z"));
    const { voice: rows } = await createDashboardStore(connection).aiSpend(period);
    expect(rows).toEqual([
      { provider: "google", sessions: 1, seconds: VOICE_SESSION_MINUTES * 60, costMicros: costMicros(MODELS.voiceGoogle.pricing, { units: VOICE_SESSION_MINUTES }) },
      { provider: "openai", sessions: 1, seconds: 90, costMicros: costMicros(model.pricing, { units: 90 / 60 }) },
    ]);
  });

  it("counts a reserved session against the day's budget, so realtime voice stops when the budget is spent", async () => {
    const { usage, voice } = stores("demo");
    await usage.setSetting(BUDGET_SETTING, (minuteCost * VOICE_SESSION_MINUTES) / 1_000_000, "test budget");
    const first = await voice.begin({ actor: customer(), model, locale: "en", now: t0 });
    expect(first.ok).toBe(true);
    expect(await voice.begin({ actor: customer(), model, locale: "en", now: later(1) })).toEqual({ ok: false, reason: "budget" });
    // The demo Concierge itself is not paid, so it is not stopped by the same budget.
    expect(await usage.open(later(2))).toEqual({ ok: true });
  });
});
