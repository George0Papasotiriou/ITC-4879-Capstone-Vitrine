/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Concierge and recommendation events: recording them anonymously, and the figures their dashboards show.
 */

import type postgres from "postgres";
import { uuidv7 } from "uuidv7";

import { dayKey, fillDays, inPeriod, share, type Period } from "@/lib/admin/metrics";

/**
 * docs/adr/034. Two small logs, like the search log (docs/adr/018): no
 * shopper, no words, no tool inputs, kept 90 days. The Concierge log answers
 * "is it used, is it quick, do people accept what it proposes and keep what it
 * does"; the shelf log answers "are the recommendations looked at and bought
 * from". The figures are computed here, from rows, so a test can hold them
 * against hand-counted rows.
 */

export const EVENTS_KEEP_DAYS = 90;

export const CONCIERGE_OUTCOMES = ["ok", "approval_asked", "approved", "declined", "undone", "error"] as const;
export type ConciergeOutcome = (typeof CONCIERGE_OUTCOMES)[number];

export type ConciergeEventInput =
  | { kind: "turn"; surface: string; outcome: "ok" | "error"; latencyMs: number; steps: number }
  | { kind: "tool"; surface: string; tool: string; outcome: ConciergeOutcome; latencyMs?: number }
  /** A turn the cost guard refused before any model ran: the reason is the outcome (off, budget, credits, turns). */
  | { kind: "refused"; surface: string; outcome: string };

export const SHELVES = ["for-you", "popular", "pairs-with", "more-like-this", "complete-set", "fits-your-space"] as const;
export type Shelf = (typeof SHELVES)[number];
export const isShelf = (value: unknown): value is Shelf => (SHELVES as readonly unknown[]).includes(value);

export type RecoEventInput = { shelf: Shelf; kind: "impression" | "click" | "add_to_cart"; productId: string | null };

type Sql = postgres.Sql;
let lastPrunedAt = 0;

async function pruneIfDue(sql: Sql, now: Date): Promise<void> {
  if (now.getTime() - lastPrunedAt < 60 * 60 * 1000) return;
  lastPrunedAt = now.getTime();
  const cutoff = new Date(now.getTime() - EVENTS_KEEP_DAYS * 24 * 60 * 60 * 1000).toISOString();
  await sql`DELETE FROM concierge_events WHERE occurred_at < ${cutoff}::timestamptz`;
  await sql`DELETE FROM reco_events WHERE occurred_at < ${cutoff}::timestamptz`;
}

/** Never lets a failed write reach the shopper: the dashboards are worth less than an answer. */
export async function recordConciergeEvents(sql: Sql, events: readonly ConciergeEventInput[], { now = new Date(), onError }: { now?: Date; onError?: (error: unknown) => void } = {}): Promise<void> {
  if (events.length === 0) return;
  try {
    const rows = events.map((event) => ({
      id: uuidv7(),
      kind: event.kind,
      surface: event.surface.slice(0, 20),
      tool: event.kind === "tool" ? event.tool.slice(0, 60) : null,
      outcome: event.outcome.slice(0, 40),
      latency_ms: event.kind === "refused" || event.latencyMs === undefined ? null : Math.max(0, Math.round(event.latencyMs)),
      steps: event.kind === "turn" ? event.steps : null,
      occurred_at: now.toISOString(),
    }));
    // One statement for the batch, with every value typed in SQL: portable across Postgres and the local PGlite server.
    await sql`
      INSERT INTO concierge_events (id, kind, surface, tool, outcome, latency_ms, steps, occurred_at)
      SELECT r.id::uuid, r.kind::concierge_event_kind, r.surface, r.tool, r.outcome, r.latency_ms, r.steps, r.occurred_at::timestamptz
      FROM json_to_recordset(${JSON.stringify(rows)}::text::json) AS r(id text, kind text, surface text, tool text, outcome text, latency_ms int, steps int, occurred_at text)
    `;
    await pruneIfDue(sql, now);
  } catch (error) {
    onError?.(error);
  }
}

export async function recordRecoEvents(sql: Sql, events: readonly RecoEventInput[], { now = new Date(), onError }: { now?: Date; onError?: (error: unknown) => void } = {}): Promise<void> {
  if (events.length === 0) return;
  try {
    const rows = events.map((event) => ({ id: uuidv7(), shelf: event.shelf, kind: event.kind, product_id: event.productId, occurred_at: now.toISOString() }));
    // A product deleted meanwhile would break the whole batch; its events are simply not kept.
    await sql`
      INSERT INTO reco_events (id, shelf, kind, product_id, occurred_at)
      SELECT r.id::uuid, r.shelf, r.kind::reco_event_kind, CASE WHEN EXISTS (SELECT 1 FROM products p WHERE p.id = r.product_id::uuid) THEN r.product_id::uuid END, r.occurred_at::timestamptz
      FROM json_to_recordset(${JSON.stringify(rows)}::text::json) AS r(id text, shelf text, kind text, product_id text, occurred_at text)
    `;
    await pruneIfDue(sql, now);
  } catch (error) {
    onError?.(error);
  }
}

/**
 * The p-th percentile by the nearest-rank method: the smallest value with at
 * least p% of the values at or below it. Nearest rank always returns a value
 * that was actually measured (no interpolation between two turns), which is
 * what a latency figure should be. Null for no values.
 */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[Math.min(rank, sorted.length) - 1]!;
}

