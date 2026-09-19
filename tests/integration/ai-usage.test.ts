/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Integration tests for the AI cost guard: daily caps under concurrency, credits, the kill switch and the budget.
 */

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { uuidv7 } from "uuidv7";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { MODELS } from "@/lib/ai/models";
import { BUDGET_SETTING, createUsageStore, DAILY_CAPS, KILL_SWITCH_SETTING, utcDay } from "@/lib/ai/usage";
import * as schema from "@/lib/db/schema";

const url = process.env.DATABASE_URL;

describe.skipIf(url === undefined || url === "")("AI usage", () => {
  let connection: ReturnType<typeof postgres>;
  const guest = () => ({ key: `guest:${uuidv7()}`, kind: "guest" as const });
  const live = () => createUsageStore(connection, { mode: "google", killSwitch: false, dailyBudgetEur: 3 });

  beforeAll(async () => {
    connection = postgres(url as string, { max: 6, onnotice: () => {} });
    await migrate(drizzle(connection, { schema }), { migrationsFolder: "./drizzle" });
  });

  beforeEach(async () => {
    await connection`TRUNCATE ai_usage, ai_allowances`;
    await connection`DELETE FROM app_settings WHERE key IN (${KILL_SWITCH_SETTING}, ${BUDGET_SETTING})`;
  });

  afterAll(async () => {
    await connection?.end();
  });

  it("gives a guest exactly the daily turns, even when requests arrive together", async () => {
    const store = live();
    const actor = guest();
    const results = await Promise.all(Array.from({ length: DAILY_CAPS.guest.turns + 5 }, () => store.takeTurn(actor)));
    expect(results.filter((result) => result.ok)).toHaveLength(DAILY_CAPS.guest.turns);
    expect(results.find((result) => !result.ok)).toEqual({ ok: false, reason: "turns" });
    expect(await store.remaining(actor)).toEqual({ turns: 0, credits: DAILY_CAPS.guest.credits });
  });

  it("starts a new allowance each UTC day", async () => {
    const store = live();
    const actor = guest();
    const today = new Date("2026-09-19T23:59:00Z");
    for (let turn = 0; turn < DAILY_CAPS.guest.turns; turn += 1) await store.takeTurn(actor, today);
    expect(await store.takeTurn(actor, today)).toEqual({ ok: false, reason: "turns" });
    expect(await store.takeTurn(actor, new Date("2026-09-20T00:01:00Z"))).toEqual({ ok: true });
  });

  it("reserves credits for a costly action and gives them back when it fails", async () => {
    const store = live();
    const actor = guest();
    expect(await store.reserveCredits(actor, "try_on")).toEqual({ ok: true });
    // 3 + 3 is more than a guest's 5.
    expect(await store.reserveCredits(actor, "try_on")).toEqual({ ok: false, reason: "credits" });
    await store.releaseCredits(actor, "try_on", utcDay(new Date()));
    expect(await store.reserveCredits(actor, "try_on")).toEqual({ ok: true });
    // Animate me (10) is more than a guest can ever spend.
    expect(await store.reserveCredits(actor, "animate")).toEqual({ ok: false, reason: "credits" });
  });

  it("stops everything with the kill switch, and an admin setting beats the environment", async () => {
    const store = live();
    await store.setSetting(KILL_SWITCH_SETTING, true, "test");
    expect(await store.takeTurn(guest())).toEqual({ ok: false, reason: "kill_switch" });
    await store.setSetting(KILL_SWITCH_SETTING, false, "test");
    const killedByEnvironment = createUsageStore(connection, { mode: "google", killSwitch: true, dailyBudgetEur: 3 });
    expect(await killedByEnvironment.open()).toEqual({ ok: true });
    await connection`DELETE FROM app_settings WHERE key = ${KILL_SWITCH_SETTING}`;
    expect(await killedByEnvironment.open()).toEqual({ ok: false, reason: "kill_switch" });
  });

  it("pauses real AI once the day's spend reaches the budget, but not the free demo", async () => {
    const store = live();
    await store.setSetting(BUDGET_SETTING, 0.1, "test");
    // Two try-ons at €0.075 each: €0.15, past a €0.10 budget.
    await store.record({ feature: "try_on", model: MODELS.tryOn, surface: "test", actorKey: null, usage: { units: 2 } });
    expect(await store.spentToday()).toBe(150_000);
    expect(await store.open()).toEqual({ ok: false, reason: "budget" });
    // Yesterday's spend does not count today.
    await connection`UPDATE ai_usage SET occurred_at = now() - interval '2 days'`;
    expect(await store.open()).toEqual({ ok: true });

    const demo = createUsageStore(connection, { mode: "demo", killSwitch: false, dailyBudgetEur: 0 });
    expect(await demo.open()).toEqual({ ok: true });
  });

  it("records what a call used and cost, and demo calls as free and labelled", async () => {
    await live().record({ feature: "concierge", model: MODELS.concierge, surface: "chat", actorKey: "guest:x", usage: { inputTokens: 6_000, outputTokens: 400 } });
    await createUsageStore(connection, { mode: "demo", killSwitch: false, dailyBudgetEur: 3 }).record({
      feature: "concierge",
      model: MODELS.concierge,
      surface: "chat",
      actorKey: "guest:x",
      usage: { inputTokens: 100, outputTokens: 50 },
    });
    const rows = await connection<{ provider: string; model: string; cost_micros: number; input_tokens: number }[]>`
      SELECT provider, model, cost_micros, input_tokens FROM ai_usage ORDER BY occurred_at, id
    `;
    expect(rows.map((row) => [row.provider, Number(row.cost_micros), row.input_tokens])).toEqual([
      ["google", 6_000, 6_000],
      ["demo", 0, 100],
    ]);
  });

  it("refuses everything when AI is off", async () => {
    const off = createUsageStore(connection, { mode: "off", killSwitch: false, dailyBudgetEur: 3 });
    expect(await off.takeTurn(guest())).toEqual({ ok: false, reason: "off" });
  });
});
