/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The AI cost guard: every AI call is recorded here and passes the kill switch, the daily budget and each shopper's allowance first.
 */

import type postgres from "postgres";
import { uuidv7 } from "uuidv7";

import { costMicros, eurToMicros, type AiFeature, type ModelEntry, type Usage } from "@/lib/ai/models";

/**
 * Cost discipline (CLAUDE.md rule 8, docs/PLAN.md 3.3, docs/adr/019). Before an
 * AI call, `gate` checks, in this order:
 * 1. the mode: "off" when no provider is configured;
 * 2. the kill switch: an admin setting, or AI_KILL_SWITCH;
 * 3. the shop's spend today (UTC) against the daily budget;
 * 4. the shopper's allowance: turns for the Concierge, credits for costly actions.
 * After the call, `record` writes what it used and cost.
 *
 * Allowances are taken in one statement that only increments while still under
 * the cap, so two requests arriving together cannot both take the last turn.
 * Credits reserved for a job that then fails are given back (`releaseCredits`).
 */

type Sql = postgres.Sql;

export type ActorKind = "guest" | "customer";
/** "user:<id>" or "guest:<random id from a cookie>"; never a name or an address. */
export type Actor = { key: string; kind: ActorKind };

/** Daily caps (PLAN 3.3). Staff shop under the customer caps. */
export const DAILY_CAPS: Readonly<Record<ActorKind, { turns: number; credits: number }>> = {
  guest: { turns: 15, credits: 5 },
  customer: { turns: 60, credits: 20 },
};

/** What a costly action takes from the daily credits (PLAN 3.3). */
export const CREDIT_COSTS = { try_on: 3, harmonize: 2, voice_minute: 1, animate: 10 } as const;
export type CostlyAction = keyof typeof CREDIT_COSTS;

export type GateRefusal = "off" | "kill_switch" | "budget" | "turns" | "credits";
export type GateResult = { ok: true } | { ok: false; reason: GateRefusal };

export const KILL_SWITCH_SETTING = "ai.kill_switch";
export const BUDGET_SETTING = "ai.daily_budget_eur";

export type UsageStoreOptions = {
  mode: "google" | "demo" | "off";
  /** Defaults from the environment; an admin setting in app_settings takes precedence. */
  killSwitch: boolean;
  dailyBudgetEur: number;
};

export const utcDay = (at: Date) => at.toISOString().slice(0, 10);
const startOfUtcDay = (at: Date) => new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));

