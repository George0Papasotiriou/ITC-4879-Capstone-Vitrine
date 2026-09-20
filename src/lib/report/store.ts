/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Stored reports: the row beside each generated file, and the admins a new one is sent to.
 */

import type postgres from "postgres";
import { uuidv7 } from "uuidv7";

import type { WeeklyReportSummary } from "@/lib/report/weekly";

/**
 * A report is a file in the shop's storage and a row here (docs/adr/020). The
 * row carries the week it covers and the figures on its first page, so the
 * admin page can list reports without opening any of them, and the file is
 * only fetched when someone asks for it.
 */

type Sql = postgres.Sql;

export const REPORT_KIND = "weekly";

/** The key a week's report is stored under. One per week: regenerating replaces the file. */
export function reportKey(kind: string, periodEnd: string): string {
  return `reports/${kind}/${periodEnd}.pdf`;
}

export type StoredReport = {
  id: string;
  kind: string;
  periodStart: string;
  periodEnd: string;
  storageKey: string;
  bytes: number;
  summary: WeeklyReportSummary;
  createdAt: Date;
};

export function createReportStore(sql: Sql) {
  /** Writes (or replaces) the row for a generated report. */
  async function save(report: Omit<StoredReport, "id" | "createdAt">, at = new Date()): Promise<string> {
    const id = uuidv7();
    const [row] = await sql<{ id: string }[]>`
      WITH removed AS (
        DELETE FROM reports WHERE kind = ${report.kind} AND period_end = ${report.periodEnd}::date
      )
      INSERT INTO reports (id, kind, period_start, period_end, storage_key, bytes, summary, created_at)
      VALUES (${id}, ${report.kind}, ${report.periodStart}::date, ${report.periodEnd}::date, ${report.storageKey}, ${report.bytes},
              ${JSON.stringify(report.summary)}::text::jsonb, ${at.toISOString()}::timestamptz)
      RETURNING id
    `;
    return row!.id;
  }

  /** The reports there are, newest week first. */
  async function list({ kind = REPORT_KIND, limit = 12 }: { kind?: string; limit?: number } = {}): Promise<StoredReport[]> {
    const rows = await sql<{
      id: string;
      kind: string;
      period_start: string;
      period_end: string;
      storage_key: string;
      bytes: number;
      summary: WeeklyReportSummary | string;
      created_at: Date;
    }[]>`
      SELECT id, kind, period_start::text, period_end::text, storage_key, bytes, summary, created_at
      FROM reports WHERE kind = ${kind}
      ORDER BY period_end DESC, created_at DESC
      LIMIT ${limit}
    `;
    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      periodStart: row.period_start,
      periodEnd: row.period_end,
      storageKey: row.storage_key,
      bytes: row.bytes,
      // A Drizzle-wrapped client hands jsonb back as text; the shared client as an object.
      summary: typeof row.summary === "string" ? (JSON.parse(row.summary) as WeeklyReportSummary) : row.summary,
      createdAt: new Date(row.created_at),
    }));
  }

  /** Who hears about a new report: every confirmed admin account. */
  async function admins(): Promise<{ email: string; name: string }[]> {
    // Better Auth stores several roles in one column, joined by commas (src/lib/auth/roles.ts).
    const rows = await sql<{ email: string; name: string | null }[]>`
      SELECT email, name FROM users
      WHERE 'admin' = ANY(string_to_array(role, ',')) AND email_verified = true
      ORDER BY email
    `;
    return rows.map((row) => ({ email: row.email, name: row.name ?? row.email.split("@")[0]! }));
  }

  return { save, list, admins };
}

export type ReportStore = ReturnType<typeof createReportStore>;