/** One event, or `count` alike ones counted by the database (tools and refusals are counted per day; turns come one by one for their latency). */
export type ConciergeRow = { kind: "turn" | "tool" | "refused"; tool: string | null; outcome: string; latencyMs: number | null; occurredAt: Date; count?: number };

export type ToolFigures = { tool: string; runs: number; errors: number; approvalsAsked: number; approved: number; declined: number; undone: number };

export type ConciergeSummary = {
  turns: number;
  refused: number;
  refusedBy: { reason: string; count: number }[];
  turnsByDay: { day: string; value: number }[];
  latencyP50: number | null;
  latencyP95: number | null;
  tools: ToolFigures[];
  /** Approved over answered approvals (approved + declined); null before any. */
  approvalRate: number | null;
  /** Undone over successful runs of the tools that can be undone; null before any. */
  undoRate: number | null;
};

/** Tools whose effect has an undo in the dock (docs/adr/019, 032, 033). */
export const UNDOABLE_TOOLS = new Set(["add_to_cart", "update_cart_item", "remove_from_cart", "adjust_comfort", "remember_preference"]);

export function conciergeSummary(rows: readonly ConciergeRow[], period: Period): ConciergeSummary {
  const inside = rows.filter((row) => inPeriod(row.occurredAt, period));
  const turns = inside.filter((row) => row.kind === "turn");
  const refusedRows = inside.filter((row) => row.kind === "refused");

  const perDay = new Map<string, number>();
  for (const turn of turns) perDay.set(dayKey(turn.occurredAt), (perDay.get(dayKey(turn.occurredAt)) ?? 0) + (turn.count ?? 1));

  const refusedBy = new Map<string, number>();
  for (const row of refusedRows) refusedBy.set(row.outcome, (refusedBy.get(row.outcome) ?? 0) + (row.count ?? 1));

  const tools = new Map<string, ToolFigures>();
  for (const row of inside) {
    if (row.kind !== "tool" || row.tool === null) continue;
    const figures = tools.get(row.tool) ?? { tool: row.tool, runs: 0, errors: 0, approvalsAsked: 0, approved: 0, declined: 0, undone: 0 };
    const count = row.count ?? 1;
    if (row.outcome === "ok") figures.runs += count;
    else if (row.outcome === "error") figures.errors += count;
    else if (row.outcome === "approval_asked") figures.approvalsAsked += count;
    else if (row.outcome === "approved") figures.approved += count;
    else if (row.outcome === "declined") figures.declined += count;
    else if (row.outcome === "undone") figures.undone += count;
    tools.set(row.tool, figures);
  }
  const all = [...tools.values()];
  const approved = all.reduce((sum, tool) => sum + tool.approved, 0);
  const declined = all.reduce((sum, tool) => sum + tool.declined, 0);
  const undoable = all.filter((tool) => UNDOABLE_TOOLS.has(tool.tool));
  const latencies = turns.map((turn) => turn.latencyMs).filter((value): value is number => value !== null);

  return {
    turns: turns.reduce((sum, turn) => sum + (turn.count ?? 1), 0),
    refused: refusedRows.reduce((sum, row) => sum + (row.count ?? 1), 0),
    refusedBy: [...refusedBy].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason)),
    turnsByDay: fillDays(period, perDay),
    latencyP50: percentile(latencies, 50),
    latencyP95: percentile(latencies, 95),
    tools: all.sort((a, b) => b.runs + b.errors - (a.runs + a.errors) || a.tool.localeCompare(b.tool)),
    approvalRate: share(approved, approved + declined),
    undoRate: share(
      undoable.reduce((sum, tool) => sum + tool.undone, 0),
      undoable.reduce((sum, tool) => sum + tool.runs, 0),
    ),
  };
}

export type RecoRow = { shelf: string; kind: "impression" | "click" | "add_to_cart"; occurredAt: Date; count?: number };

export type ShelfFigures = { shelf: string; impressions: number; clicks: number; adds: number; clickRate: number | null; addRate: number | null };

/**
 * Per shelf: how often it was seen, how often a piece on it was opened
 * (click-through = clicks / impressions), and how often a piece opened from it
 * went into the cart (add rate = adds / clicks).
 */
export function recoSummary(rows: readonly RecoRow[], period: Period): { shelves: ShelfFigures[]; clicksByDay: { day: string; value: number }[] } {
  const inside = rows.filter((row) => inPeriod(row.occurredAt, period));
  const shelves = new Map<string, { impressions: number; clicks: number; adds: number }>();
  const perDay = new Map<string, number>();
  for (const row of inside) {
    const figures = shelves.get(row.shelf) ?? { impressions: 0, clicks: 0, adds: 0 };
    const count = row.count ?? 1;
    if (row.kind === "impression") figures.impressions += count;
    else if (row.kind === "click") {
      figures.clicks += count;
      perDay.set(dayKey(row.occurredAt), (perDay.get(dayKey(row.occurredAt)) ?? 0) + count);
    } else figures.adds += count;
    shelves.set(row.shelf, figures);
  }
  return {
    shelves: [...shelves]
      .map(([shelf, figures]) => ({ shelf, ...figures, clickRate: share(figures.clicks, figures.impressions), addRate: share(figures.adds, figures.clicks) }))
      .sort((a, b) => b.impressions - a.impressions || a.shelf.localeCompare(b.shelf)),
    clicksByDay: fillDays(period, perDay),
  };
}
