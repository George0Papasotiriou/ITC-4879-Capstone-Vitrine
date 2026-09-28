/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * E1 relevance judgements in the database: grading a product for a query, and reading the grades back.
 */

import type postgres from "postgres";
import { uuidv7 } from "uuidv7";

import type { Grade } from "@/lib/search/metrics";
import { normalize } from "@/lib/search/normalize";

/** docs/adr/036. Queries are kept folded, so the page, the script and the tests agree on what "the same query" is. */
export const judgmentKey = (query: string) => normalize(query).slice(0, 200);

export function createJudgmentStore(sql: postgres.Sql) {
  /** Grades a product for a query; grading it again replaces the grade. */
  async function judge(input: { query: string; locale: string; productId: string; grade: Grade; userId: string | null }, now = new Date()): Promise<boolean> {
    const rows = await sql`
      INSERT INTO search_judgments (id, query, locale, product_id, grade, judged_by, created_at, updated_at)
      SELECT ${uuidv7()}, ${judgmentKey(input.query)}, ${input.locale}, p.id, ${input.grade}, ${input.userId}, ${now.toISOString()}::timestamptz, ${now.toISOString()}::timestamptz
      FROM products p WHERE p.id = ${input.productId}
      ON CONFLICT (query, locale, product_id) DO UPDATE SET grade = EXCLUDED.grade, judged_by = EXCLUDED.judged_by, updated_at = EXCLUDED.updated_at
      RETURNING id
    `;
    return rows.length === 1;
  }

  /** Every grade, by query and language: "query|locale" → product → grade. */
  async function all(): Promise<Map<string, Map<string, Grade>>> {
    const rows = await sql<{ query: string; locale: string; product_id: string; grade: number }[]>`
      SELECT query, locale, product_id, grade FROM search_judgments
    `;
    const byQuery = new Map<string, Map<string, Grade>>();
    for (const row of rows) {
      const key = `${row.query}|${row.locale}`;
      const grades = byQuery.get(key) ?? new Map<string, Grade>();
      grades.set(row.product_id, row.grade as Grade);
      byQuery.set(key, grades);
    }
    return byQuery;
  }

  return { judge, all };
}

export type JudgmentStore = ReturnType<typeof createJudgmentStore>;