export function createUsageStore(sql: Sql, options: UsageStoreOptions) {
  /** The switches in force: the admin's settings where set, else the environment's. */
  async function settings(): Promise<{ killSwitch: boolean; dailyBudgetMicros: number }> {
    const rows = await sql<{ key: string; value: unknown }[]>`SELECT key, value FROM app_settings WHERE key IN (${KILL_SWITCH_SETTING}, ${BUDGET_SETTING})`;
    const read = (key: string) => {
      const value = rows.find((row) => row.key === key)?.value;
      // Drizzle-wrapped clients return jsonb as text; the shared client as a value.
      return typeof value === "string" ? (JSON.parse(value) as unknown) : value;
    };
    const kill = read(KILL_SWITCH_SETTING);
    const budget = read(BUDGET_SETTING);
    return {
      killSwitch: typeof kill === "boolean" ? kill : options.killSwitch,
      dailyBudgetMicros: eurToMicros(typeof budget === "number" && budget >= 0 ? budget : options.dailyBudgetEur),
    };
  }

  /** What the shop has spent on AI since midnight UTC, in millionths of a euro. */
  async function spentToday(now = new Date()): Promise<number> {
    const [row] = await sql<{ spent: string | null }[]>`
      SELECT COALESCE(sum(cost_micros), 0)::bigint AS spent FROM ai_usage WHERE occurred_at >= ${startOfUtcDay(now).toISOString()}::timestamptz
    `;
    return Number(row?.spent ?? 0);
  }

  /** Whether AI may run at all right now: mode, kill switch, budget. */
  async function open(now = new Date()): Promise<GateResult> {
    if (options.mode === "off") return { ok: false, reason: "off" };
    const current = await settings();
    if (current.killSwitch) return { ok: false, reason: "kill_switch" };
    // Demo mode costs nothing, so the budget only guards real providers.
    if (options.mode !== "demo" && (await spentToday(now)) >= current.dailyBudgetMicros) return { ok: false, reason: "budget" };
    return { ok: true };
  }

  /** Takes one Concierge turn from the actor's allowance, or refuses at the cap. */
  async function takeTurn(actor: Actor, now = new Date()): Promise<GateResult> {
    const gate = await open(now);
    if (!gate.ok) return gate;
    const cap = DAILY_CAPS[actor.kind].turns;
    const taken = await sql`
      INSERT INTO ai_allowances (actor_key, day, turns, credits, updated_at)
      VALUES (${actor.key}, ${utcDay(now)}, 1, 0, now())
      ON CONFLICT (actor_key, day) DO UPDATE SET turns = ai_allowances.turns + 1, updated_at = now()
      WHERE ai_allowances.turns < ${cap}
      RETURNING turns
    `;
    return taken.length === 0 ? { ok: false, reason: "turns" } : { ok: true };
  }

  /** Reserves credits for a costly action; release them if the action fails. */
  async function reserveCredits(actor: Actor, action: CostlyAction, now = new Date()): Promise<GateResult> {
    const gate = await open(now);
    if (!gate.ok) return gate;
    const amount = CREDIT_COSTS[action];
    const cap = DAILY_CAPS[actor.kind].credits;
    if (amount > cap) return { ok: false, reason: "credits" };
    const taken = await sql`
      INSERT INTO ai_allowances (actor_key, day, turns, credits, updated_at)
      VALUES (${actor.key}, ${utcDay(now)}, 0, ${amount}, now())
      ON CONFLICT (actor_key, day) DO UPDATE SET credits = ai_allowances.credits + ${amount}, updated_at = now()
      WHERE ai_allowances.credits + ${amount} <= ${cap}
      RETURNING credits
    `;
    return taken.length === 0 ? { ok: false, reason: "credits" } : { ok: true };
  }

  /** Gives back credits reserved on `day` for an action that did not happen. */
  async function releaseCredits(actor: Actor, action: CostlyAction, day: string): Promise<void> {
    await sql`
      UPDATE ai_allowances SET credits = GREATEST(credits - ${CREDIT_COSTS[action]}, 0), updated_at = now()
      WHERE actor_key = ${actor.key} AND day = ${day}
    `;
  }

  /** What is left of today's allowance. */
  async function remaining(actor: Actor, now = new Date()): Promise<{ turns: number; credits: number }> {
    const [row] = await sql<{ turns: number; credits: number }[]>`
      SELECT turns, credits FROM ai_allowances WHERE actor_key = ${actor.key} AND day = ${utcDay(now)}
    `;
    const caps = DAILY_CAPS[actor.kind];
    return { turns: Math.max(0, caps.turns - (row?.turns ?? 0)), credits: Math.max(0, caps.credits - (row?.credits ?? 0)) };
  }

  /** Records one call. In demo mode the provider is "demo" and nothing is charged. */
  async function record(entry: { feature: AiFeature; model: ModelEntry; surface: string; actorKey: string | null; usage: Usage; now?: Date }): Promise<number | null> {
    const demo = options.mode === "demo";
    const cost = demo ? 0 : costMicros(entry.model.pricing, entry.usage);
    await sql`
      INSERT INTO ai_usage (id, occurred_at, feature, provider, model, surface, actor_key, input_tokens, output_tokens, units, cost_micros)
      VALUES (${uuidv7()}, ${(entry.now ?? new Date()).toISOString()}::timestamptz, ${entry.feature}, ${demo ? "demo" : entry.model.provider},
              ${entry.model.id}, ${entry.surface}, ${entry.actorKey}, ${Math.max(0, Math.round(entry.usage.inputTokens ?? 0))},
              ${Math.max(0, Math.round(entry.usage.outputTokens ?? 0))}, ${Math.max(0, entry.usage.units ?? 0)}, ${cost})
    `;
    return cost;
  }

  /** Sets the kill switch or the budget for everyone; the caller audits it. */
  async function setSetting(key: typeof KILL_SWITCH_SETTING | typeof BUDGET_SETTING, value: boolean | number, description: string): Promise<void> {
    await sql`
      INSERT INTO app_settings (key, value, description, updated_at) VALUES (${key}, ${JSON.stringify(value)}::text::jsonb, ${description}, now())
      ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = now()
    `;
  }

  return { mode: options.mode, settings, spentToday, open, takeTurn, reserveCredits, releaseCredits, remaining, record, setSetting };
}

export type UsageStore = ReturnType<typeof createUsageStore>;
